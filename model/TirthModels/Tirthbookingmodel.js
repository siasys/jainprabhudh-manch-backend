const mongoose = require("mongoose");

/**
 * Tirth Booking Model
 * Tirthbook.jsx (user request) + ManageBookings.jsx (admin approve/reject)
 * + MyBookings.jsx (user side list) — sab isi collection se chalte hain.
 */
const tirthBookingSchema = new mongoose.Schema(
  {
    bookingCode: {
      type: String,
      unique: true,
      index: true,
    },

    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TirthRoom",
      required: true,
      index: true,
    },

    // snapshot — room delete/rename hone par bhi booking readable rahe
    roomTypeName: { type: String, default: "" },
    isAC: { type: Boolean, default: false },
    hasBath: { type: Boolean, default: false },

    // snapshot of tirth (MyBookings card ke liye)
    tirthName: { type: String, default: "" },
    tirthCity: { type: String, default: "" },
    tirthState: { type: String, default: "" },
    tirthPhone: { type: String, default: "" },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    note: { type: String, default: "" },

    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true },
    nights: { type: Number, default: 1, min: 1 },

    rooms: { type: Number, default: 1, min: 1 },
    guests: { type: Number, default: 1, min: 1 },

    pricePerNight: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled", "completed"],
      default: "pending",
      index: true,
    },
    rejectReason: { type: String, default: "" },

    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    actionAt: { type: Date },
    cancelledAt: { type: Date },

    source: { type: String, default: "web" },
  },
  { timestamps: true },
);

tirthBookingSchema.index({ tirthId: 1, status: 1, createdAt: -1 });
tirthBookingSchema.index({ roomId: 1, status: 1, checkIn: 1, checkOut: 1 });
tirthBookingSchema.index({ userId: 1, createdAt: -1 });

// bookingCode auto-generate (TB + 8 digit)
tirthBookingSchema.pre("validate", function (next) {
  if (!this.bookingCode) {
    const rand = Math.floor(10000000 + Math.random() * 90000000);
    this.bookingCode = `TB${rand}`;
  }
  next();
});

module.exports =
  mongoose.models.TirthBooking ||
  mongoose.model("TirthBooking", tirthBookingSchema);