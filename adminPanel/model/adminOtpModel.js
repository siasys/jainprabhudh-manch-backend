/**
 * ADMIN PANEL — Password reset OTP
 *
 * Separate from the user-side OTP collections so admin resets
 * can never collide with user flows.
 *
 * The `expiresAt` index makes MongoDB delete rows automatically,
 * so expired codes never pile up.
 */

const mongoose = require("mongoose");

const adminOtpSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },

    // The code is hashed — a leaked database row shouldn't hand over accounts
    codeHash: { type: String, required: true },

    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    usedAt: { type: Date, default: null },
    requestIp: { type: String, default: "" },
  },
  { timestamps: true },
);

// TTL index — MongoDB removes the document once expiresAt passes
adminOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
adminOtpSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model("AdminPasswordOtp", adminOtpSchema);