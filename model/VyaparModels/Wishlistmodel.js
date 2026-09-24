const mongoose = require("mongoose");

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    items: [
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
        // Frozen copy so a saved item still renders if the seller later
        // hides or deletes the product.
        snapshot: {
          name: String,
          photo: String,
          category: String,
          price: Number,
          mrp: Number,
        },
        addedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Wishlist", wishlistSchema);
