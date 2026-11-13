const mongoose = require("mongoose");

const freelancerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jainAadhar: {
      type: String,
    },
    serviceName: {
      type: String,
    },
    description: {
      type: String,
    },
    image: {
      type: String,
    },
    // Interested users tracking
    interestedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    interestedCount: {
      type: Number,
      default: 0,
    },
    // NEW: Fiverr-style profile
    skills: [{ type: String }],
    portfolio: [
      {
        title: { type: String },
        description: { type: String },
        image: { type: String },
        demoLink: { type: String },
      },
    ],
    // NEW (Fiverr-style gig): sab optional — purani posts waise hi chalengi
    category: { type: String, default: "" },
    packages: [
      {
        tier: { type: String, enum: ["basic", "standard", "premium"] },
        title: { type: String },
        description: { type: String },
        price: { type: Number, min: 0 },
        deliveryDays: { type: Number, min: 1 },
        revisions: { type: Number, min: 0 },
        features: [{ type: String }],
      },
    ],
    gallery: [{ type: String }],
    faqs: [
      {
        question: { type: String },
        answer: { type: String },
      },
    ],
    // NEW: rating system (FreelancerReview se calculate hota hai)
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Freelancer", freelancerSchema);
