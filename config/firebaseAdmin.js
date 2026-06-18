// config/firebaseAdmin.js
// 🔔 Firebase Admin init + push helper (modular API - firebase-admin v14)
// Local: config/firebaseServiceAccount.json se. Render/production: env var se.
const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const User = require("../model/UserRegistrationModels/userModel");

// Service account nikaalo: pehle env var, warna local file
function loadServiceAccount() {
  // Render par: FIREBASE_SERVICE_ACCOUNT env var me poora JSON paste karein
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
  // Local: file se
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
    if (!initialized) return;
    if (!userIds || userIds.length === 0) return;

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
    if (tokens.length === 0) return;

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

    const invalid = [];
    response.responses.forEach((r, i) => {
      if (!r.success) {
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
    }
  } catch (e) {
    console.error("sendPushToUsers error:", e.message);
  }
}

module.exports = { sendPushToUsers };
