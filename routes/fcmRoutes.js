// routes/fcmRoutes.js
// 🔔 FCM token save/remove (mount with authMiddleware so req.user is available)
const express = require("express");
const router = express.Router();
const User = require("../model/UserRegistrationModels/userModel");

// POST /api/fcm/save-token   body: { token }
router.post("/save-token", async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    const { token } = req.body;
    if (!userId || !token) {
      return res
        .status(400)
        .json({ success: false, message: "userId and token are required" });
    }
    // $addToSet -> duplicate token dobara save nahi hoga
    await User.findByIdAndUpdate(userId, { $addToSet: { fcmTokens: token } });
    return res.status(200).json({ success: true, message: "Token saved" });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/fcm/remove-token   body: { token }   (logout par call karein)
router.post("/remove-token", async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    const { token } = req.body;
    if (!userId || !token) {
      return res
        .status(400)
        .json({ success: false, message: "userId and token are required" });
    }
    await User.findByIdAndUpdate(userId, { $pull: { fcmTokens: token } });
    return res.status(200).json({ success: true, message: "Token removed" });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
