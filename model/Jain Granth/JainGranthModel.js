const mongoose = require("mongoose");

const JainGranthSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    title: {
      type: String,
    },
    jainShravakId:{
        type: String
    },
    description: {
      type: String,
    },
    mulJain: {
      type: String,
    },
    panth: {
      type: String,
    },
    author: {
      type: String,
    },
    publisher:{
      type: String,
    },
    fileUrl: {
      type: String,
    },
    imageUrl: {
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
