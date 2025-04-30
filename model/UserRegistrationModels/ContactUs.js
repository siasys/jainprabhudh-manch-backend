const mongoose = require('mongoose');

const contactUsSchema = new mongoose.Schema({
  name: { type: String, required: true },
  mobileNumber: { type: String, required: true },
  profilePicture: { type: String }, // CDN-converted URL
}, { timestamps: true });

module.exports = mongoose.model('ContactUs', contactUsSchema);
