const mongoose = require("mongoose");

/**
 * Tirth Announcement
 * Tirth manager koi soochna deta hai — utsav, pravachan, band rehne ki khabar.
 * Home feed me sabse upar dikhti hai, aur `expiresAt` ke baad apne aap hat jati hai.
 *
 * Ye TirthPost se alag hai — post ek social post hai (like/comment ke saath),
 * announcement sirf ek notice hai.
 */

const CATEGORIES = [
  "general", // aam soochna
  "event", // utsav / karyakram
  "pravachan", // pravachan / sadhu aagman
  "closure", // tirth band / darshan band
  "urgent", // zaroori khabar
];

const tirthAnnouncementSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },

    // snapshot — tirth ka naam badle to bhi purani announcement readable rahe
    tirthName: { type: String, default: "" },
    tirthCity: { type: String, default: "" },
    tirthState: { type: String, default: "" },
    tirthPhoto: { type: String, default: "" },

    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },

    category: {
      type: String,
      enum: CATEGORIES,
      default: "general",
    },

    // optional — poster / banner
    image: { type: String, default: "" },

    // kis din ka karyakram hai (optional)
    eventDate: { type: Date, default: null },

    // is date ke baad feed se hat jayegi
    expiresAt: { type: Date, required: true, index: true },

    // manager chahe to upar pin kar sakta hai
    isPinned: { type: Boolean, default: false },

    views: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true },
);

tirthAnnouncementSchema.index({ status: 1, expiresAt: 1, createdAt: -1 });
tirthAnnouncementSchema.index({ tirthId: 1, status: 1, createdAt: -1 });

/* abhi live hai ya expire ho chuki */
tirthAnnouncementSchema.virtual("isExpired").get(function () {
  return this.expiresAt < new Date();
});

module.exports = mongoose.model("TirthAnnouncement", tirthAnnouncementSchema);
module.exports.CATEGORIES = CATEGORIES;
