const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
      required: true
    },

    type: {
      type: String,
      default: 'donation'
    },

    // 🎉 Occasion title (Birthday / Anniversary / etc.)
    title: {
      type: String,
      required: true,
      trim: true
    },



    purpose: {
      type: String
    },
        onBehalfOf: {
      type: String,
    },

    //  Name of the person
    onBehalfOfName: {
      type: String,
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
      type: String
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Donation', donationSchema);
