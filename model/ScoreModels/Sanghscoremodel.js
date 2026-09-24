const mongoose = require("mongoose");

/**
 * SanghScoreModel.js
 * ----------------------------------------------------------------------------
 * NAYA model — koi purana model touch nahi hua.
 * Har sangh ka daily / monthly / yearly score record yahan store hota hai.
 *
 * periodType:
 *   'daily'   → ek din ka record   (periodKey: "2026-07-13")
 *   'monthly' → ek mahine ka record (periodKey: "2026-07")
 *   'yearly'  → ek saal ka record   (periodKey: "2026")
 * ----------------------------------------------------------------------------
 */

/** 16 fields ke raw counts (kitni baar hua) */
const countsSchema = new mongoose.Schema(
  {
    // ── AUTO (5) ──
    sanghCreate: { type: Number, default: 0 },
    memberCreate: { type: Number, default: 0 },
    membershipFees: { type: Number, default: 0 },
    shravakCard: { type: Number, default: 0 },
    panchCreate: { type: Number, default: 0 },

    // ── MANUAL (10 counts + donation amount) ──
    officialVisit: { type: Number, default: 0 },
    meetings: { type: Number, default: 0 },
    projects: { type: Number, default: 0 },
    trainings: { type: Number, default: 0 },
    tirthAccount: { type: Number, default: 0 },
    businessAccount: { type: Number, default: 0 },
    sadhuAccount: { type: Number, default: 0 },
    matrimonyRegister: { type: Number, default: 0 },
    employmentRegister: { type: Number, default: 0 },
    scholarshipRegister: { type: Number, default: 0 },

    // donation me count nahi, AMOUNT aata hai — points slab se banenge
    donationAmount: { type: Number, default: 0 },
  },
  { _id: false },
);

/** Har field se kitne points bane — UI breakdown ke liye */
const breakdownSchema = new mongoose.Schema(
  {
    sanghCreate: { type: Number, default: 0 },
    memberCreate: { type: Number, default: 0 },
    membershipFees: { type: Number, default: 0 },
    shravakCard: { type: Number, default: 0 },
    panchCreate: { type: Number, default: 0 },
    officialVisit: { type: Number, default: 0 },
    meetings: { type: Number, default: 0 },
    projects: { type: Number, default: 0 },
    trainings: { type: Number, default: 0 },
    tirthAccount: { type: Number, default: 0 },
    businessAccount: { type: Number, default: 0 },
    sadhuAccount: { type: Number, default: 0 },
    matrimonyRegister: { type: Number, default: 0 },
    employmentRegister: { type: Number, default: 0 },
    scholarshipRegister: { type: Number, default: 0 },
    donation: { type: Number, default: 0 },
  },
  { _id: false },
);

/** Maine kis-kis upar wale sangh ko kitna bheja (ledger) */
const distributedToSchema = new mongoose.Schema(
  {
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
    },
    sanghName: String,
    level: String,
    percentage: Number, // 20 / 15 / 10
    points: Number,
  },
  { _id: false },
);

/** Mujhe kis-kis niche wale sangh se kitna mila (ledger) */
const receivedFromSchema = new mongoose.Schema(
  {
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
    },
    sanghName: String,
    level: String,
    percentage: Number,
    points: Number,
  },
  { _id: false },
);

const sanghScoreSchema = new mongoose.Schema(
  {
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
      required: true,
      index: true,
    },
    sanghName: { type: String },
    level: {
      type: String,
      enum: ["foundation", "country", "state", "district", "city", "area"],
    },
    sanghType: {
      type: String,
      enum: ["main", "women", "youth", "veerSena"],
      default: "main",
    },

    // ── PERIOD ──────────────────────────────────────────────────────
    periodType: {
      type: String,
      enum: ["daily", "monthly", "yearly"],
      required: true,
    },
    /** "2026-07-13" | "2026-07" | "2026" — dedupe ke liye */
    periodKey: { type: String, required: true },

    periodStart: { type: Date, required: true }, // range ka start (inclusive)
    periodEnd: { type: Date, required: true }, // range ka end (exclusive)

    day: { type: Number }, // sirf daily
    month: { type: Number }, // 1-12  (daily + monthly)
    year: { type: Number },

    // ── COUNTS + POINTS ─────────────────────────────────────────────
    counts: { type: countsSchema, default: () => ({}) },
    breakdown: { type: breakdownSchema, default: () => ({}) },

    /** apne kaam se kamaye points (distribution ISI par hota hai) */
    selfScore: { type: Number, default: 0 },

    /** niche wale sanghon se mile points (kabhi aage distribute NAHI hote) */
    receivedScore: { type: Number, default: 0 },

    /** selfScore + receivedScore */
    totalScore: { type: Number, default: 0 },

    /** maine upar walon ko kitna total bheja (self me se katta nahi — sirf record) */
    distributedTotal: { type: Number, default: 0 },

    distributedTo: { type: [distributedToSchema], default: [] },
    receivedFrom: { type: [receivedFromSchema], default: [] },

    // ── MONTHLY FORM LINK ───────────────────────────────────────────
    /** monthly record kis Reporting form se juda hai */
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reporting",
      default: null,
    },

    /** manual data aaya ya nahi (monthly ke liye) */
    formSubmitted: { type: Boolean, default: false },
    formSubmittedAt: { type: Date, default: null },

    /**
     * RULE: jis mahine form NAHI bhara, us mahine ka score 0 rahega
     * (auto points bhi nahi milenge, distribution bhi nahi hoga).
     * counts phir bhi save hote hain — sirf dikhane ke liye.
     */
    formMissed: { type: Boolean, default: false },

    /**
     * locked = period band ho gaya, ab score change nahi hoga.
     * monthly: 5 tareekh raat 12 ke baad lock.
     */
    locked: { type: Boolean, default: false },
    lockedAt: { type: Date, default: null },

    /** kaha se bana: cron / form / manual recalc */
    source: {
      type: String,
      enum: ["auto", "form", "recalc"],
      default: "auto",
    },
  },
  { timestamps: true },
);

// ── INDEXES ───────────────────────────────────────────────────────────
// Ek sangh ka ek period ka SIRF EK record (dedupe / re-run safe)
sanghScoreSchema.index(
  { sanghId: 1, periodType: 1, periodKey: 1 },
  { unique: true },
);
// Leaderboard / top performers ke liye
sanghScoreSchema.index({ periodType: 1, periodKey: 1, totalScore: -1 });
// Ek sangh ki history timeline
sanghScoreSchema.index({ sanghId: 1, periodType: 1, periodStart: -1 });

// ── HELPERS ───────────────────────────────────────────────────────────

/** selfScore + receivedScore se totalScore hamesha sync rakho */
sanghScoreSchema.pre("save", function (next) {
  this.totalScore = (this.selfScore || 0) + (this.receivedScore || 0);
  next();
});

/** periodKey banane ka helper — service isi ko use karega */
sanghScoreSchema.statics.buildPeriodKey = function (periodType, date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  if (periodType === "daily") return `${y}-${m}-${day}`;
  if (periodType === "monthly") return `${y}-${m}`;
  return `${y}`;
};

module.exports = mongoose.model("SanghScore", sanghScoreSchema);
