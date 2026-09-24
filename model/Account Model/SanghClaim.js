const mongoose = require("mongoose");

const sanghClaimSchema = new mongoose.Schema(
  {
    // 🔹 Claim kis sangh ne kiya
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
      required: true,
    },

    // 🔹 Claim/Expense target sanghs (additive)
    submittedToSangh: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
      default: null,
    },
    foundationSangh: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
      default: null,
    },

    // 🔹 Claim karne wala user
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // 🔹 Member counts
    totalMembers: {
      type: Number,
      default: 0,
    },

    ownSanghMembers: {
      type: Number,
      default: 0,
    },

    honoraryMembers: {
      type: Number,
      default: 0,
    },

    // 🔹 Amount breakdown
    ownSanghAmount: {
      type: Number,
      default: 0,
    },

    honoraryMembersAmount: {
      type: Number,
      default: 0,
    },

    receivedPaymentsAmount: {
      type: Number,
      default: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
    },

    // 🔹 Claim type (additive): membership = auto unclaimed; other = manual title+amount
    claimType: {
      type: String,
      enum: ["membership", "other"],
      default: "membership",
    },
    claimTitle: {
      type: String,
      default: "",
      maxlength: 200,
    },

    // 🔹 Claimed Payments IDs (receivedPayments array se)
    claimedPaymentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
      },
    ],

    // 🔹 Status tracking
    status: {
      type: String,
      enum: ["submitted", "under_review", "approved", "rejected"],
      default: "submitted",
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "processing", "paid", "failed"],
      default: "pending",
    },

    // 🔹 Remark from sangh
    remark: {
      type: String,
      default: "",
      maxlength: 500,
    },

    // 🔹 Foundation/Admin response
    adminResponse: {
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      reviewedAt: Date,
      approvalNote: String,
      rejectionReason: String,
    },

    // 🔹 Payment details (filled by foundation after approval)
    paymentDetails: {
      transactionId: String,
      paidAt: Date,
      paymentMode: {
        type: String,
        enum: ["bank_transfer", "upi", "cheque", "cash", "other"],
      },
      bankReference: String,
      screenshot: String, // payment proof URL
    },

    // 🔹 Metadata
    submittedAt: {
      type: Date,
      default: Date.now,
    },

    approvedAt: Date,
    rejectedAt: Date,
    paidAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// 🔹 Indexes for faster queries
sanghClaimSchema.index({ sanghId: 1, status: 1 });
sanghClaimSchema.index({ userId: 1, status: 1 });
sanghClaimSchema.index({ status: 1, paymentStatus: 1 });
sanghClaimSchema.index({ createdAt: -1 });

// 🔹 Virtual for sangh details
sanghClaimSchema.virtual("sangh", {
  ref: "HierarchicalSangh",
  localField: "sanghId",
  foreignField: "_id",
  justOne: true,
});

// 🔹 Virtual for user details
sanghClaimSchema.virtual("user", {
  ref: "User",
  localField: "userId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("SanghClaim", sanghClaimSchema);
