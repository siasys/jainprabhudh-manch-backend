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
  },
  { timestamps: true },
);

module.exports = mongoose.model("Donation", donationSchema);
