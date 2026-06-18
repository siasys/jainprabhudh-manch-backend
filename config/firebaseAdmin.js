// config/firebaseAdmin.js
// 🔔 Firebase Admin init + push notification helper (chat/group notifications)
const admin = require("firebase-admin");
const User = require("../model/UserRegistrationModels/userModel");

let initialized = false;
try {
  if (!admin.apps.length) {
    // ⚠️ Service account key (Firebase Console > Project Settings > Service accounts
    //    > Generate new private key) ko is path par rakho aur .gitignore me daalo:
    //    config/firebaseServiceAccount.json
    const serviceAccount = require("./firebaseServiceAccount.json");
    admin.initializeApp({
      credential: admin.cert(serviceAccount),
    });
  }
  initialized = true;
  console.log("✅ Firebase Admin initialized");
} catch (e) {
  console.error("⚠️ Firebase Admin init failed:", e.message);
}

/**
 * Multiple users ke saare devices par push bhejo.
 * @param {Array} userIds - jin users ko bhejni hai
 * @param {Object} opts - { title, body, data }
 */
async function sendPushToUsers(userIds, { title, body, data = {} } = {}) {
  try {
    if (!initialized) return;
    if (!userIds || userIds.length === 0) return;

    // unique string ids
    const ids = [
      ...new Set(
        userIds.map((id) => (id ? id.toString() : null)).filter(Boolean),
      ),
    ];
    if (ids.length === 0) return;

    // in users ke saare fcm tokens nikaalo
    const users = await User.find({ _id: { $in: ids } }).select("fcmTokens");
    let tokens = [];
    users.forEach((u) => {
      if (Array.isArray(u.fcmTokens)) tokens.push(...u.fcmTokens);
    });
    tokens = [...new Set(tokens.filter(Boolean))];
    if (tokens.length === 0) return;

    // FCM data ki saari values string honi chahiye
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
        notification: {
          sound: "default",
          channelId: "default-channel-id",
        },
      },
      apns: {
        payload: { aps: { sound: "default" } },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // invalid/expire ho chuke tokens ko DB se hata do
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

module.exports = { admin, sendPushToUsers };
