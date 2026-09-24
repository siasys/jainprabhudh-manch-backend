const mongoose = require("mongoose");

/**
 * ═══════════════════════════════════════════════════════════════
 *  PANCHANG EVENT
 *  Tithi / paksh / nakshatra automatically calculate hote hain
 *  (utils/jainPanchangCalc.js se). Ye model sirf un cheezon ke
 *  liye hai jo calculation se nahi aa sakti:
 *    • Trust ke apne parv aur unki confirmed date
 *    • Auto-detect parv ki date correction (isOverride)
 *    • Local events, mahotsav, panch kalyanak, vihar etc.
 * ═══════════════════════════════════════════════════════════════
 */

const PanchangEventSchema = new mongoose.Schema(
  {
    // "YYYY-MM-DD" — query fast rakhne ke liye string me store
    dateKey: {
      type: String,
      required: true,
      index: true,
    },
    date: {
      type: Date,
    },
    // Multi-day parv (Das Lakshan, Paryushan) ke liye
    endDateKey: {
      type: String,
      default: null,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    // "Digambar" | "Shwetambar" | "Both"
    tradition: {
      type: String,
      default: "Both",
    },
    // Optional — jab kisi ek panth ki date alag ho
    panth: {
      type: String,
      default: "",
    },
    // "parv" | "vrat" | "jayanti" | "kalyanak" | "event" | "other"
    type: {
      type: String,
      default: "parv",
    },
    // true = is din ke auto-calculated parv hata do, sirf yahi dikhao
    // (auto-detect ki date galat ho to isse sudhara jaata hai)
    isOverride: {
      type: Boolean,
      default: false,
    },
    // Jab trust ki tithi calculation se alag ho
    overrideTithi: {
      tithiName: { type: String, default: "" },
      tithiNum: { type: Number, default: 0 },
      paksh: { type: String, default: "" },
      masa: { type: String, default: "" },
    },
    imageUrl: {
      type: String,
    },
    isHoliday: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

// Month range queries fast karne ke liye
PanchangEventSchema.index({ dateKey: 1, tradition: 1, isActive: 1 });

module.exports = mongoose.model("PanchangEvent", PanchangEventSchema);
