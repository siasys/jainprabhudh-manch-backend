const mongoose = require("mongoose");

const JainGranthSchema = new mongoose.Schema(
  {
    title: {
      type: String,
    },
    description: {
      type: String, // New field added
    },
    fileUrl: {
      type: String,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("JainGranth", JainGranthSchema);
