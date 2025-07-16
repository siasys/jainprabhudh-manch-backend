const mongoose = require('mongoose');

const EmailVerificationSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  isVerified: { type: Boolean, default: false },
});

module.exports = mongoose.model('EmailVerification', EmailVerificationSchema);
