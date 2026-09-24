const mongoose = require("mongoose");

/**
 * Bhojanshala — 3 models
 *
 * TirthBhojanSetting → tirth apni vyavastha tay karta hai
 *                      (paisa kaise lena hai, kitni der pehle order)
 * TirthMenu          → weekly menu + kisi khaas din ka alag menu
 * TirthFoodOrder     → bhakt ka order
 *
 * Menu do tarah ka hota hai:
 *   scope: "weekly"  + weekday (0-6)  → har hafte wahi
 *   scope: "date"    + date           → us ek din ke liye, weekly ko dhak deta hai
 */

const MEALS = ["breakfast", "lunch", "dinner"];

/* ================================================================== */
/*  1. SETTINGS                                                       */
/* ================================================================== */

const tirthBhojanSettingSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      unique: true,
      index: true,
    },

    // bhojanshala chalu hai ya nahi
    isActive: { type: Boolean, default: true },

    // paisa kaise — tirth khud tay karta hai
    chargeType: {
      type: String,
      enum: ["free", "perThali", "perItem"],
      default: "free",
    },
    // perThali wale case me
    thaliPrice: { type: Number, default: 0, min: 0 },
    // free wale case me kya likha dikhe
    freeNote: { type: String, default: "Bhojan is offered as bhent" },

    // har meal ka samay
    timings: {
      breakfast: { type: String, default: "08:00" },
      lunch: { type: String, default: "12:00" },
      dinner: { type: String, default: "19:30" },
    },

    // order kitne ghante pehle karna hoga
    cutoffHours: { type: Number, default: 3, min: 0 },

    // menu se hatke kuch banwane ki ijazat
    customAllowed: { type: Boolean, default: true },
    customNote: {
      type: String,
      default: "Special requests are subject to availability",
    },

    // bahar wale log bhi order kar sakte hain?
    outsideAllowed: { type: Boolean, default: true },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

/* ================================================================== */
/*  2. MENU                                                           */
/* ================================================================== */

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // perItem wale case me
    price: { type: Number, default: 0, min: 0 },
    // roti, sabzi, mithai wagera — sirf dikhane ke liye
    kind: { type: String, default: "" },
    isAvailable: { type: Boolean, default: true },
  },
  { _id: true },
);

const tirthMenuSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },

    scope: {
      type: String,
      enum: ["weekly", "date"],
      default: "weekly",
      index: true,
    },
    // scope = weekly par — 0 = Sunday ... 6 = Saturday
    weekday: { type: Number, min: 0, max: 6, default: null },
    // scope = date par — us din ka menu (UTC midnight)
    date: { type: Date, default: null },

    meal: { type: String, enum: MEALS, required: true },

    items: { type: [menuItemSchema], default: [] },

    // us din / us meal ki chhutti
    isClosed: { type: Boolean, default: false },
    closedReason: { type: String, default: "" },

    note: { type: String, default: "" },

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

// ek tirth + ek din + ek meal ka sirf ek menu
tirthMenuSchema.index({ tirthId: 1, scope: 1, weekday: 1, meal: 1 });
tirthMenuSchema.index({ tirthId: 1, scope: 1, date: 1, meal: 1 });

/* ================================================================== */
/*  3. ORDER                                                          */
/* ================================================================== */

const orderItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    price: { type: Number, default: 0 },
  },
  { _id: false },
);

const ORDER_STATUSES = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "delivered",
  "rejected",
  "cancelled",
];

const tirthFoodOrderSchema = new mongoose.Schema(
  {
    orderCode: { type: String, unique: true, index: true },

    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },
    tirthName: { type: String, default: "" },
    tirthCity: { type: String, default: "" },
    tirthState: { type: String, default: "" },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    phone: { type: String, required: true },

    /* kab ka khana */
    date: { type: Date, required: true, index: true },
    meal: { type: String, enum: MEALS, required: true },

    /* kya chahiye */
    items: { type: [orderItemSchema], default: [] },
    // menu se hatke kuch banwana ho
    customRequest: { type: String, default: "" },

    persons: { type: Number, default: 1, min: 1 },
    note: { type: String, default: "" },

    /* paisa — order ke waqt ka snapshot */
    chargeType: {
      type: String,
      enum: ["free", "perThali", "perItem"],
      default: "free",
    },
    amount: { type: Number, default: 0 },

    /* kahan pahunchana hai */
    deliverTo: {
      type: String,
      enum: ["bhojanshala", "room"],
      default: "bhojanshala",
    },
    roomNumber: { type: String, default: "" },

    // is tirth me thehre hue hain — inhe pehle dikhate hain
    hasBooking: { type: Boolean, default: false },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TirthBooking",
      default: null,
    },

    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: "pending",
      index: true,
    },
    rejectReason: { type: String, default: "" },

    isReadByTirth: { type: Boolean, default: false },
  },
  { timestamps: true },
);

tirthFoodOrderSchema.index({ tirthId: 1, date: 1, meal: 1, status: 1 });
tirthFoodOrderSchema.index({ userId: 1, createdAt: -1 });

// BH + 6 digit
tirthFoodOrderSchema.pre("validate", function (next) {
  if (!this.orderCode) {
    this.orderCode = `BH${Math.floor(100000 + Math.random() * 900000)}`;
  }
  next();
});

/* ================================================================== */
module.exports = {
  MEALS,
  ORDER_STATUSES,
  TirthBhojanSetting: mongoose.model(
    "TirthBhojanSetting",
    tirthBhojanSettingSchema,
  ),
  TirthMenu: mongoose.model("TirthMenu", tirthMenuSchema),
  TirthFoodOrder: mongoose.model("TirthFoodOrder", tirthFoodOrderSchema),
};