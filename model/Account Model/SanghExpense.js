const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
      required: true,
    },

    // 🔹 Expense target sanghs (additive)
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

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    expensesId: {
      type: String,
    },
    expenseTitle: {
      type: String,
    },

    expenseDate: {
      type: Date,
    },

    amount: {
      type: Number,
    },

    paymentToName: {
      type: String,
    },

    category: {
      type: String,
    },

    projectName: {
      type: String,
      default: "",
    },

    meetingLocation: {
      type: String,
      default: "",
    },

    meetingPurpose: {
      type: String,
      default: "",
    },

    otherCategory: {
      type: String,
      default: "",
    },

    paymentType: {
      type: String,
      enum: ["cash", "upi", "bank", "cheque"],
    },

    uploadBill: {
      type: String, // CDN URL
      default: "",
    },

    invoiceNumber: {
      type: String,
      default: "",
    },

    additionalNote: {
      type: String,
      default: "",
    },

    // ✅ NEW STATUS FIELD
    status: {
      type: String,
      enum: ["pending", "inreview", "approved", "rejected"],
      default: "pending",
    },

    // 🔹 Approve/Reject response (additive)
    adminResponse: {
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      reviewedAt: Date,
      approvalNote: String,
      rejectionReason: String,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Expense", expenseSchema);
