const mongoose = require('mongoose');

const commentReportSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    commentId: {
      type: String,
    },
    reportType: {
      type: String,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
    actionTaken: {
      type: String,
      enum: ["none", "ignored", "warned", "content_removed"],
      default: "none",
    },
    adminNote: { type: String, default: "" },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('CommentReport', commentReportSchema);
