const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      default: 'donation'
    },
    title: {
      type: String,
      required: true,
      trim: true
    },

    purpose: {
      type: String,
    },
    inMemory: {
      type: String,
    },

    description: {
      type: String,
      trim: true
    },

    amount: {
      type: String,
      required: true
    },
     donationPhoto: {
      type: String
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending'
    },

    paymentScreenshot: {
      type: String // image URL (S3 / Cloudinary)
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Donation', donationSchema);
