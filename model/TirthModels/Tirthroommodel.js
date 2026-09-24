const mongoose = require("mongoose");

const tirthRoomSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    isAC: {
      type: Boolean,
      default: false,
    },
    hasBath: {
      type: Boolean,
      default: false,
    },
    total: {
      type: Number,
      default: 0,
      min: 0,
    },
    price: {
      type: Number,
      default: 0, // 0 = free dharamshala
      min: 0,
    },
    description: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

tirthRoomSchema.index({ tirthId: 1, status: 1 });

module.exports = mongoose.model("TirthRoom", tirthRoomSchema);
