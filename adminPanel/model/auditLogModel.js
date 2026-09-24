/**
 * ADMIN PANEL — Audit Log
 *
 * Multiple admin hain, isliye har action ka record rakhna zaroori hai.
 * Kisne kya kiya, kab kiya, kis cheez pe kiya.
 */

const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
    // denormalized — admin delete ho jaye to bhi log readable rahe
    adminName: { type: String },
    adminRole: { type: String },

    // e.g. "post.delete", "team.create", "auth.login"
    action: { type: String, required: true, index: true },

    // Kis cheez pe action liya
    targetType: { type: String }, // "Post" | "Story" | "AdminUser" | "User" | "Report"
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Human readable — list me yahi dikhega
    description: { type: String },

    // Extra context (before/after values, reason, etc.)
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    ip: { type: String, default: "" },
  },
  { timestamps: true },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ admin: 1, createdAt: -1 });

module.exports = mongoose.model("AdminAuditLog", auditLogSchema);