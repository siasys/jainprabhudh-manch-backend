const mongoose = require("mongoose");

/**
 * Tirth Inventory — 3 models ek hi file me
 *
 * TirthCategory  → Ghee, Pooja Stock, Kitchen Stock... (manager khud banata hai)
 * TirthItem      → asli saamaan + current stock
 * TirthMovement  → har stock in / out ki entry (history)
 *
 * Stock hamesha movement se update hota hai, taaki hisaab kabhi na bigde.
 */

/* ================================================================== */
/*  1. CATEGORY                                                       */
/* ================================================================== */
const tirthCategorySchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true },
);

tirthCategorySchema.index({ tirthId: 1, status: 1 });

/* ================================================================== */
/*  2. ITEM                                                           */
/* ================================================================== */
const UNITS = ["kg", "gram", "litre", "ml", "pcs", "packet", "box", "dozen"];

const tirthItemSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },

    // INV1000, INV1001... har tirth ke liye alag series
    itemCode: { type: String, default: "" },

    name: { type: String, required: true, trim: true },

    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TirthCategory",
      required: true,
      index: true,
    },
    // snapshot — category delete/rename hone par bhi item readable rahe
    categoryName: { type: String, default: "" },

    unit: { type: String, enum: UNITS, default: "pcs" },

    // movement se hi badalta hai, seedha edit nahi
    stock: { type: Number, default: 0 },

    // isse kam hua to "Low Stock" alert
    minStock: { type: Number, default: 0 },

    supplier: { type: String, default: "" },
    supplierPhone: { type: String, default: "" },

    expiryDate: { type: Date, default: null },
    note: { type: String, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true },
);

tirthItemSchema.index({ tirthId: 1, status: 1, createdAt: -1 });
tirthItemSchema.index({ tirthId: 1, categoryId: 1, status: 1 });

/* ================================================================== */
/*  3. MOVEMENT                                                       */
/* ================================================================== */
const IN_REASONS = ["purchase", "donation", "return", "correction", "other"];
const OUT_REASONS = [
  "bhojanshala",
  "pooja",
  "maintenance",
  "damage",
  "expired",
  "correction",
  "other",
];

const tirthMovementSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TirthItem",
      required: true,
      index: true,
    },
    // snapshot
    itemName: { type: String, default: "" },
    unit: { type: String, default: "" },

    type: { type: String, enum: ["in", "out"], required: true },
    quantity: { type: Number, required: true, min: 0 },

    // in: purchase/donation... | out: bhojanshala/pooja...
    reason: { type: String, default: "other" },

    // movement ke baad ka stock — audit ke liye
    stockAfter: { type: Number, default: 0 },

    // kisne liya / kisko diya
    person: { type: String, default: "" },
    note: { type: String, default: "" },

    date: { type: Date, default: Date.now },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

tirthMovementSchema.index({ tirthId: 1, date: -1 });
tirthMovementSchema.index({ itemId: 1, date: -1 });

/* ================================================================== */
module.exports = {
  UNITS,
  IN_REASONS,
  OUT_REASONS,
  TirthCategory: mongoose.model("TirthCategory", tirthCategorySchema),
  TirthItem: mongoose.model("TirthItem", tirthItemSchema),
  TirthMovement: mongoose.model("TirthMovement", tirthMovementSchema),
};
