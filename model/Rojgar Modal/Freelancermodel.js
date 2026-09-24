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
  },
  { timestamps: true },
);

module.exports = mongoose.model("Freelancer", freelancerSchema);
