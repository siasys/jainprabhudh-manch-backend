const mongoose = require("mongoose");

/* ══════════════════════════════════════════════════════════════
   ✅ CITY (PATLA SCHEMA) — GeoNames data (CC BY 4.0), ek baar import
   Matrimonial "Birth Place" autocomplete ke liye.

   DB me chhote field naam (jagah bachane ke liye):
     _id = GeoNames ID (alag geonameId index ki zaroorat nahi)
     n   = naam            e.g. "Khargone"
     s   = search naam     e.g. "khargone" (lowercase, bina accent)
     st  = state           e.g. "Madhya Pradesh"
     cc  = country code    e.g. "IN"
     p   = abaadi          (bade sheher list me upar)

   Country ka naam ("India") aur display naam API khud banati hai.
   ══════════════════════════════════════════════════════════════ */
const citySchema = new mongoose.Schema(
  {
    _id: { type: Number }, // GeoNames ID
    n: { type: String, required: true },
    s: { type: String, required: true },
    st: { type: String, default: "" },
    cc: { type: String, required: true },
    p: { type: Number, default: 0 },
  },
  { versionKey: false, collection: "cities" },
);

// Search: naam se shuru (India + duniya dono isi se) — ek hi index,
// jagah bachane ke liye. syncIndexes purana extra index khud hata deta hai.
citySchema.index({ s: 1, p: -1 });

const City = mongoose.model("City", citySchema);

module.exports = { City };
