const mongoose = require("mongoose");

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
      required: true,
    },
    // Which option of the product — 500 g vs 5 kg, S vs XL. Null for
    // products without variants, so old rows keep working untouched.
    //
    // ⚠️ The same product in two sizes is two cart lines. Matching on
    //    productId alone would merge them and charge one price for both.
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Snapshot of the label, so the cart still reads "5 kg" even if the
    // seller renames or removes that option later.
    variantLabel: { type: String, default: "" },

    qty: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    // Price locked at add-time so a seller price change mid-session
    // doesn't silently move the cart total under the buyer.
    priceAtAddTime: { type: Number, required: true },
    mrpAtAddTime: { type: Number, default: 0 },
  },
  { _id: true, timestamps: true },
);

const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    items: [cartItemSchema],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Cart", cartSchema);
