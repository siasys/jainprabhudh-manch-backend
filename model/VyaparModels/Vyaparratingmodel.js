const mongoose = require("mongoose");

/**
 * Vyapar Rating Model
 * Stores individual user ratings (1–5 stars) for a business.
 *
 * Design:
 *  - One rating per (vyaparId + userId) — enforced by compound unique index.
 *  - Re-rating by same user updates the existing doc (upsert in controller).
 *  - Average is NEVER stored on JainVyapar — always computed from this collection
 *    via aggregation. Single source of truth; no sync issues.
 *  - `text` field is optional, kept for future "review with comment" feature
 *    without needing a schema migration.
 */
const businessRatingSchema = new mongoose.Schema(
  {
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
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    text: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
  },
  { timestamps: true },
);

businessRatingSchema.index({ vyaparId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("BusinessRating", businessRatingSchema);
