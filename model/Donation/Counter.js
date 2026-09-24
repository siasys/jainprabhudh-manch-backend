const mongoose = require("mongoose");

// Atomic sequence counter for receipt numbers (per financial year)
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. "donationReceipt_2025-26"
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("Counter", counterSchema);
