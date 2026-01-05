const mongoose = require('mongoose');

const sanghClaimSchema = new mongoose.Schema(
  {
    // 🔗 Kis Sangh ne claim kiya
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sangh',
      required: true,
    },

    // 👤 Claim karne wala user
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // 🏦 Foundation (auto hierarchy se)
    foundationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sangh', // foundation bhi sangh hi hai
      required: true,
    },

    // 👥 Total members (paid)
    totalMembers: {
      type: Number,
      required: true,
    },

    // 👥 Apne sangh ke members
    ownSanghMembers: {
      type: Number,
      default: 0,
    },

    // 👥 Dusre sangh ke members
    otherMembers: {
      type: Number,
      default: 0,
    },

    // 💵 Amount per member
    amountPerMember: {
      type: Number,
    },

    // 💰 Calculated amount from own sangh (50%)
    ownSanghAmount: {
      type: Number,
      default: 0,
    },

    // 💰 Calculated amount from other members (10%)
    otherMembersAmount: {
      type: Number,
      default: 0,
    },

    // 💰 Final claim amount
    totalAmount: {
      type: Number,
      required: true,
    },

    // 💳 Payment status
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'rejected'],
      default: 'pending',
    },

    // 📌 Claim status
    status: {
      type: String,
      enum: ['submitted', 'under_review', 'approved', 'rejected'],
      default: 'submitted',
    },

    // 📝 Foundation / admin remark
    remark: {
      type: String,
      default: '',
    },

    // 💸 Payment info (future ready)
    paymentDetails: {
      transactionId: { type: String },
      paidAt: { type: Date },
      paymentMode: { type: String },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('SanghClaim', sanghClaimSchema);
