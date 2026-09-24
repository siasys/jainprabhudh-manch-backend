const mongoose = require("mongoose");

/**
 * Tirth Accounting Model
 * ManageAccounting.jsx ki income/expense entries.
 * Income categories : donation | booking | other
 * Expense categories: maintenance | utility | salary | supplies | other
 */
const tirthAccountingSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["income", "expense"],
      required: true,
    },
    category: {
      type: String,
      enum: [
        "donation",
        "booking",
        "puja",
        "maintenance",
        "utility",
        "salary",
        "supplies",
        "inventory",
        "other",
      ],
      default: "other",
    },
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
    note: { type: String, default: "" },

    // agar entry booking approve hone se auto bani ho
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TirthBooking",
      default: null,
    },
    isAuto: { type: Boolean, default: false },

    // ===== SOURCE LINKING (additive) =====
    // entry kahan se aayi — manual ya kisi module se apne aap
    source: {
      type: String,
      enum: ["manual", "booking", "puja", "donation", "salary", "inventory"],
      default: "manual",
      index: true,
    },
    // us module ke record ki id (booking, puja booking, donation wagera)
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // salary entries ke liye — "2026-08"
    salaryMonth: { type: String, default: "" },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
    },
  },
  { timestamps: true },
);

tirthAccountingSchema.index({ tirthId: 1, status: 1, date: -1 });
tirthAccountingSchema.index({ tirthId: 1, type: 1, date: -1 });

module.exports =
  mongoose.models.TirthAccounting ||
  mongoose.model("TirthAccounting", tirthAccountingSchema);