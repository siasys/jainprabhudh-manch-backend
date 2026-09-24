const mongoose = require("mongoose");

/**
 * Tirth Employee Model
 * ManageEmployees.jsx — tirth ke staff ka record.
 * Ye sirf record-keeping hai, employee ka Jaintva account nahi banta.
 */

const ROLES = [
  "pujari",
  "manager",
  "cook",
  "cleaner",
  "guard",
  "gardener",
  "accountant",
  "helper",
  "other",
];

const tirthEmployeeSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },

    /* ---------------- basic ---------------- */
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },

    role: {
      type: String,
      enum: ROLES,
      default: "other",
    },
    // role === "other" hone par kya likha
    roleOther: { type: String, default: "" },

    salary: { type: Number, default: 0, min: 0 },
    joinDate: { type: Date, required: true },

    /* ---------------- optional ---------------- */
    photo: { type: String, default: "" },
    address: { type: String, default: "" },
    aadhar: { type: String, default: "" },
    emergencyName: { type: String, default: "" },
    emergencyPhone: { type: String, default: "" },
    note: { type: String, default: "" },

    /* ---------------- employment ---------------- */
    // active = abhi kaam kar raha, left = chhod diya
    employmentStatus: {
      type: String,
      enum: ["active", "left"],
      default: "active",
      index: true,
    },
    leaveDate: { type: Date, default: null },

    /* ---------------- meta ---------------- */
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // soft delete (baaki tirth models jaisa hi)
    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true },
);

tirthEmployeeSchema.index({ tirthId: 1, status: 1, employmentStatus: 1 });
tirthEmployeeSchema.index({ tirthId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("TirthEmployee", tirthEmployeeSchema);
module.exports.ROLES = ROLES;
