const mongoose = require("mongoose");

// ── Individual cart line item ──
const cartItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    vyaparId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JainVyapar",
    },
    qty: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
      max: 99,
    },
    // Price locked at add time — protects user if seller changes price later
    priceAtAddTime: {
      type: Number,
      required: true,
      min: 0,
    },
    mrpAtAddTime: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Snapshot — preserves display info if product is deleted/modified
    snapshot: {
      name: { type: String, default: "" },
      photo: { type: String, default: "" },
      category: { type: String, default: "" },
      unit: { type: String, default: "piece" },
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

// ── Cart document (one per user) ──
const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // ✅ one cart per user
      index: true,
    },
    items: [cartItemSchema],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Cart", cartSchema);
