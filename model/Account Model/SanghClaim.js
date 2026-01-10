const mongoose = require('mongoose');

const sanghClaimSchema = new mongoose.Schema(
  {
    // 🔹 Claim kis sangh ne kiya
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
    },

    // 🔹 Claim karne wala user
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // 🔹 Foundation (always)
    foundationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
    },

    // Location based receivers
    countrySanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
    },

    stateSanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
    },

    districtSanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
    },

    // 🔹 Honorary sangh (special 10%)
    honorarySanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
    },

    // 🔹 Member counts
    totalMembers: {
      type: Number,
    },

    ownSanghMembers: {
      type: Number,
    },

    honoraryMembers: {
      type: Number,
      default: 0,
    },

    // 🔹 Amount breakup (CLEAR)
    ownSanghAmount: {
      type: Number, // 50% + honorary base
    },

    honoraryMembersAmount: {
      type: Number, // only honorary fee × count
    },

    foundationAmount: {
      type: Number, // 20%
    },

    countryAmount: {
      type: Number, // 10%
    },

    stateAmount: {
      type: Number, // always 0 OR optional (not used)
      default: 0,
    },

    districtAmount: {
      type: Number, // 10%
    },

    honorarySanghAmount: {
      type: Number, // 10%
    },

    // 🔹 Total
    totalAmount: {
      type: Number, // regular base + honorary base
    },

    // 🔹 Status
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'rejected', 'under_review'],
      default: 'pending',
    },

    status: {
      type: String,
      enum: ['submitted', 'under_review', 'approved', 'rejected'],
      default: 'submitted',
    },

    remark: {
      type: String,
      default: '',
    },

    paymentDetails: {
      transactionId: String,
      paidAt: Date,
      paymentMode: {
        type: String,
        enum: ['bank_transfer', 'upi', 'cheque', 'cash', 'other'],
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SanghClaim', sanghClaimSchema);
