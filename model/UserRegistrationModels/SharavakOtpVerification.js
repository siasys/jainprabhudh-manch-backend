const mongoose = require('mongoose');

const sharavakOtpSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  isVerified: { type: Boolean, default: false },
}, { timestamps: true }); // createdAt & updatedAt auto

module.exports = mongoose.model('SharavakOtpVerification', sharavakOtpSchema);
