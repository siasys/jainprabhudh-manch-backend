const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "follow",
        "like",
        "comment",
        "reply",
        "like_comment",
        "like_reply",
        "suggestion",
        "complaint",
        "request",
        "mention",
      ],
      required: true,
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },
    // ✅ Add these two fields
    storyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Story",
      default: null,
    },
    mediaId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);
// Indexes for faster queries
notificationSchema.index({ receiverId: 1, createdAt: -1 });
notificationSchema.index({ receiverId: 1, isRead: 1 });
// Virtual field to count unread notifications
notificationSchema.virtual("unreadCount").get(function () {
  return this.model("Notification").countDocuments({
    receiverId: this.receiverId,
    isRead: false,
  });
});

// 🔔 Har notification (like/comment/follow/mention/story...) save hote hi
// AUTOMATIC push notification bhejo — koi controller change kiye bina.
// Self-notification par push nahi.
notificationSchema.post("save", async function (doc) {
  try {
    if (!doc || !doc.receiverId) return;
    // Apne aap ko notification -> push mat bhejo
    if (
      doc.senderId &&
      doc.receiverId &&
      doc.senderId.toString() === doc.receiverId.toString()
    ) {
      return;
    }
    // lazy require (circular dependency se bachne ke liye)
    const { sendPushToUsers } = require("../../config/firebaseAdmin");
    const User = require("../UserRegistrationModels/userModel");
    // bhejne wale ka naam nikaalo
    let senderName = "Someone";
    try {
      const sender = await User.findById(doc.senderId).select(
        "fullName firstName businessName sadhuName tirthName accountType",
      );
      if (sender) {
        senderName =
          sender.accountType === "business"
            ? sender.businessName
            : sender.accountType === "sadhu"
              ? sender.sadhuName
              : sender.accountType === "tirth"
                ? sender.tirthName
                : sender.fullName || sender.firstName;
        senderName = senderName || "Someone";
      }
    } catch (e) {}
    // type-wise body (English). Agar message diya hai to wahi use hoga.
    const typeText = {
      follow: "started following you",
      like: "liked your post",
      comment: "commented on your post",
      reply: "replied to you",
      like_comment: "liked your comment",
      like_reply: "liked your reply",
      mention: "mentioned you",
      request: "sent you a request",
      suggestion: "sent a suggestion",
      complaint: "sent a complaint",
    };
    const body =
      doc.message ||
      `${senderName} ${typeText[doc.type] || "sent you a notification"}`;
    await sendPushToUsers([doc.receiverId], {
      title: senderName,
      body,
      data: {
        type: "notification",
        notifType: doc.type || "",
        notifId: doc._id ? doc._id.toString() : "",
        postId: doc.postId ? doc.postId.toString() : "",
        storyId: doc.storyId ? doc.storyId.toString() : "",
        senderId: doc.senderId ? doc.senderId.toString() : "",
      },
    });
  } catch (e) {
    console.error("🔔 notification push hook error:", e.message);
  }
});

module.exports = mongoose.model("Notification", notificationSchema);
