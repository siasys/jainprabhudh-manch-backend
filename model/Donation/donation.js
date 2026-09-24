const mongoose = require("mongoose");

const donationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
      required: true,
    },

    // ===== TIRTH (optional) =====
    // Tirth ki screen se daan ho to kis tirth ke liye — normal (app ka
    // direct) daan me ye null rehta hai, isliye required NAHI hai
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      default: null,
      index: true,
    },
    // snapshot — tirth ka naam baad me badle to bhi purana daan readable rahe
    tirthName: {
      type: String,
      default: "",
      trim: true,
    },

    // ===== TIRTH SETTLEMENT (optional) =====
    // Ye wahi naam hain jo tirthDonationController use karta hai.
    // Normal (app ka direct) daan me ye khaali/default rehte hain.
    beneficiaryTirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      default: null,
      index: true,
    },
    // Trust kitna percent rakhega (tirth ke donationCommissionPercent se)
    commissionPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    commissionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // tirth ko kitna dena hai = amount - commissionAmount
    payableAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // admin ne commission khud tay kiya ya nahi (settle ke liye zaroori)
    commissionSet: {
      type: Boolean,
      default: false,
    },
    settlementStatus: {
      type: String,
      enum: ["pending", "settled"],
      default: "pending",
      index: true,
    },
    settledAt: {
      type: Date,
      default: null,
    },
    settlementRef: {
      type: String,
      default: "",
    },
    settlementNote: {
      type: String,
      default: "",
    },

    type: {
      type: String,
      default: "donation",
    },

    // Occasion title (Birthday / Anniversary / etc.)
    title: {
      type: String,
      required: true,
      trim: true,
    },
    occasionDetails: {
      type: String,
    },

    purpose: {
      type: String,
    },

    onBehalfOf: {
      type: String,
    },

    onBehalfOfName: {
      type: String,
    },

    amount: {
      type: String,
      required: true,
    },

    isGuptDan: {
      type: Boolean,
      default: false,
    },

    donationPhoto: {
      type: String,
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },

    // Manual QR screenshot (purana flow)
    paymentScreenshot: {
      type: String,
    },

    // Razorpay Payment Details
    razorpayOrderId: {
      type: String,
      default: "",
    },

    razorpayPaymentId: {
      type: String,
      default: "",
    },

    razorpaySignature: {
      type: String,
      default: "",
    },

    // Payment method track karne ke liye
    paymentMethod: {
      type: String,
      enum: ["razorpay", "screenshot", "pending"],
      default: "pending",
    },

    // Currency
    currency: {
      type: String,
      default: "INR",
    },

    // Razorpay se aane wala payment timestamp
    paidAt: {
      type: Date,
    },

    // ===== RECEIPT FIELDS (additive) =====
    receiptNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    receiptDate: {
      type: Date,
    },
    financialYear: {
      type: String,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Donation", donationSchema);
