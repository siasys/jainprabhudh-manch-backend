const mongoose = require("mongoose");

/**
 * Tirth Complaint
 * User kisi tirth ke baare me shikayat karta hai.
 * Tirth manager use Manage → Complaints me dekhta hai aur jawab deta hai.
 * Dono ko notification jati hai.
 */

const CATEGORIES = [
  "cleanliness", // safai
  "staff", // staff ka vyavhaar
  "food", // bhojanshala
  "room", // kamre / accommodation
  "booking", // booking me dikkat
  "facility", // suvidhaayein
  "other",
];

const STATUSES = ["open", "in_progress", "resolved", "closed"];

const tirthComplaintSchema = new mongoose.Schema(
  {
    // chhota readable code — user apni complaint track kar sake
    complaintCode: { type: String, unique: true, index: true },

    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },
    // snapshot — user ki list me tirth ka naam dikhane ke liye
    tirthName: { type: String, default: "" },
    tirthCity: { type: String, default: "" },
    tirthState: { type: String, default: "" },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userName: { type: String, default: "" },
    userPhone: { type: String, default: "" },

    /* agar is user ki is tirth me booking hai to ye true —
       aisi complaints manager ki list me upar dikhti hain */
    hasBooking: { type: Boolean, default: false },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TirthBooking",
      default: null,
    },

    category: {
      type: String,
      enum: CATEGORIES,
      default: "other",
    },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: STATUSES,
      default: "open",
      index: true,
    },

    /* tirth ka jawab */
    response: {
      text: { type: String, default: "" },
      respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      respondedAt: { type: Date, default: null },
    },

    // user ne jawab padh liya ya nahi
    isReadByUser: { type: Boolean, default: false },
    // manager ne complaint padh li ya nahi
    isReadByTirth: { type: Boolean, default: false },
  },
  { timestamps: true },
);

tirthComplaintSchema.index({ tirthId: 1, status: 1, createdAt: -1 });
tirthComplaintSchema.index({ userId: 1, createdAt: -1 });

// TC + 6 digit
tirthComplaintSchema.pre("validate", function (next) {
  if (!this.complaintCode) {
    const rand = Math.floor(100000 + Math.random() * 900000);
    this.complaintCode = `TC${rand}`;
  }
  next();
});

module.exports = mongoose.model("TirthComplaint", tirthComplaintSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
