const mongoose = require("mongoose");

// Freelancer service par rating (1-5) aur review.
// Ek user ek service par ek hi review de sakta hai (dobara dene par wahi update hota hai).
const freelancerReviewSchema = new mongoose.Schema(
  {
    freelancer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Freelancer",
      required: true,
      index: true,
    },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 1000, default: "" },
    // Freelancer ka jawab
    reply: {
      text: { type: String, maxlength: 600 },
      at: { type: Date },
    },
  },
  { timestamps: true },
);

freelancerReviewSchema.index({ freelancer: 1, reviewer: 1 }, { unique: true });

module.exports = mongoose.model("FreelancerReview", freelancerReviewSchema);
