const mongoose = require("mongoose");

const ScholarshipSponsorSchema = new mongoose.Schema(
  {
    sponsorName: {
      type: String,
      required: true,
      trim: true,
    },

    inMemoryOf: {
      type: String,
      trim: true,
      default: null,
    },

    occasion: {
      type: String,
      trim: true,
      default: null,
    },

    address: {
      type: String,
      required: true,
      trim: true,
    },

    contactNumber: {
      type: String,
    },

    totalSponsorshipAmount: {
      type: Number,
      required: true,
    },

    numberOfStudents: {
      type: Number,
    },

    sponsorshipType: {
      type: String,
      enum: ["yearly", "monthly", "one-time"],
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    sponsorImage: {
      // spelling correct kar diya
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ScholarshipSponsor", ScholarshipSponsorSchema);
