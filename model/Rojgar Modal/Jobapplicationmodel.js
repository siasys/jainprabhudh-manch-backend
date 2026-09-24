const mongoose = require("mongoose");

const jobApplicationSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rojgar",
      required: true,
    },
    applicant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jainAadhar: {
      type: String,
    },
    applicantName: {
      type: String,
    },
    applicantContact: {
      type: String,
    },
    applicantEmail: {
      type: String,
    },
    coverNote: {
      type: String,
    },
    resume: {
      type: String,
    },
    status: {
      type: String,
      enum: ["applied", "shortlisted", "rejected", "hired"],
      default: "applied",
    },
  },
  { timestamps: true },
);

jobApplicationSchema.index({ job: 1, applicant: 1 }, { unique: true });

module.exports = mongoose.model("JobApplication", jobApplicationSchema);
