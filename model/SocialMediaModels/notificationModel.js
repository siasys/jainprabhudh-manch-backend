const mongoose = require('mongoose');

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
notificationSchema.virtual('unreadCount').get(function() {
  return this.model('Notification').countDocuments({ receiverId: this.receiverId, isRead: false });
});
module.exports = mongoose.model('Notification', notificationSchema);
