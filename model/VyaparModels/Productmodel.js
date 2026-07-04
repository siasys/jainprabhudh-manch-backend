const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // ─── Ownership ───────────────────────────────
    vyaparId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JainVyapar",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ─── Basic details ───────────────────────────
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      default: "",
      maxlength: 2000,
    },

    // ─── Pricing & stock ─────────────────────────
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    mrp: {
      type: Number,
      default: 0,
      min: 0,
    },
    stock: {
      type: Number,
      default: null,
      min: 0,
    },
    unit: {
      type: String,
      default: "piece",
    },

    // ─── Photos (S3/CDN URLs) ─────────────────────
    photos: [
      {
        type: String,
      },
    ],

    // ─── Badge (Bestseller / Premium / etc.) ─────
    badge: {
      type: String,
      default: "",
    },

    // ─── Variant / extra info (all optional) ─────
    sizes: [{ type: String }],
    colors: [{ type: String }],
    material: { type: String, default: "" },
    metal: { type: String, default: "" },
    weight: { type: String, default: "" },
    expiryDate: { type: Date, default: null },
    batchNo: { type: String, default: "" },
    vegTag: { type: String, default: "" },
    language: { type: String, default: "" },
    format: { type: String, default: "" },
    customOptions: [{ type: String }],

    // ─── Status / soft delete ────────────────────
    status: {
      type: String,
      enum: ["active", "inactive", "out_of_stock"],
      default: "active",
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    // ─── Denormalized rating (for fast listing) ──
    ratingSummary: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes for common query patterns
productSchema.index({ vyaparId: 1, isDeleted: 1, status: 1 });
productSchema.index({ category: 1, isDeleted: 1, status: 1 });
productSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Product", productSchema);
