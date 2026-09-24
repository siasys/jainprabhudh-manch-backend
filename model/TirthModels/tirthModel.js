const mongoose = require("mongoose");

/**
 * Tirth Model — naye form (Tirthform.jsx / TirthEdit.jsx) ke structure ke hisaab se.
 *
 * NOTE:
 * - Rooms yahan store NAHI hote. Bookable rooms ke liye alag `TirthRoom` model hai
 *   (Manage → Rooms se manage hote hain). Yahan sirf "accommodation hai ya nahi"
 *   + amenities + halls/capacity rehte hain.
 * - `acc.hallCount` / `acc.yatriCapacity` ManageRooms ke "Property Info" se update hote hain.
 */

/* ---------------- Sub-schemas ---------------- */

const basicSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true }, // Tirth Name
    trust: { type: String, default: "" }, // Trust / Sanstha Name
    year: { type: String, default: "" }, // Establishment Year
    sect: {
      // Digambar / Shwetambar
      type: String,
      enum: ["digambar", "shwetambar", "other"],
      default: "shwetambar",
    },
    type: {
      type: String,
      enum: ["mandir", "tirth", "isthanak", "other"], // naya
      default: "tirth",
    },
    kshetra: {
      type: String,
      enum: ["", "siddha", "atishay", "kala", "nirvan", "other"],
      default: "",
    },
    mulnayak: { type: String, default: "" },
    famousFor: { type: String, default: "" },
    history: { type: String, default: "" },
  },
  { _id: false },
);

const contactSchema = new mongoose.Schema(
  {
    primary: { type: String, default: "" },
    secondary: { type: String, default: "" },
    email: { type: String, default: "" },
    website: { type: String, default: "" },
  },
  { _id: false },
);

const addressSchema = new mongoose.Schema(
  {
    country: { type: String, default: "India" },
    state: { type: String, default: "" },
    district: { type: String, default: "" },
    city: { type: String, default: "" },
    fullAddress: { type: String, default: "" },
    pincode: { type: String, default: "" },
    mapLink: { type: String, default: "" }, // Google Map link ya "lat, lng"
  },
  { _id: false },
);

const templeSchema = new mongoose.Schema(
  {
    count: { type: String, default: "" }, // Number of temples
    mainName: { type: String, default: "" },
    mulnayak: { type: String, default: "" },
    openingTime: { type: String, default: "" }, // "05:30" (HH:mm)
    closingTime: { type: String, default: "" },
    darshanTime: { type: String, default: "" },
    aartiTime: { type: String, default: "" },
    abhishekTime: { type: String, default: "" },
    pravachanTime: { type: String, default: "" },
  },
  { _id: false },
);

// Accommodation — sirf amenities + halls/capacity (rooms alag model me)
const accSchema = new mongoose.Schema(
  {
    lift: { type: Boolean, default: false },
    wheelchair: { type: Boolean, default: false },
    hotWater: { type: Boolean, default: false },
    parking: { type: Boolean, default: false },

    // ManageRooms → Property Info se update hote hain
    hallCount: { type: String, default: "" },
    yatriCapacity: { type: String, default: "" },
  },
  { _id: false },
);

const bhojSchema = new mongoose.Schema(
  {
    breakfast: { type: Boolean, default: false },
    breakfastTime: { type: String, default: "" },
    lunch: { type: Boolean, default: false },
    lunchTime: { type: String, default: "" },
    dinner: { type: Boolean, default: false },
    dinnerTime: { type: String, default: "" },

    charges: { type: String, default: "" }, // "₹50 per person" / "Free"
    couponRequired: { type: Boolean, default: false },
    jainFoodOnly: { type: Boolean, default: false },
    advanceBooking: { type: Boolean, default: false },
  },
  { _id: false },
);

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    fromClass: { type: String, default: "" },
    toClass: { type: String, default: "" },
  },
  { _id: false },
);

const hostelSchema = new mongoose.Schema(
  {
    hostelFor: {
      type: String,
      enum: ["", "Girls", "Boys", "Both"],
      default: "",
    },
    capacity: { type: String, default: "" },
    manager: {
      type: String,
      enum: ["Tirth Management", "School"],
      default: "Tirth Management",
    },
    // agar School manage karti ho
    orgName: { type: String, default: "" },
    distance: { type: String, default: "" },
    contact: { type: String, default: "" },
  },
  { _id: false },
);

const nearbyInfoSchema = new mongoose.Schema(
  {
    railway: { type: String, default: "" },
    railwayDist: { type: String, default: "" },
    airport: { type: String, default: "" },
    airportDist: { type: String, default: "" },
    busStand: { type: String, default: "" },
    busDist: { type: String, default: "" },
  },
  { _id: false },
);

const transportSchema = new mongoose.Schema(
  {
    type: { type: String, default: "" }, // Bus / Taxi / Auto
    timing: { type: String, default: "" },
    charges: { type: String, default: "" },
  },
  { _id: false },
);

const teamSchema = new mongoose.Schema(
  {
    presName: { type: String, default: "" },
    presPhone: { type: String, default: "" },
    secName: { type: String, default: "" },
    secPhone: { type: String, default: "" },
    managerName: { type: String, default: "" },
    managerPhone: { type: String, default: "" },

    bookingContact: { type: String, default: "" }, // booking ke liye phone
    emergencyContact: { type: String, default: "" },
    officeTiming: { type: String, default: "" },
    officeEmail: { type: String, default: "" },
  },
  { _id: false },
);

/* ---------------- Main schema ---------------- */

const tirthSchema = new mongoose.Schema(
  {
    basic: { type: basicSchema, default: () => ({}) },
    contact: { type: contactSchema, default: () => ({}) },
    address: { type: addressSchema, default: () => ({}) },
    temple: { type: templeSchema, default: () => ({}) },

    accOn: { type: Boolean, default: false },
    acc: { type: accSchema, default: () => ({}) },

    bhojOn: { type: Boolean, default: false },
    bhoj: { type: bhojSchema, default: () => ({}) },

    /**
     * Facilities — 18 checkboxes (Library, Medical, Gaushala, Garden, Parking,
     * "RO Water", Lift, Wheelchair, CCTV, Locker, Wifi, "Cloak Room",
     * "Shoe Stand", "Bath Facility", "EV Charging (Future)", ...)
     * Map isliye taaki aage nayi facility add karne par schema na badalna pade.
     * Query: { "facilities.Library": true }
     */
    facilities: {
      type: Map,
      of: Boolean,
      default: () => new Map(),
    },

    schoolOn: { type: Boolean, default: false },
    school: { type: schoolSchema, default: () => ({}) },

    hostelOn: { type: Boolean, default: false },
    hostel: { type: hostelSchema, default: () => ({}) },

    nearbyInfo: { type: nearbyInfoSchema, default: () => ({}) },

    transportOn: { type: Boolean, default: false },
    transports: { type: [transportSchema], default: [] },

    team: { type: teamSchema, default: () => ({}) },

    photos: { type: [String], default: [] },

    /* ---------------- meta (purane jaisa hi) ---------------- */
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    applicationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    // JPM kitna percent rakhega — admin panel se set hota hai.
    // Default 0: jab tak admin khud set na kare, koi commission nahi
    donationCommissionPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    reviewNotes: {
      text: String,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewedAt: Date,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true },
);

/* ---------------- Indexes ---------------- */
tirthSchema.index({ "address.state": 1, "address.city": 1, status: 1 });
tirthSchema.index({ "basic.sect": 1, status: 1 });
tirthSchema.index({
  "basic.name": "text",
  "address.city": "text",
  "address.state": "text",
});

/* ---------------- Helpers ---------------- */

// list/card ke liye chhota object
tirthSchema.methods.toCard = function () {
  return {
    _id: this._id,
    name: this.basic?.name || "",
    sect: this.basic?.sect || "",
    type: this.basic?.type || "",
    city: this.address?.city || "",
    district: this.address?.district || "",
    state: this.address?.state || "",
    country: this.address?.country || "",
    photo: this.photos?.[0] || "",
    status: this.status,
  };
};

module.exports = mongoose.model("Tirth", tirthSchema);
