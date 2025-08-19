const mongoose = require('mongoose');

const mobileOtpSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  isVerified: { type: Boolean, default: false },
  tempUserData: { type: Object }, // user ka data jo register karna h
}, { timestamps: true });

module.exports = mongoose.model('MobileOtpVerification', mobileOtpSchema);
