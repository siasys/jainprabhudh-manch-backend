const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // ── Ownership ──────────────────────────────────────────────
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
    },

    // ── Basics ─────────────────────────────────────────────────
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    category: {
      type: String,
      required: true,
      index: true,
    },
    description: {
      type: String,
      default: "",
      maxlength: 1200,
    },

    // One-liner shown under the title on cards and the product page
    shortDescription: {
      type: String,
      default: "",
      maxlength: 160,
    },

    brand: {
      type: String,
      default: "",
      trim: true,
    },

    condition: {
      type: String,
      enum: ["New", "Refurbished", "Used - like new", "Used - good"],
      default: "New",
    },

    // Buyer-facing checklist on the product page
    highlights: {
      type: [String],
      default: [],
    },

    // Extra keywords the marketplace search can match on
    tags: {
      type: [String],
      default: [],
      index: true,
    },

    // "Additional information" table
    specs: [
      {
        key: { type: String, trim: true },
        value: { type: String, trim: true },
        _id: false,
      },
    ],

    // ── Pricing ────────────────────────────────────────────────
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
    unit: {
      type: String,
      default: "piece",
    },

    // Seller's own cost — powers the margin figure in the seller console.
    // ⚠️ Never send this to buyers. See the projection in
    //    getMarketplaceProducts / getProductById.
    cost: {
      type: Number,
      default: 0,
      min: 0,
    },

    gstRate: {
      type: Number,
      default: null,
      min: 0,
      max: 28,
    },

    hsnCode: {
      type: String,
      default: "",
      trim: true,
    },

    taxIncluded: {
      type: Boolean,
      default: true,
    },

    // ── Wholesale / B2B ────────────────────────────────────────
    // Off by default, so every existing product stays retail-only and
    // behaves exactly as before.
    wholesaleEnabled: {
      type: Boolean,
      default: false,
    },

    // A pure wholesale seller can switch this off so nobody buys a single
    // piece. With wholesaleEnabled off this flag is ignored.
    allowRetail: {
      type: Boolean,
      default: true,
    },

    // Quantity slabs — bigger order, lower unit price.
    // Kept sorted by minQty in the controller. maxQty 0 means "and above".
    // Validated there too: no gaps, no overlaps, price must fall as
    // quantity rises.
    bulkPricing: [
      {
        minQty: { type: Number, min: 1, required: true },
        maxQty: { type: Number, min: 0, default: 0 },
        price: { type: Number, min: 0, required: true },
        _id: false,
      },
    ],

    // ── Variants ───────────────────────────────────────────────
    // One product, several buyable options — 500 g / 1 kg / 5 kg, or
    // S / M / L. Each carries its own price and stock.
    //
    // Off by default. With hasVariants false the product behaves exactly
    // as before: price, mrp and stock live on the product itself and
    // nothing downstream needs to know variants exist.
    hasVariants: {
      type: Boolean,
      default: false,
    },

    // What the options actually are, so the buyer sees "Pack size"
    // rather than a generic "Variant". Set from the category.
    variantType: {
      type: String,
      default: "",
      trim: true,
    },

    variants: [
      {
        // ⚠️ _id is deliberately kept here — the cart and order reference
        //    a variant by id, so it has to be stable across edits.
        label: { type: String, required: true, trim: true },
        price: { type: Number, required: true, min: 0 },
        mrp: { type: Number, default: 0, min: 0 },
        stock: { type: Number, default: 0, min: 0 },
        sku: { type: String, default: "", trim: true },
        // Seller's cost for this option — never sent to buyers
        cost: { type: Number, default: 0, min: 0 },
        // The one shown on cards and preselected on the product page
        isDefault: { type: Boolean, default: false },
        // Per-variant slabs. A 5 kg pack in bulk is priced differently
        // from a 1 kg pack in bulk, so this cannot live on the product.
        bulkPricing: [
          {
            minQty: { type: Number, min: 1, required: true },
            maxQty: { type: Number, min: 0, default: 0 },
            price: { type: Number, min: 0, required: true },
            _id: false,
          },
        ],
      },
    ],

    // ── Inventory ──────────────────────────────────────────────
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Seller gets warned below this level
    lowStock: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Minimum order quantity
    moq: {
      type: Number,
      default: 1,
      min: 1,
    },

    // Cap per order. 0 means no limit.
    maxQty: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ── Media ──────────────────────────────────────────────────
    photos: [
      {
        url: String,
        caption: String,
      },
    ],

    // ── Merchandising ──────────────────────────────────────────
    // Kept for backwards compatibility — mirrors badges[0]
    badge: {
      type: String,
      default: "",
    },

    // Full label list applied by the seller
    badges: {
      type: [String],
      default: [],
    },
    specialOffer: {
      type: String,
      default: "",
      maxlength: 60,
    },

    // ── Fulfilment ─────────────────────────────────────────────
    shippingMode: {
      type: String,
      enum: ["jaintva", "self"],
      default: "jaintva",
    },
    codAvailable: {
      type: Boolean,
      default: true,
    },
    returnDays: {
      type: Number,
      default: 7,
      min: 0,
    },

    warranty: {
      type: String,
      default: "",
      trim: true,
    },

    // ── Ratings (aggregated from reviews later) ────────────────
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviews: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ── Visibility ─────────────────────────────────────────────
    isHidden: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },

    // Soft delete — keeps the item snapshot alive in past orders
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Text search on name + description + category + brand + tags
productSchema.index({
  name: "text",
  description: "text",
  category: "text",
  brand: "text",
  tags: "text",
});

// Common marketplace query: visible + in-stock + newest first
productSchema.index({ isDeleted: 1, isHidden: 1, status: 1, createdAt: -1 });

// Seller catalog query
productSchema.index({ vyaparId: 1, isDeleted: 1, createdAt: -1 });

// Virtual: discount percentage
productSchema.virtual("discountPct").get(function () {
  if (!this.mrp || !this.price || this.mrp <= this.price) return 0;
  return Math.round(((this.mrp - this.price) / this.mrp) * 100);
});

// Margin percentage — only meaningful in the seller console
productSchema.virtual("marginPct").get(function () {
  if (!this.cost || !this.price || this.price <= 0) return null;
  return Math.round(((this.price - this.cost) / this.price) * 100);
});

// ── Variant helpers ─────────────────────────────────────────
// Everything below tolerates a product with no variants, so callers can
// use one code path whether or not the seller turned them on.

// The variant shown on cards and preselected on the product page
productSchema.methods.defaultVariant = function () {
  if (!this.hasVariants || !this.variants?.length) return null;
  return this.variants.find((v) => v.isDefault) || this.variants[0];
};

productSchema.methods.findVariant = function (variantId) {
  if (!this.hasVariants || !this.variants?.length) return null;
  if (!variantId) return this.defaultVariant();
  return this.variants.find((v) => String(v._id) === String(variantId)) || null;
};

// Unit price for a variant at a quantity. Slabs on the variant win;
// without them the variant's own price is used.
productSchema.methods.variantPriceForQty = function (variantId, qty) {
  const v = this.findVariant(variantId);
  if (!v) return this.priceForQty(qty);

  const q = Number(qty) || 0;
  if (this.wholesaleEnabled && v.bulkPricing?.length) {
    const slab = v.bulkPricing.find(
      (s) => q >= s.minQty && (!s.maxQty || q <= s.maxQty),
    );
    if (slab) return slab.price;
  }
  return v.price;
};

// The lowest price across every variant — powers "from ₹42" on cards
productSchema.virtual("fromPrice").get(function () {
  if (!this.hasVariants || !this.variants?.length) return this.price;
  return Math.min(...this.variants.map((v) => v.price));
});

// Stock across every variant, so "out of stock" still means something
productSchema.virtual("totalStock").get(function () {
  if (!this.hasVariants || !this.variants?.length) return this.stock;
  return this.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
});

// The unit price for a given quantity. Falls back to the retail price
// when wholesale is off or the quantity sits below every slab, so callers
// can use this everywhere without branching.
productSchema.methods.priceForQty = function (qty) {
  const q = Number(qty) || 0;
  if (!this.wholesaleEnabled || !this.bulkPricing?.length) return this.price;

  const slab = this.bulkPricing.find(
    (s) => q >= s.minQty && (!s.maxQty || q <= s.maxQty),
  );
  return slab ? slab.price : this.price;
};

// Lowest slab price — powers the "from ₹280" line on cards
productSchema.virtual("bulkFromPrice").get(function () {
  if (!this.wholesaleEnabled || !this.bulkPricing?.length) return null;
  return Math.min(...this.bulkPricing.map((s) => s.price));
});

// How much the best slab saves against retail, as a percentage
productSchema.virtual("bulkSavingPct").get(function () {
  const low = this.bulkFromPrice;
  if (!low || !this.price || low >= this.price) return 0;
  return Math.round(((this.price - low) / this.price) * 100);
});

// The smallest quantity a buyer may order. Retail sellers keep 1.
productSchema.virtual("minOrderQty").get(function () {
  if (this.wholesaleEnabled && !this.allowRetail) return this.moq || 1;
  return 1;
});

// Drives the "Low stock" pill in the catalog. With variants the figure
// that matters is the total across them, not the unused product-level one.
productSchema.virtual("isLowStock").get(function () {
  if (!this.lowStock) return false;
  const s = this.totalStock;
  return s > 0 && s <= this.lowStock;
});

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Product", productSchema);
