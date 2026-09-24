const { MhahPanchang } = require("mhah-panchang");

/**
 * ═══════════════════════════════════════════════════════════════
 *  JAIN PANCHANG CALCULATOR  (utils/jainPanchangCalc.js)
 *
 *  Tithi / Paksh / Nakshatra / Maas  → astronomical calculation
 *  Jain Parv                          → rule based, tradition wise
 *
 *  NOTE: Yahan ke parv rules aam shastra ke hisaab se hain.
 *  Kisi bhi parv ki date PanchangEvent model se override ki ja
 *  sakti hai — trust ka apna panchang hamesha final maana jayega.
 * ═══════════════════════════════════════════════════════════════
 */

const panchang = new MhahPanchang();

// Bhopal — default reference location
const DEFAULT_LAT = 23.2599;
const DEFAULT_LNG = 77.4126;

const TITHI_NAMES = [
  "Pratipada",
  "Dwitiya",
  "Tritiya",
  "Chaturthi",
  "Panchami",
  "Shashthi",
  "Saptami",
  "Ashtami",
  "Navami",
  "Dashami",
  "Ekadashi",
  "Dwadashi",
  "Trayodashi",
  "Chaturdashi",
  "Purnima",
];

// Amanta maas order — MoonMasa.ino ka index yahan lagta hai.
// (Library ka MoonMasa *naam* ek mahina aage deta hai, isliye naam ki
//  jagah uska ino index use kar rahe hain — verified against known dates.)
const MASA_ORDER = [
  "Chaitra",
  "Vaishakh",
  "Jyeshth",
  "Ashadh",
  "Shravan",
  "Bhadrapad",
  "Ashwin",
  "Kartik",
  "Margshirsh",
  "Paush",
  "Magh",
  "Falgun",
];

const pad = (n) => String(n).padStart(2, "0");

const toDateKey = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const parseDateKey = (key) => {
  if (!key) return null;
  const [y, m, d] = String(key).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (isNaN(dt.getTime())) return null;
  return dt;
};

/**
 * Ek din ka core panchang — tithi, paksh, nakshatra, maas
 */
const getCorePanchang = (date, lat = DEFAULT_LAT, lng = DEFAULT_LNG) => {
  const base = new Date(date);
  base.setHours(12, 0, 0, 0);

  // ✅ Panchang niyam: din ki tithi wahi hai jo SURYODAY ke samay chal rahi ho.
  //    Isliye calculation sunrise par karte hain, dopahar par nahi.
  let refTime = new Date(base);
  try {
    const sun = panchang.sunTimer(base, lat, lng);
    if (sun?.sunRise) refTime = new Date(sun.sunRise);
  } catch (e) {
    refTime.setHours(6, 15, 0, 0);
  }

  const d = base;
  const detail = panchang.calculate(refTime);
  const cal = panchang.calendar(refTime, lat, lng);

  // ino 0..29 hota hai (0 = Shukla Pratipada) → 1..15 me convert
  const tithiNum = ((detail?.Tithi?.ino ?? 0) % 15) + 1;
  const pakshName =
    detail?.Paksha?.name_en_IN === "Krishna" ? "Krishna" : "Shukla";

  let tithiName = TITHI_NAMES[tithiNum - 1];
  if (tithiNum === 15)
    tithiName = pakshName === "Krishna" ? "Amavasya" : "Purnima";

  const masaIno = cal?.MoonMasa?.ino;
  const masa =
    typeof masaIno === "number" ? MASA_ORDER[((masaIno % 12) + 12) % 12] : "";

  // Purnimanta naam — North India / kai Jain panchang isi ko maante hain.
  // Krishna paksh me purnimanta maas amanta se ek aage hota hai.
  const masaPurnimanta =
    typeof masaIno === "number"
      ? MASA_ORDER[
          (((masaIno + (pakshName === "Krishna" ? 1 : 0)) % 12) + 12) % 12
        ]
      : "";

  const year = d.getFullYear();

  return {
    date: toDateKey(d),
    weekday: detail?.Day?.name_en_UK || "",
    tithiNum,
    tithiName,
    paksh: pakshName,
    tithiStart: detail?.Tithi?.start || null,
    tithiEnd: detail?.Tithi?.end || null,
    nakshatra: detail?.Nakshatra?.name_en_IN || "",
    yoga: detail?.Yoga?.name_en_IN || "",
    karan: detail?.Karna?.name_en_IN || "",
    raasi: detail?.Raasi?.name_en_UK || "",
    masa,
    masaPurnimanta,
    isLeapMasa: !!cal?.MoonMasa?.isLeapMonth,
    ritu: cal?.Ritu?.name_en_UK || "",
    sunrise: (() => {
      try {
        return panchang.sunTimer(d, lat, lng)?.sunRise || null;
      } catch (e) {
        return null;
      }
    })(),
    sunset: (() => {
      try {
        return panchang.sunTimer(d, lat, lng)?.sunSet || null;
      } catch (e) {
        return null;
      }
    })(),
    vikramSamvat: year + 57,
    virNirvanSamvat: year + 527,
    shakSamvat: year - 78,
  };
};

/**
 * Jain parv rules.
 * match: (core) => boolean
 * tradition: "Digambar" | "Shwetambar" | "Both"
 */
const PARV_RULES = [
  // ───── Dono paramparaon me ─────
  {
    title: "Mahavir Jayanti",
    tradition: "Both",
    type: "jayanti",
    description: "Bhagwan Mahavir ka janm kalyanak.",
    match: (c) =>
      c.masa === "Chaitra" && c.paksh === "Shukla" && c.tithiNum === 13,
  },
  {
    title: "Akshay Tritiya",
    tradition: "Both",
    type: "parv",
    description: "Bhagwan Rishabhdev ke paarna ka din.",
    match: (c) =>
      c.masa === "Vaishakh" && c.paksh === "Shukla" && c.tithiNum === 3,
  },
  {
    title: "Vir Nirvan / Diwali",
    tradition: "Both",
    type: "parv",
    description: "Bhagwan Mahavir ka nirvan kalyanak.",
    // Amanta me Ashwin Amavasya = purnimanta me Kartik Amavasya
    match: (c) =>
      c.masa === "Ashwin" && c.paksh === "Krishna" && c.tithiNum === 15,
  },
  {
    title: "Ashtami Vrat",
    tradition: "Both",
    type: "vrat",
    description: "Ashtami ka upvaas / vrat din.",
    match: (c) => c.tithiNum === 8,
  },
  {
    title: "Chaturdashi Vrat",
    tradition: "Both",
    type: "vrat",
    description: "Chaturdashi ka upvaas / vrat din.",
    match: (c) => c.tithiNum === 14,
  },

  // ───── Digambar ─────
  {
    title: "Das Lakshan Parv",
    tradition: "Digambar",
    type: "parv",
    description: "Dus dharm ka 10 din ka mahaparv.",
    match: (c) =>
      c.masa === "Bhadrapad" &&
      c.paksh === "Shukla" &&
      c.tithiNum >= 5 &&
      c.tithiNum <= 14,
  },
  {
    title: "Ananta Chaturdashi",
    tradition: "Digambar",
    type: "parv",
    description: "Das Lakshan Parv ka antim din.",
    match: (c) =>
      c.masa === "Bhadrapad" && c.paksh === "Shukla" && c.tithiNum === 14,
  },
  {
    title: "Kshamavani Parv",
    tradition: "Digambar",
    type: "parv",
    description: "Kshama maangne aur dene ka din — Uttam Kshama.",
    match: (c) =>
      c.masa === "Bhadrapad" && c.paksh === "Shukla" && c.tithiNum === 15,
  },
  {
    title: "Shrut Panchami",
    tradition: "Digambar",
    type: "parv",
    description: "Jain shastra lekhan ka prarambh divas.",
    match: (c) =>
      c.masa === "Jyeshth" && c.paksh === "Shukla" && c.tithiNum === 5,
  },
  {
    title: "Sugandh Dashami",
    tradition: "Digambar",
    type: "parv",
    description: "Sugandh Dashami vrat.",
    match: (c) =>
      c.masa === "Bhadrapad" && c.paksh === "Shukla" && c.tithiNum === 10,
  },
  {
    title: "Ashtanhika Parv",
    tradition: "Digambar",
    type: "parv",
    description: "Ashtami se Purnima tak ka 8 din ka parv.",
    match: (c) =>
      ["Ashadh", "Kartik", "Falgun"].includes(c.masa) &&
      c.paksh === "Shukla" &&
      c.tithiNum >= 8 &&
      c.tithiNum <= 15,
  },

  // ───── Shwetambar ─────
  {
    title: "Paryushan Parv",
    tradition: "Shwetambar",
    type: "parv",
    description: "8 din ka mahaparv — Samvatsari par samapt.",
    // Amanta: Krishna wala hissa Shravan me padta hai (purnimanta me Bhadrapad)
    match: (c) =>
      (c.masa === "Shravan" && c.paksh === "Krishna" && c.tithiNum >= 12) ||
      (c.masa === "Bhadrapad" && c.paksh === "Shukla" && c.tithiNum <= 4),
  },
  {
    title: "Samvatsari",
    tradition: "Shwetambar",
    type: "parv",
    description: "Paryushan ka antim din — Michhami Dukkadam.",
    match: (c) =>
      c.masa === "Bhadrapad" && c.paksh === "Shukla" && c.tithiNum === 4,
  },
  {
    title: "Navpad Ayambil Oli",
    tradition: "Shwetambar",
    type: "parv",
    description: "9 din ka Ayambil tap.",
    match: (c) =>
      ["Chaitra", "Ashwin"].includes(c.masa) &&
      c.paksh === "Shukla" &&
      c.tithiNum >= 7 &&
      c.tithiNum <= 15,
  },
  {
    title: "Chaumasi Chaudas",
    tradition: "Shwetambar",
    type: "parv",
    description: "Chaturmaas ka pratikraman divas.",
    match: (c) =>
      ["Ashadh", "Kartik", "Falgun"].includes(c.masa) &&
      c.paksh === "Shukla" &&
      c.tithiNum === 14,
  },
  {
    title: "Gyan Panchami",
    tradition: "Shwetambar",
    type: "parv",
    description: "Gyan ki aradhana ka din.",
    match: (c) =>
      c.masa === "Kartik" && c.paksh === "Shukla" && c.tithiNum === 5,
  },
  {
    title: "Maun Ekadashi",
    tradition: "Shwetambar",
    type: "parv",
    description: "Maun vrat aur aradhana ka din.",
    match: (c) =>
      c.masa === "Margshirsh" && c.paksh === "Shukla" && c.tithiNum === 11,
  },
];

/**
 * Ek din ke computed parv (tradition filter ke saath)
 */
const getComputedParv = (core, tradition) => {
  const want = tradition && tradition !== "All" ? tradition : null;
  return PARV_RULES.filter((rule) => {
    if (!rule.match(core)) return false;
    if (!want) return true;
    return rule.tradition === "Both" || rule.tradition === want;
  }).map((rule) => ({
    title: rule.title,
    tradition: rule.tradition,
    type: rule.type,
    description: rule.description,
    source: "computed",
  }));
};

/**
 * Poora din — core + computed parv
 */
const getDayPanchang = (date, tradition, lat, lng) => {
  const core = getCorePanchang(date, lat, lng);
  return {
    ...core,
    parv: getComputedParv(core, tradition),
  };
};

/**
 * Ek mahine ke sab din
 */
const getMonthPanchang = (year, month, tradition, lat, lng) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const out = [];
  for (let d = 1; d <= daysInMonth; d++) {
    out.push(getDayPanchang(new Date(year, month - 1, d), tradition, lat, lng));
  }
  return out;
};

module.exports = {
  DEFAULT_LAT,
  DEFAULT_LNG,
  TITHI_NAMES,
  MASA_ORDER,
  PARV_RULES,
  toDateKey,
  parseDateKey,
  getCorePanchang,
  getComputedParv,
  getDayPanchang,
  getMonthPanchang,
};
