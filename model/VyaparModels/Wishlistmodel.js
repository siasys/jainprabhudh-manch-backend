const mongoose = require("mongoose");

// ── Individual wishlist item (simpler than cart — no qty/variants) ──
const wishlistItemSchema = new mongoose.Schema(
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
    // Snapshot — for showing wishlist even if product deleted
    snapshot: {
      name: { type: String, default: "" },
      photo: { type: String, default: "" },
      category: { type: String, default: "" },
      price: { type: Number, default: 0 },
      mrp: { type: Number, default: 0 },
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

// ── Wishlist document (one per user) ──
const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    items: [wishlistItemSchema],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Wishlist", wishlistSchema);
