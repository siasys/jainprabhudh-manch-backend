const mongoose = require("mongoose");

/**
 * SadhuNiyam
 * ----------
 * Sadhu ka roz ka niyam / pachkhan / sandesh.
 *
 * Alag collection isliye hai (Sadhu model me array nahi):
 *  - Har din naya entry banta hai, array me daalte gaye to document
 *    bahut bada ho jaata aur 16MB limit ke paas pahunch jaata
 *  - Date-wise fetch chahiye ("aaj ka niyam")
 *  - Pagination chahiye
 *  - Aage user side pe "aaj ke saare niyam" wali feed ban sakti hai
 *
 * Media do tarah se aa sakta hai:
 *  - Upload (audio/short video) -> S3 pe jaata hai, mediaUrl bharta hai
 *  - Link (YouTube etc.)        -> mediaLink me store hota hai
 */
const sadhuNiyamSchema = new mongoose.Schema(
  {
    sadhuId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sadhu",
      required: true,
    },

    // Niyam / Pachkhan / Pravachan / Sandesh
    niyamType: {
      type: String,
      enum: ["Niyam", "Pachkhan", "Pravachan", "Sandesh"],
      default: "Niyam",
    },

    title: {
      type: String,
      default: "",
      trim: true,
    },

    // Main text — sadhu ka likha hua niyam
    niyamText: {
      type: String,
      default: "",
      trim: true,
    },

    // Kis din ka niyam hai. Default aaj.
    niyamDate: {
      type: Date,
      default: Date.now,
    },

    // Jain tithi — "Shukla Panchami" jaisa, optional
    tithi: {
      type: String,
      default: "",
      trim: true,
    },

    /* ── Media (dono optional) ── */

    // S3 pe upload hui file
    mediaUrl: {
      type: String,
      default: "",
    },
    mediaType: {
      type: String,
      enum: ["audio", "video", "none"],
      default: "none",
    },
    // Sirf display ke liye — "2:34"
    duration: {
      type: String,
      default: "",
    },

    // YouTube / Drive ka link (upload ke bajaye)
    mediaLink: {
      type: String,
      default: "",
    },

    /* ── Display control ── */

    // Pinned entry hamesha upar dikhti hai
    isPinned: {
      type: Boolean,
      default: false,
    },

    // Draft ho to public profile pe nahi dikhega
    isPublished: {
      type: Boolean,
      default: true,
    },

    viewCount: {
      type: Number,
      default: 0,
    },

    // Kisne post kiya — sadhu khud ya seva vyavastha wala
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Timeline query: ek sadhu ke saare niyam, latest pehle.
// _id tiebreaker se skip-based pagination deterministic rehti hai.
sadhuNiyamSchema.index({ sadhuId: 1, niyamDate: -1, _id: -1 });

// Pinned entries upar laane ke liye
sadhuNiyamSchema.index({ sadhuId: 1, isPinned: -1, niyamDate: -1 });

// Aage "aaj ke saare niyam" wali feed ke liye
sadhuNiyamSchema.index({ niyamDate: -1, isPublished: 1 });

module.exports = mongoose.model("SadhuNiyam", sadhuNiyamSchema);
