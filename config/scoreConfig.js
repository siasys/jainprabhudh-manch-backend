/**
 * scoreConfig.js
 * ----------------------------------------------------------------------------
 * Sangh Scoring & Reporting module ka SINGLE SOURCE OF TRUTH.
 * Points / donation range / distribution % — sab yahin se change hoga.
 * Koi bhi purani file isko touch nahi karti (fully additive).
 * ----------------------------------------------------------------------------
 */

/**
 * 16 reporting fields ke points.
 * AUTO  = system khud count karega (daily cron)
 * MANUAL = sangh president monthly form me bharega
 */
const POINTS = {
  // ── AUTO FETCH (5) ────────────────────────────────────────────────
  sanghCreate: 50, // 1 sangh create par 50
  memberCreate: 20, // 1 member add par 20
  membershipFees: 20, // 1 member ki fees collect par 20
  shravakCard: 10, // 1 shravak card (Jain Aadhar approved) par 10
  panchCreate: 50, // 1 panch create par 50 (veerSena me 0 — niche rule dekho)

  // ── MANUAL (11) ───────────────────────────────────────────────────
  officialVisit: 100,
  meetings: 100,
  projects: 200,
  trainings: 20,
  tirthAccount: 50,
  businessAccount: 50,
  sadhuAccount: 50,
  matrimonyRegister: 50,
  employmentRegister: 20,
  scholarshipRegister: 20,

  // donation ke points fixed nahi — amount ki range se aate hain (niche)
  donation: 0,
};

/** Kaun sa metric auto hai aur kaun sa manual — service/UI dono isko padhte hain */
const AUTO_FIELDS = [
  "sanghCreate",
  "memberCreate",
  "membershipFees",
  "shravakCard",
  "panchCreate",
];

const MANUAL_FIELDS = [
  "officialVisit",
  "meetings",
  "projects",
  "trainings",
  "tirthAccount",
  "businessAccount",
  "sadhuAccount",
  "matrimonyRegister",
  "employmentRegister",
  "scholarshipRegister",
  "donationAmount", // amount aata hai, points range se banenge
];

/** UI me dikhane ke liye labels (mobile + web dono use kar sakte hain) */
const FIELD_LABELS = {
  sanghCreate: "Sangh Create",
  memberCreate: "Member Create",
  membershipFees: "Membership Fees",
  shravakCard: "Shravak Card",
  panchCreate: "Panch Create",
  officialVisit: "Official Visit",
  meetings: "Meetings",
  projects: "Projects",
  trainings: "Trainings",
  tirthAccount: "Tirth Account",
  businessAccount: "Business Account",
  sadhuAccount: "Sadhu Account",
  matrimonyRegister: "Matrimony Register",
  employmentRegister: "Employment Register",
  scholarshipRegister: "Scholarship Register",
  donation: "Donation",
};

/**
 * DONATION POINTS — amount ki range ke hisaab se.
 * Ranges continuous hain (koi gap nahi, koi overlap nahi).
 * min inclusive, max inclusive. Aakhri range ka max = Infinity.
 */
const DONATION_SLABS = [
  { min: 100, max: 5000, points: 10 },
  { min: 5001, max: 10000, points: 20 },
  { min: 10001, max: 20000, points: 30 },
  { min: 20001, max: 50000, points: 40 },
  { min: 50001, max: 70000, points: 50 },
  { min: 70001, max: 100000, points: 60 },
  { min: 100001, max: 300000, points: 70 },
  { min: 300001, max: 500000, points: 80 },
  { min: 500001, max: 1000000, points: 90 },
  { min: 1000001, max: 1500000, points: 100 },
  { min: 1500001, max: 2000000, points: 110 },
  { min: 2000001, max: 5000000, points: 120 },
  { min: 5000001, max: 10000000, points: 150 },
  { min: 10000001, max: Infinity, points: 200 },
];

/**
 * Donation amount se points nikalo.
 * 100 se kam amount = 0 points.
 */
const getDonationPoints = (amount) => {
  const amt = Number(amount) || 0;
  if (amt < 100) return 0;
  const slab = DONATION_SLABS.find((s) => amt >= s.min && amt <= s.max);
  return slab ? slab.points : 0;
};

/**
 * SCORE DISTRIBUTION
 * ----------------------------------------------------------------------------
 * Niche wala sangh apne SELF SCORE ka fixed % upar ke levels ko deta hai.
 * % target level ke hisaab se hai (kitni door hai isse farak nahi padta).
 *
 *   City sangh    → district 20% + state 15% + country 10%
 *   District sangh→ state 15% + country 10%
 *   State sangh   → country 10%
 *   Country sangh → kisi ko nahi
 *
 * ZAROORI RULES:
 *  1. Distribution HAMESHA selfScore par hota hai — receivedScore par kabhi nahi.
 *  2. Upar wala sangh apna received hissa aage/niche kabhi redistribute nahi karta.
 *  3. Niche wale ka apna selfScore kam nahi hota — upar wale ko EXTRA milta hai.
 */
const DISTRIBUTION = {
  district: 20,
  state: 15,
  country: 10,
  // foundation: 0  → foundation ko kuch nahi jaata
};

/** Hierarchy ka order (upar se niche) */
const LEVEL_ORDER = [
  "foundation",
  "country",
  "state",
  "district",
  "city",
  "area",
];

/** Sangh types */
const SANGH_TYPES = ["main", "women", "youth", "veerSena"];

/**
 * PANCH RULE — veerSena sangh ko panch ke points NAHI milte (0 rahega).
 * Sirf main / women / youth ko milte hain.
 */
const PANCH_EXCLUDED_SANGH_TYPES = ["veerSena"];

const isPanchAllowed = (sanghType) =>
  !PANCH_EXCLUDED_SANGH_TYPES.includes(sanghType);

/**
 * MONTHLY FORM WINDOW
 * Har mahine ki 1 se 5 tareekh tak PICHLE mahine ka form bhara jaayega.
 * 5 tareekh raat 12:00 (यानी 6 tareekh 00:00) par window band.
 *   Example: July (1–31) ka score → form 1 Aug se 5 Aug raat 12 tak.
 */
const FORM_WINDOW = {
  startDay: 1,
  endDay: 5, // 5 tareekh ka pura din allowed; 6 tareekh 00:00 par band
};

/** Cron timings (server timezone: Asia/Kolkata) */
const CRON = {
  timezone: "Asia/Kolkata",
  daily: "0 0 * * *", // roz raat 12:00 (midnight)
  monthly: "5 0 1 * *", // har mahine ki 1 tareekh, 00:05 — pichle mahine ka snapshot
  monthlyLock: "0 0 6 * *", // 6 tareekh 00:00 — form window band + final lock
  yearly: "30 0 1 1 *", // 1 January 00:30 — pichle saal ka snapshot
};

module.exports = {
  POINTS,
  AUTO_FIELDS,
  MANUAL_FIELDS,
  FIELD_LABELS,
  DONATION_SLABS,
  getDonationPoints,
  DISTRIBUTION,
  LEVEL_ORDER,
  SANGH_TYPES,
  PANCH_EXCLUDED_SANGH_TYPES,
  isPanchAllowed,
  FORM_WINDOW,
  CRON,
};
