const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null, // 👈 Optional: if reporting an account
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reportType: {
      type: String,
      enum: ["A specific post", "Something about this account"],
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Reviewed", "Resolved", "Rejected"],
      default: "Pending",
    },

    // ── Admin review fields ──
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    // What the admin actually did
    actionTaken: {
      type: String,
      enum: [
        "none",
        "ignored",
        "warned",
        "content_removed",
        "content_hidden",
        "user_suspended",
      ],
      default: "none",
    },
    adminNote: { type: String, default: "" },
    // Optional: which admin member is responsible for this report
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Report', reportSchema);
