const mongoose = require("mongoose");

/**
 * Tirth Puja Booking — 2 models
 *
 * TirthPujaType    → manager set karta hai ki kaunsi puja hoti hai, kis samay,
 *                    kitne log, aur labh rashi kitni
 * TirthPujaBooking → bhakt ki booking
 *
 * Jain paddhati ke hisaab se:
 *  - paisa "price" nahi, "Labh Rashi" hai
 *  - puja fixed muhurat me hoti hai, isliye slot-based hai
 *  - Digambar aur Shwetambar ki pujaen alag hain
 *  - abhishek ke shuddhi niyam bookings ke waqt dikhane hote hain
 */

/* ================================================================== */
/*  1. PUJA TYPE                                                      */
/* ================================================================== */

// kis paddhati ki puja hai
const SECTS = ["digambar", "shwetambar", "both", "other"];

const timeSlotSchema = new mongoose.Schema(
  {
    // "07:30"
    startTime: { type: String, required: true },
    endTime: { type: String, default: "" },
    // is slot me ek din me kitni bookings
    maxBookings: { type: Number, default: 1, min: 1 },
  },
  { _id: true },
);

const tirthPujaTypeSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    sect: { type: String, enum: SECTS, default: "both" },

    // Labh Rashi — Jain me ise "price" nahi kehte
    labhRashi: { type: Number, default: 0, min: 0 },

    // lagbhag kitni der
    durationMinutes: { type: Number, default: 60 },

    timeSlots: { type: [timeSlotSchema], default: [] },

    // 0 = Sunday ... 6 = Saturday. khali = har din
    availableDays: { type: [Number], default: [] },

    // samagri mandir dega ya bhakt laayega
    samagriProvided: { type: Boolean, default: true },
    samagriNote: { type: String, default: "" },

    // shuddhi / vidhi ke niyam — booking se pehle dikhte hain
    niyam: { type: [String], default: [] },

    // kitne din pehle booking karni hogi
    advanceDays: { type: Number, default: 1 },

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },

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

tirthPujaTypeSchema.index({ tirthId: 1, status: 1, sortOrder: 1 });

/* ================================================================== */
/*  2. PUJA BOOKING                                                   */
/* ================================================================== */

// bhakt kis avsar par puja karva raha hai
const OCCASIONS = [
  "birthday",
  "anniversary",
  "punyatithi",
  "exam",
  "business",
  "health",
  "parv",
  "other",
];

const BOOKING_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "completed",
  "cancelled",
];

const tirthPujaBookingSchema = new mongoose.Schema(
  {
    bookingCode: { type: String, unique: true, index: true },

    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },
    tirthName: { type: String, default: "" },
    tirthCity: { type: String, default: "" },
    tirthState: { type: String, default: "" },

    pujaTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TirthPujaType",
      required: true,
    },
    // snapshot — puja type badle to bhi purani booking readable rahe
    pujaName: { type: String, default: "" },
    labhRashi: { type: Number, default: 0 },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* bhakt ki jaankari */
    name: { type: String, required: true },
    phone: { type: String, required: true },
    gotra: { type: String, default: "" },

    // sankalp kiske naam se — apne ya kisi aur ke
    sankalpName: { type: String, default: "" },

    /* kab */
    date: { type: Date, required: true, index: true },
    slotId: { type: String, default: "" },
    startTime: { type: String, default: "" },
    endTime: { type: String, default: "" },

    /* kyun */
    occasion: { type: String, enum: OCCASIONS, default: "other" },
    occasionNote: { type: String, default: "" },

    /* ---- recurring ---- */
    // once = ek hi baar | monthly = har mahine | yearly = har saal
    repeatType: {
      type: String,
      enum: ["once", "monthly", "yearly"],
      default: "once",
    },
    // ek series ki saari bookings ka common id — pehli booking ka _id
    seriesId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    // is series me ye kaunsi hai (1 se shuru)
    seriesIndex: { type: Number, default: 1 },
    // series me kul kitni bookings hain
    seriesTotal: { type: Number, default: 1 },

    persons: { type: Number, default: 1, min: 1 },
    note: { type: String, default: "" },

    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "pending",
      index: true,
    },
    rejectReason: { type: String, default: "" },

    // manager ne padh li ya nahi
    isReadByTirth: { type: Boolean, default: false },
  },
  { timestamps: true },
);

tirthPujaBookingSchema.index({ tirthId: 1, date: 1, status: 1 });
tirthPujaBookingSchema.index({ userId: 1, createdAt: -1 });
tirthPujaBookingSchema.index({ pujaTypeId: 1, date: 1, slotId: 1 });
tirthPujaBookingSchema.index({ seriesId: 1, seriesIndex: 1 });

// PJ + 6 digit
tirthPujaBookingSchema.pre("validate", function (next) {
  if (!this.bookingCode) {
    this.bookingCode = `PJ${Math.floor(100000 + Math.random() * 900000)}`;
  }
  next();
});

/* ================================================================== */
module.exports = {
  SECTS,
  OCCASIONS,
  BOOKING_STATUSES,
  TirthPujaType: mongoose.model("TirthPujaType", tirthPujaTypeSchema),
  TirthPujaBooking: mongoose.model("TirthPujaBooking", tirthPujaBookingSchema),
};
