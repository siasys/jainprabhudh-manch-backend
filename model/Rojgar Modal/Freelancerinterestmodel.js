const mongoose = require("mongoose");

const freelancerInterestSchema = new mongoose.Schema(
  {
    freelancer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Freelancer",
      required: true,
    },
    interestedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: {
      type: String,
    },
  },
  { timestamps: true },
);

// Ek user ek freelancer post par ek hi baar interest de sake
freelancerInterestSchema.index(
  { freelancer: 1, interestedUser: 1 },
  { unique: true },
);

module.exports = mongoose.model("FreelancerInterest", freelancerInterestSchema);
