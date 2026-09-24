const mongoose = require("mongoose");

/**
 * SadhuNiyamTaker
 * ---------------
 * Kaunse shravak ne kaunsa niyam liya.
 *
 * Alag collection isliye hai (SadhuNiyam me array nahi):
 *  - Ek lokpriya niyam sau-hazaar log le sakte hain, array me daalne se
 *    document 16MB limit ki taraf badhta jaata
 *  - Takers ki list me pagination chahiye
 *  - "maine ye niyam liya ya nahi" ek chhoti si query se pata chal jaata hai
 *
 * Ek user ek niyam sirf ek baar le sakta hai — compound unique index
 * isko database level pe hi rok deta hai, chahe do request ek saath aa jaayein.
 */
const sadhuNiyamTakerSchema = new mongoose.Schema(
  {
    niyamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SadhuNiyam",
      required: true,
    },

    // Kis sadhu ka niyam hai — bina lookup ke count ke liye
    sadhuId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sadhu",
      required: true,
    },

    // Kisne liya
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    takenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Ek user ek niyam sirf ek baar le sake
sadhuNiyamTakerSchema.index({ niyamId: 1, userId: 1 }, { unique: true });

// Takers list — latest pehle. _id tiebreaker se pagination deterministic
sadhuNiyamTakerSchema.index({ niyamId: 1, takenAt: -1, _id: -1 });

// "Maine kaunse niyam liye hain" — aage user side pe kaam aayega
sadhuNiyamTakerSchema.index({ userId: 1, takenAt: -1 });

module.exports = mongoose.model("SadhuNiyamTaker", sadhuNiyamTakerSchema);
