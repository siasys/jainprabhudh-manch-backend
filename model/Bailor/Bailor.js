const mongoose = require('mongoose');

const bailorSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      default: '' // optional
    },
    images: {
      type: [String],
      default: []
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Bailor', bailorSchema);
