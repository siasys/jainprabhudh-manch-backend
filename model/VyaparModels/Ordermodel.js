const mongoose = require("mongoose");

// One Order = one seller. A cart with 3 sellers creates 3 Orders
// sharing the same groupId, so each seller only ever sees their own.
const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Which option was bought. Kept so the seller knows what to pack and
    // the buyer can reorder the same one.
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    variantLabel: { type: String, default: "" },
    // Snapshot — the order stays intact even if the product is later edited or deleted
    name: { type: String, required: true },
    photo: { type: String, default: "" },
    price: { type: Number, required: true },
    mrp: { type: Number, default: 0 },
    unit: { type: String, default: "piece" },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      index: true,
    },
    // Links the sibling orders created from one checkout
    groupId: {
      type: String,
      index: true,
    },
    // How many orders that checkout produced, and which one this is.
    // Lets the buyer see "Order 2 of 3" instead of what looks like a
    // duplicate charge when a cart spans several sellers.
    groupSize: {
      type: Number,
      default: 1,
      min: 1,
    },
    groupIndex: {
      type: Number,
      default: 1,
      min: 1,
    },

    // ── Parties ────────────────────────────────────────────────
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vyaparId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JainVyapar",
      required: true,
      index: true,
    },

    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },

    // ── Shipping address snapshot ──────────────────────────────
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
      landmark: String,
    },

    // ── Contents ───────────────────────────────────────────────
    items: {
      type: [orderItemSchema],
      validate: (v) => Array.isArray(v) && v.length > 0,
    },

    // ── Money ──────────────────────────────────────────────────
    subtotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    // Charged once per checkout, stamped on the first seller order
    codFee: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    couponCode: { type: String, default: "" },

    // ── Payment ────────────────────────────────────────────────
    paymentMethod: {
      type: String,
      enum: ["cod", "online"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    razorpayOrderId: { type: String, default: "" },
    razorpayPaymentId: { type: String, default: "" },
    razorpaySignature: { type: String, default: "" },

    // ── Fulfilment ─────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        "placed",
        "confirmed",
        "packed",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "placed",
      index: true,
    },
    statusHistory: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        note: String,
      },
    ],

    shippingMode: {
      type: String,
      enum: ["jaintva", "self"],
      default: "jaintva",
    },
    courierName: { type: String, default: "" },
    trackingNumber: { type: String, default: "" },
    pickupRequestedAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    cancelReason: { type: String, default: "" },
  },
  { timestamps: true },
);

// Seller order board: newest first within a status
orderSchema.index({ vyaparId: 1, status: 1, createdAt: -1 });
// Customer order list
orderSchema.index({ userId: 1, createdAt: -1 });

// ── Order number: JT-YYMMDD-XXXXX ────────────────────────────
// Exported so the controller can stamp numbers before insertMany —
// insertMany skips save middleware in some Mongoose versions.
function makeOrderNumber() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `JT-${yy}${mm}${dd}-${rand}`;
}

// Zero-arg synchronous hook — behaves the same on Mongoose 6 through 9
// and also fires on validateSync(). A `function (next)` signature breaks
// on Mongoose 9.
orderSchema.pre("validate", function () {
  if (!this.orderNumber) this.orderNumber = makeOrderNumber();
});

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
module.exports.makeOrderNumber = makeOrderNumber;
