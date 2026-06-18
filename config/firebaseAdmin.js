// config/firebaseAdmin.js
// 🔔 Firebase Admin init + push helper (modular API) — WITH DIAGNOSTIC LOGS
const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const User = require("../model/UserRegistrationModels/userModel");

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
      console.error(
        "⚠️ FIREBASE_SERVICE_ACCOUNT JSON parse failed:",
        e.message,
      );
      return null;
    }
  }
  try {
    return require("./firebaseServiceAccount.json");
  } catch (e) {
    console.error("⚠️ firebaseServiceAccount.json not found:", e.message);
    return null;
  }
}

let initialized = false;
try {
  if (getApps().length === 0) {
    const serviceAccount = loadServiceAccount();
    if (serviceAccount) {
      initializeApp({ credential: cert(serviceAccount) });
      initialized = true;
      console.log("✅ Firebase Admin initialized");
    } else {
      console.error("⚠️ Firebase Admin: no service account found");
    }
  } else {
    initialized = true;
  }
} catch (e) {
  console.error("⚠️ Firebase Admin init failed:", e);
}

async function sendPushToUsers(userIds, { title, body, data = {} } = {}) {
  try {
    console.log(
      "🔔 [push] called. initialized=",
      initialized,
      "userIds=",
      userIds,
    );
    if (!initialized) {
      console.log("🔔 [push] SKIP: firebase not initialized");
      return;
    }
    if (!userIds || userIds.length === 0) {
      console.log("🔔 [push] SKIP: no userIds");
      return;
    }

    const ids = [
      ...new Set(
        userIds.map((id) => (id ? id.toString() : null)).filter(Boolean),
      ),
    ];
    if (ids.length === 0) return;

    const users = await User.find({ _id: { $in: ids } }).select("fcmTokens");
    let tokens = [];
    users.forEach((u) => {
      if (Array.isArray(u.fcmTokens)) tokens.push(...u.fcmTokens);
    });
    tokens = [...new Set(tokens.filter(Boolean))];
    console.log(
      "🔔 [push] users found=",
      users.length,
      "| tokens found=",
      tokens.length,
    );
    if (tokens.length === 0) {
      console.log(
        "🔔 [push] SKIP: koi fcmToken nahi mila (DB me token save nahi hua?)",
      );
      return;
    }

    const stringData = {};
    Object.keys(data || {}).forEach((k) => {
      stringData[k] = data[k] == null ? "" : String(data[k]);
    });

    const message = {
      tokens,
      notification: { title: title || "", body: body || "" },
      data: stringData,
      android: {
        priority: "high",
        notification: { sound: "default", channelId: "default-channel-id" },
      },
      apns: { payload: { aps: { sound: "default" } } },
    };

    const response = await getMessaging().sendEachForMulticast(message);
    console.log(
      "🔔 [push] SENT. success=",
      response.successCount,
      "| failure=",
      response.failureCount,
    );

    const invalid = [];
    response.responses.forEach((r, i) => {
      if (!r.success) {
        console.log(
          "🔔 [push] token fail:",
          r.error && r.error.code,
          r.error && r.error.message,
        );
        const code = (r.error && r.error.code) || "";
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token") ||
          code.includes("invalid-argument")
        ) {
          invalid.push(tokens[i]);
        }
      }
    });
    if (invalid.length > 0) {
      await User.updateMany(
        { _id: { $in: ids } },
        { $pull: { fcmTokens: { $in: invalid } } },
      );
      console.log("🔔 [push] removed invalid tokens=", invalid.length);
    }
  } catch (e) {
    console.error("🔔 [push] sendPushToUsers error:", e.message);
  }
}

module.exports = { sendPushToUsers };
