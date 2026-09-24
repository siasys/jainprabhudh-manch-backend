const mongoose = require("mongoose");

/**
 * ScreenTime
 * ------------------------------------------------------------------
 * Ek user + ek LOCAL date = ek document. seconds $inc hote rehte hain.
 *
 * User document ke andar array me nahi rakha, kyunki har din ek entry
 * banti hai (1 saal = 365 entries per user). User doc har feed/profile
 * call par load hota hai, isliye usko halka rakhna zaroori hai.
 *
 * File path: model/UserRegistrationModels/screenTimeModel.js
 */
const screenTimeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // client ki LOCAL date 'YYYY-MM-DD' (NRI users ke liye timezone sahi rahe)
    date: {
      type: String,
      required: true,
    },
    seconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    platform: {
      type: String,
      default: "unknown",
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

// ek user ka ek din me sirf ek hi row
screenTimeSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports =
  mongoose.models.ScreenTime || mongoose.model("ScreenTime", screenTimeSchema);
