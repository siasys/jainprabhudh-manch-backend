const mongoose = require("mongoose");

/**
 * SadhuVihar
 * ----------
 * Sadhu ke har location / vihar record ka append-only log.
 *
 * - Har "Update Location" ek naya document banata hai, purana delete nahi hota.
 * - Sabse latest record ka snapshot Sadhu.currentLocation me bhi copy hota hai
 *   (taaki list screen pe bina extra query ke "Currently at ..." dikh sake).
 * - fromDate / toDate hone ki wajah se yahi collection aage ka schedule bhi
 *   rakh leta hai — alag collection ki zarurat nahi.
 */
const sadhuViharSchema = new mongoose.Schema(
  {
    sadhuId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sadhu",
      required: true,
    },

    // Sthan details
    placeName: {
      type: String,
      default: "",
      trim: true,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
    state: {
      type: String,
      default: "",
      trim: true,
    },
    district: {
      type: String,
      default: "",
      trim: true,
    },
    city: {
      type: String,
      default: "",
      trim: true,
    },

    // Kab se kab tak
    fromDate: {
      type: Date,
      default: null,
    },
    toDate: {
      type: Date,
      default: null,
    },

    // Geo (abhi optional — "Nearby Sadhu" feature ke liye aage bharenge)
    lat: {
      type: Number,
      default: null,
    },
    lng: {
      type: Number,
      default: null,
    },

    // Extra jaankari — "Pravachan roz subah 8 baje" jaisa
    notes: {
      type: String,
      default: "",
      trim: true,
    },

    // Sirf ek record per sadhu true rahega (controller enforce karta hai)
    isCurrent: {
      type: Boolean,
      default: false,
    },

    // Kisne update kiya — sadhu khud ya seva vyavastha wala
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Timeline query: ek sadhu ke saare records, latest pehle.
// _id tiebreaker se skip-based pagination deterministic rehti hai.
sadhuViharSchema.index({ sadhuId: 1, fromDate: -1, _id: -1 });

// "Abhi kahan hain" lookup
sadhuViharSchema.index({ sadhuId: 1, isCurrent: 1 });

// Nearby / city filter
sadhuViharSchema.index({ state: 1, city: 1 });

module.exports = mongoose.model("SadhuVihar", sadhuViharSchema);
