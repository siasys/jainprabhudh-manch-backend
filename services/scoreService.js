const mongoose = require("mongoose");
const SanghScore = require("../model/ScoreModels/Sanghscoremodel");
const {
  POINTS,
  getDonationPoints,
  DISTRIBUTION,
  isPanchAllowed,
  FORM_WINDOW,
} = require("../config/scoreConfig");


// ── MODEL GETTERS (lazy) ────────────────────────────────────────────────
const Sangh = () => mongoose.model("HierarchicalSangh");
const JainAadhar = () => mongoose.model("JainAadhar");



/** Ek din ka range: [aaj 00:00:00, kal 00:00:00) */
const getDayRange = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

/** Ek mahine ka range: [1 tareekh 00:00, agle mahine 1 tareekh 00:00) */
const getMonthRange = (year, month /* 1-12 */) => {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end };
};

/** Ek saal ka range: [1 Jan 00:00, agle saal 1 Jan 00:00) */
const getYearRange = (year) => {
  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const end = new Date(year + 1, 0, 1, 0, 0, 0, 0);
  return { start, end };
};

/** Kal ki date (daily cron raat 12 baje chalta hai → pichla din count karo) */
const getYesterday = (from = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() - 1);
  return d;
};

/** Pichla mahina { year, month } */
const getPreviousMonth = (from = new Date()) => {
  const d = new Date(from);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

/** periodKey banao: daily "2026-07-13" | monthly "2026-07" | yearly "2026" */
const buildPeriodKey = (periodType, date) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (periodType === "daily") return `${y}-${m}-${day}`;
  if (periodType === "monthly") return `${y}-${m}`;
  return `${y}`;
};

/**
 * Date range ke andar hai ya nahi.
 * start inclusive, end exclusive.
 */
const inRange = (date, start, end) => {
  if (!date) return false;
  const d = new Date(date);
  if (isNaN(d.getTime())) return false;
  return d >= start && d < end;
};

/**
 * Monthly form window khula hai ya nahi.
 * Rule: har mahine ki 1 se 5 tareekh tak PICHLE mahine ka form bharega.
 * 5 tareekh ka pura din allowed → 6 tareekh 00:00 par band.
 */
const isFormWindowOpen = (now = new Date()) => {
  const day = now.getDate();
  return day >= FORM_WINDOW.startDay && day <= FORM_WINDOW.endDay;
};

// ── 1. AUTO COUNTS ──────────────────────────────────────────────────────

/**
 * 5 auto fields ko database se gino.
 *
 *  sanghCreate    → is sangh ne kitne CHILD sangh banaye (parentSangh = mera id)
 *  memberCreate   → members[] me kitne naye jude (membershipStartDate)
 *  membershipFees → members[] me kitno ki fees aayi (paymentStatus=paid + paymentDate)
 *  shravakCard    → JainAadhar jinki reviewingSanghId = mera id (approved)
 *  panchCreate    → panches[] me kitne naye jude  (veerSena → hamesha 0)
 *
 * @param {Object} sangh  - HierarchicalSangh document (members/panches ke saath)
 * @param {Date}   start  - range start (inclusive)
 * @param {Date}   end    - range end (exclusive)
 */
const computeAutoCounts = async (sangh, start, end) => {
  const sanghId = sangh._id;

  // ── 1. Sangh create — child sanghs jo is period me bane ──
  const sanghCreate = await Sangh().countDocuments({
    parentSangh: sanghId,
    createdAt: { $gte: start, $lt: end },
  });

  // ── 2. Member create — embedded array, membershipStartDate se ──
  const members = Array.isArray(sangh.members) ? sangh.members : [];
  const memberCreate = members.filter((m) =>
    inRange(m.membershipStartDate, start, end),
  ).length;

  // ── 3. Membership fees — paid + paymentDate is period me ──
  const membershipFees = members.filter(
    (m) => m.paymentStatus === "paid" && inRange(m.paymentDate, start, end),
  ).length;

  // ── 4. Shravak card — JainAadhar approved, reviewingSanghId = mera ──
  const shravakCard = await JainAadhar().countDocuments({
    reviewingSanghId: sanghId,
    status: "approved",
    createdAt: { $gte: start, $lt: end },
  });

  // ── 5. Panch create — veerSena ko panch ka score NAHI milta ──
  let panchCreate = 0;
  if (isPanchAllowed(sangh.sanghType)) {
    const panches = Array.isArray(sangh.panches) ? sangh.panches : [];
    panchCreate = panches.filter((p) => {
      // panchSchema me koi date field nahi hai — subdoc ke _id (ObjectId) me
      // creation timestamp chhupa hota hai, wahi use kar rahe hain.
      if (!p._id || typeof p._id.getTimestamp !== "function") return false;
      return inRange(p._id.getTimestamp(), start, end);
    }).length;
  }

  return {
    sanghCreate,
    memberCreate,
    membershipFees,
    shravakCard,
    panchCreate,
  };
};

// ── 2. SCORE CALCULATION ────────────────────────────────────────────────

/**
 * Counts ko points me badlo.
 * Donation alag hai — usme count nahi, AMOUNT hota hai (slab se points).
 *
 * @param {Object} counts    - saare 16 fields ke counts (+ donationAmount)
 * @param {String} sanghType - main | women | youth | veerSena
 * @returns {{ breakdown: Object, selfScore: Number }}
 */
const calculateScore = (counts = {}, sanghType = "main") => {
  const breakdown = {};
  let selfScore = 0;

  // ── fixed-point fields (15) ──
  const fixedFields = [
    "sanghCreate",
    "memberCreate",
    "membershipFees",
    "shravakCard",
    "panchCreate",
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
  ];

  for (const field of fixedFields) {
    let count = Number(counts[field]) || 0;

    // veerSena → panch ka score hamesha 0
    if (field === "panchCreate" && !isPanchAllowed(sanghType)) {
      count = 0;
    }

    const pts = count * (POINTS[field] || 0);
    breakdown[field] = pts;
    selfScore += pts;
  }

  // ── donation — amount ki slab se points ──
  const donationPts = getDonationPoints(counts.donationAmount || 0);
  breakdown.donation = donationPts;
  selfScore += donationPts;

  return { breakdown, selfScore };
};

// ── 3. HIERARCHY / DISTRIBUTION ─────────────────────────────────────────

/**
 * Sangh ke saare ANCESTORS (upar wale) nikalo — parentSangh chain follow karke.
 * city → district → state → country → foundation
 */
const getAncestors = async (sangh) => {
  const ancestors = [];
  const seen = new Set([String(sangh._id)]);
  let currentParentId = sangh.parentSangh;

  // infinite loop guard — max 10 level
  let hops = 0;
  while (currentParentId && hops < 10) {
    if (seen.has(String(currentParentId))) break; // cycle detected
    seen.add(String(currentParentId));

    const parent = await Sangh()
      .findById(currentParentId)
      .select("_id name level sanghType parentSangh")
      .lean();

    if (!parent) break;

    ancestors.push(parent);
    currentParentId = parent.parentSangh;
    hops++;
  }

  return ancestors;
};

/**
 * selfScore ka kitna hissa kis ancestor ko jayega — calculate karo.
 *
 * ZAROORI: distribution HAMESHA selfScore par hota hai, receivedScore par
 * kabhi nahi. Aur niche wale ka selfScore ghatta nahi — upar wale ko EXTRA
 * milta hai (copy hota hai, transfer nahi).
 *
 * @returns {Array} [{ sanghId, sanghName, level, percentage, points }]
 */
const buildDistribution = (selfScore, ancestors) => {
  if (!selfScore || selfScore <= 0) return [];

  const dist = [];
  for (const anc of ancestors) {
    const pct = DISTRIBUTION[anc.level];
    if (!pct) continue; // foundation / area → koi % nahi

    const points = Math.round((selfScore * pct) / 100);
    if (points <= 0) continue;

    dist.push({
      sanghId: anc._id,
      sanghName: anc.name,
      level: anc.level,
      percentage: pct,
      points,
    });
  }
  return dist;
};

// ── 4. UPSERT (re-run safe) ─────────────────────────────────────────────

/**
 * Ek sangh ka ek period ka score record banao/update karo.
 * Unique index (sanghId + periodType + periodKey) ki wajah se cron dobara
 * chale to DUPLICATE nahi banega — purana record update ho jayega.
 *
 * receivedScore ko yahan HAATH NAHI lagate — wo phase 2 me bharta hai.
 */
const upsertSelfScore = async ({
  sangh,
  periodType,
  periodKey,
  periodStart,
  periodEnd,
  counts,
  breakdown,
  selfScore,
  distributedTo,
  source = "auto",
  extra = {},
}) => {
  const distributedTotal = distributedTo.reduce(
    (sum, d) => sum + (d.points || 0),
    0,
  );

  const d = new Date(periodStart);

  return SanghScore.findOneAndUpdate(
    { sanghId: sangh._id, periodType, periodKey },
    {
      $set: {
        sanghId: sangh._id,
        sanghName: sangh.name,
        level: sangh.level,
        sanghType: sangh.sanghType || "main",
        periodType,
        periodKey,
        periodStart,
        periodEnd,
        day: periodType === "daily" ? d.getDate() : undefined,
        month: periodType !== "yearly" ? d.getMonth() + 1 : undefined,
        year: d.getFullYear(),
        counts,
        breakdown,
        selfScore,
        distributedTo,
        distributedTotal,
        source,
        ...extra,
      },
      // pehli baar bana rahe hain to received ko 0 se shuru karo
      $setOnInsert: { receivedScore: 0, receivedFrom: [] },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

// hoisting fix — upar ke function me SanghScore call ho raha hai
function SanghScoreModel() {
  return SanghScore;
}

// ── 5. MAIN RUNNERS ─────────────────────────────────────────────────────

/**
 * Sabhi active sanghs ka ek period ka score compute karo.
 *
 * DO PHASE me hota hai (taaki cron dobara chale to bhi score double na ho):
 *   PHASE 1 → har sangh ka selfScore + distributedTo compute + save
 *   PHASE 2 → sab ka receivedScore RESET karke ledger se dobara build
 *
 * @param {String} periodType - 'daily' | 'monthly' | 'yearly'
 * @param {Date}   start
 * @param {Date}   end
 * @param {Object} opts       - { manualBySangh: { sanghId: {...manual counts} } }
 */
const runScoreForPeriod = async (periodType, start, end, opts = {}) => {
  const { manualBySangh = {}, requireForm = false } = opts;
  const periodKey = buildPeriodKey(periodType, start);

  const sanghs = await Sangh()
    .find({ status: "active" })
    .select("_id name level sanghType parentSangh members panches")
    .lean();

  const results = [];
  const distributionLedger = []; // { toSanghId, from: {...} }

  // ─────────── PHASE 1: har sangh ka apna score ───────────
  for (const sangh of sanghs) {
    try {
      // auto counts (5)
      const autoCounts = await computeAutoCounts(sangh, start, end);

      // manual counts (11) — daily me nahi hote, monthly form se aate hain
      const manual = manualBySangh[String(sangh._id)] || {};

      const counts = {
        ...autoCounts,
        officialVisit: Number(manual.officialVisit) || 0,
        meetings: Number(manual.meetings) || 0,
        projects: Number(manual.projects) || 0,
        trainings: Number(manual.trainings) || 0,
        tirthAccount: Number(manual.tirthAccount) || 0,
        businessAccount: Number(manual.businessAccount) || 0,
        sadhuAccount: Number(manual.sadhuAccount) || 0,
        matrimonyRegister: Number(manual.matrimonyRegister) || 0,
        employmentRegister: Number(manual.employmentRegister) || 0,
        scholarshipRegister: Number(manual.scholarshipRegister) || 0,
        donationAmount: Number(manual.donationAmount) || 0,
      };

      let { breakdown, selfScore } = calculateScore(
        counts,
        sangh.sanghType || "main",
      );

      // ── RULE: MONTHLY me form NAHI bhara → us mahine ka score 0 ──
      // Auto points bhi nahi milenge. Counts phir bhi save karte hain taaki
      // president ko dikhe ki usne kya kamaya HOTA agar form bharta.
      const formFilled = Object.keys(manual).length > 0;
      const formMissed = requireForm && !formFilled;

      if (formMissed) {
        selfScore = 0;
        breakdown = Object.keys(breakdown).reduce((acc, k) => {
          acc[k] = 0;
          return acc;
        }, {});
      }

      // upar walon ko kitna jayega (form miss → kuch nahi jayega)
      const ancestors = await getAncestors(sangh);
      const distributedTo = formMissed
        ? []
        : buildDistribution(selfScore, ancestors);

      const doc = await upsertSelfScore({
        sangh,
        periodType,
        periodKey,
        periodStart: start,
        periodEnd: end,
        counts,
        breakdown,
        selfScore,
        distributedTo,
        source: formFilled ? "form" : "auto",
        extra: {
          formMissed,
          ...(manual.reportId ? { reportId: manual.reportId } : {}),
        },
      });

      // ledger me daal do — phase 2 me use hoga
      for (const d of distributedTo) {
        distributionLedger.push({
          toSanghId: String(d.sanghId),
          from: {
            sanghId: sangh._id,
            sanghName: sangh.name,
            level: sangh.level,
            percentage: d.percentage,
            points: d.points,
          },
        });
      }

      results.push({
        sanghId: sangh._id,
        name: sangh.name,
        selfScore,
        distributed: distributedTo.length,
      });
    } catch (err) {
      console.error(
        `[scoreService] PHASE1 fail — sangh ${sangh._id} (${sangh.name}):`,
        err.message,
      );
    }
  }

  // ─────────── PHASE 2: received score rebuild ───────────
  // Pehle SAB ka received reset (idempotent — dobara chalne par double nahi hoga)
  await SanghScore.updateMany(
    { periodType, periodKey },
    { $set: { receivedScore: 0, receivedFrom: [] } },
  );

  // ab ledger se dobara bharo
  const grouped = {};
  for (const entry of distributionLedger) {
    if (!grouped[entry.toSanghId]) grouped[entry.toSanghId] = [];
    grouped[entry.toSanghId].push(entry.from);
  }

  for (const [toSanghId, fromList] of Object.entries(grouped)) {
    try {
      const receivedScore = fromList.reduce((s, f) => s + (f.points || 0), 0);

      await SanghScore.findOneAndUpdate(
        { sanghId: toSanghId, periodType, periodKey },
        {
          $set: {
            receivedScore,
            receivedFrom: fromList,
          },
        },
      );
    } catch (err) {
      console.error(
        `[scoreService] PHASE2 fail — sangh ${toSanghId}:`,
        err.message,
      );
    }
  }

  // totalScore sync (pre-save hook findOneAndUpdate par nahi chalta)
  const allDocs = await SanghScore.find({ periodType, periodKey });
  for (const doc of allDocs) {
    const total = (doc.selfScore || 0) + (doc.receivedScore || 0);
    if (doc.totalScore !== total) {
      doc.totalScore = total;
      await doc.save();
    }
  }

  return {
    periodType,
    periodKey,
    sanghCount: sanghs.length,
    processed: results.length,
    distributions: distributionLedger.length,
  };
};

// ── PUBLIC RUNNERS ──────────────────────────────────────────────────────

/**
 * DAILY — roz raat 12:00 par chalta hai, PICHLE din ka score banata hai.
 * Sirf 5 auto fields (manual monthly form se aate hain).
 */
const runDailyScore = async (targetDate = null) => {
  const date = targetDate ? new Date(targetDate) : getYesterday();
  const { start, end } = getDayRange(date);
  console.log(`[scoreService] DAILY score chalu — ${start.toDateString()}`);
  return runScoreForPeriod("daily", start, end);
};

/**
 * MONTHLY — pichle mahine ka snapshot.
 * Auto fields poore mahine ke, manual fields form se (agar bhara ho).
 */
const runMonthlyScore = async (year = null, month = null) => {
  let y = year;
  let m = month;
  if (!y || !m) {
    const prev = getPreviousMonth();
    y = prev.year;
    m = prev.month;
  }
  const { start, end } = getMonthRange(y, m);

  // agar kisi sangh ne form bhar diya hai to uska manual data uthao
  const manualBySangh = await collectManualDataForMonth(y, m);

  console.log(`[scoreService] MONTHLY score chalu — ${y}-${m}`);
  // requireForm: true → jisne form nahi bhara, uska score 0 rahega
  return runScoreForPeriod("monthly", start, end, {
    manualBySangh,
    requireForm: true,
  });
};

/**
 * YEARLY — 31 December raat 12 par pure saal ka score.
 */
const runYearlyScore = async (year = null) => {
  const y = year || new Date().getFullYear();
  console.log(`[scoreService] YEARLY score chalu — ${y}`);
  return aggregateYearlyFromMonthly(y);
};

/**
 * YEARLY = SIRF un mahino ka jod jinka form BHARA gaya tha.
 *
 * Auto counts dobara nahi ginte — seedha monthly records se jodte hain.
 * Isse rule apne aap lagu ho jaata hai: jis mahine form nahi bhara, uska
 * score 0 tha, to yearly me bhi wo 0 hi judega.
 */
const aggregateYearlyFromMonthly = async (year) => {
  const { start, end } = getYearRange(year);
  const periodKey = String(year);

  // sirf submitted monthly records
  const monthlyDocs = await SanghScore.find({
    periodType: "monthly",
    year,
    formSubmitted: true,
  }).lean();

  // sangh ke hisaab se group karo
  const bySangh = {};
  for (const d of monthlyDocs) {
    const key = String(d.sanghId);
    if (!bySangh[key]) {
      bySangh[key] = {
        sanghId: d.sanghId,
        sanghName: d.sanghName,
        level: d.level,
        sanghType: d.sanghType,
        counts: {},
        breakdown: {},
        selfScore: 0,
        monthsSubmitted: 0,
      };
    }
    const acc = bySangh[key];
    acc.selfScore += d.selfScore || 0;
    acc.monthsSubmitted += 1;

    for (const [k, v] of Object.entries(d.counts || {})) {
      acc.counts[k] = (acc.counts[k] || 0) + (Number(v) || 0);
    }
    for (const [k, v] of Object.entries(d.breakdown || {})) {
      acc.breakdown[k] = (acc.breakdown[k] || 0) + (Number(v) || 0);
    }
  }

  const ledger = [];

  // PHASE 1 — har sangh ka yearly self score + distribution
  for (const entry of Object.values(bySangh)) {
    try {
      const sangh = await Sangh()
        .findById(entry.sanghId)
        .select("_id name level sanghType parentSangh")
        .lean();
      if (!sangh) continue;

      const ancestors = await getAncestors(sangh);
      const distributedTo = buildDistribution(entry.selfScore, ancestors);

      await upsertSelfScore({
        sangh,
        periodType: "yearly",
        periodKey,
        periodStart: start,
        periodEnd: end,
        counts: entry.counts,
        breakdown: entry.breakdown,
        selfScore: entry.selfScore,
        distributedTo,
        source: "recalc",
        extra: {
          formSubmitted: entry.monthsSubmitted > 0,
          formMissed: false,
        },
      });

      for (const d of distributedTo) {
        ledger.push({
          toSanghId: String(d.sanghId),
          from: {
            ...d,
            sanghId: sangh._id,
            sanghName: sangh.name,
            level: sangh.level,
          },
        });
      }
    } catch (err) {
      console.error(
        `[scoreService] YEARLY fail — ${entry.sanghId}:`,
        err.message,
      );
    }
  }

  // PHASE 2 — received rebuild
  await refreshReceivedForPeriod("yearly", periodKey);

  return {
    periodType: "yearly",
    periodKey,
    sanghCount: Object.keys(bySangh).length,
    processed: Object.keys(bySangh).length,
    distributions: ledger.length,
    note: "Sirf un mahino ka jod jinka form bhara gaya tha",
  };
};

// ── 6. MANUAL DATA (monthly form se) ────────────────────────────────────

/**
 * Ek mahine ke saare submitted monthly records se manual counts uthao.
 * Ye SanghScore ke monthly records se aata hai (jahan form ne save kiya tha).
 */
const collectManualDataForMonth = async (year, month) => {
  const periodKey = buildPeriodKey("monthly", new Date(year, month - 1, 1));

  const docs = await SanghScore.find({
    periodType: "monthly",
    periodKey,
    formSubmitted: true,
  })
    .select("sanghId counts reportId")
    .lean();

  const map = {};
  for (const d of docs) {
    map[String(d.sanghId)] = {
      officialVisit: d.counts?.officialVisit || 0,
      meetings: d.counts?.meetings || 0,
      projects: d.counts?.projects || 0,
      trainings: d.counts?.trainings || 0,
      tirthAccount: d.counts?.tirthAccount || 0,
      businessAccount: d.counts?.businessAccount || 0,
      sadhuAccount: d.counts?.sadhuAccount || 0,
      matrimonyRegister: d.counts?.matrimonyRegister || 0,
      employmentRegister: d.counts?.employmentRegister || 0,
      scholarshipRegister: d.counts?.scholarshipRegister || 0,
      donationAmount: d.counts?.donationAmount || 0,
      reportId: d.reportId || undefined,
    };
  }
  return map;
};

/** Pure saal ke 12 monthly records ka manual data jod do */
const collectManualDataForYear = async (year) => {
  const docs = await SanghScore.find({
    periodType: "monthly",
    year,
    formSubmitted: true,
  })
    .select("sanghId counts")
    .lean();

  const map = {};
  for (const d of docs) {
    const key = String(d.sanghId);
    if (!map[key]) {
      map[key] = {
        officialVisit: 0,
        meetings: 0,
        projects: 0,
        trainings: 0,
        tirthAccount: 0,
        businessAccount: 0,
        sadhuAccount: 0,
        matrimonyRegister: 0,
        employmentRegister: 0,
        scholarshipRegister: 0,
        donationAmount: 0,
      };
    }
    const c = d.counts || {};
    map[key].officialVisit += c.officialVisit || 0;
    map[key].meetings += c.meetings || 0;
    map[key].projects += c.projects || 0;
    map[key].trainings += c.trainings || 0;
    map[key].tirthAccount += c.tirthAccount || 0;
    map[key].businessAccount += c.businessAccount || 0;
    map[key].sadhuAccount += c.sadhuAccount || 0;
    map[key].matrimonyRegister += c.matrimonyRegister || 0;
    map[key].employmentRegister += c.employmentRegister || 0;
    map[key].scholarshipRegister += c.scholarshipRegister || 0;
    map[key].donationAmount += c.donationAmount || 0;
  }
  return map;
};

// ── 7. SINGLE SANGH HELPERS (API ke liye) ───────────────────────────────

/**
 * Ek sangh ka LIVE preview — abhi tak kitne auto points bane.
 * Cron ka wait kiye bina turant dikhane ke liye (Daily tab me kaam aayega).
 */
const previewSanghScore = async (sanghId, start, end) => {
  const sangh = await Sangh()
    .findById(sanghId)
    .select("_id name level sanghType parentSangh members panches")
    .lean();

  if (!sangh) throw new Error("Sangh not found");

  const counts = await computeAutoCounts(sangh, start, end);
  const { breakdown, selfScore } = calculateScore(
    counts,
    sangh.sanghType || "main",
  );

  const ancestors = await getAncestors(sangh);
  const distributedTo = buildDistribution(selfScore, ancestors);

  return {
    sanghId: sangh._id,
    sanghName: sangh.name,
    level: sangh.level,
    sanghType: sangh.sanghType,
    counts,
    breakdown,
    selfScore,
    distributedTo,
    isLive: true,
  };
};

/**
 * Monthly form ka manual data save karo (SanghScore me).
 * Ye form submit hone par controller call karega.
 */
const saveMonthlyManualData = async ({
  sanghId,
  year,
  month,
  manualCounts,
  reportId = null,
}) => {
  const sangh = await Sangh()
    .findById(sanghId)
    .select("_id name level sanghType parentSangh members panches")
    .lean();

  if (!sangh) throw new Error("Sangh not found");

  const periodKey = buildPeriodKey("monthly", new Date(year, month - 1, 1));

  // lock check — 5 tareekh ke baad edit nahi
  const existing = await SanghScore.findOne({
    sanghId,
    periodType: "monthly",
    periodKey,
  }).lean();

  if (existing?.locked) {
    throw new Error(
      "Form window has closed. This report can no longer be edited.",
    );
  }

  const { start, end } = getMonthRange(year, month);

  // auto counts poore mahine ke
  const autoCounts = await computeAutoCounts(sangh, start, end);

  const counts = {
    ...autoCounts,
    officialVisit: Number(manualCounts.officialVisit) || 0,
    meetings: Number(manualCounts.meetings) || 0,
    projects: Number(manualCounts.projects) || 0,
    trainings: Number(manualCounts.trainings) || 0,
    tirthAccount: Number(manualCounts.tirthAccount) || 0,
    businessAccount: Number(manualCounts.businessAccount) || 0,
    sadhuAccount: Number(manualCounts.sadhuAccount) || 0,
    matrimonyRegister: Number(manualCounts.matrimonyRegister) || 0,
    employmentRegister: Number(manualCounts.employmentRegister) || 0,
    scholarshipRegister: Number(manualCounts.scholarshipRegister) || 0,
    donationAmount: Number(manualCounts.donationAmount) || 0,
  };

  const { breakdown, selfScore } = calculateScore(
    counts,
    sangh.sanghType || "main",
  );

  const ancestors = await getAncestors(sangh);
  const distributedTo = buildDistribution(selfScore, ancestors);

  const doc = await upsertSelfScore({
    sangh,
    periodType: "monthly",
    periodKey,
    periodStart: start,
    periodEnd: end,
    counts,
    breakdown,
    selfScore,
    distributedTo,
    source: "form",
    extra: {
      formSubmitted: true,
      formSubmittedAt: new Date(),
      reportId,
    },
  });

  // is sangh ke ancestors ka received turant update karo
  await refreshReceivedForPeriod("monthly", periodKey);

  return doc;
};

/**
 * Ek period ke saare received scores dobara build karo.
 * (Monthly form submit hone ke baad turant call hota hai.)
 */
const refreshReceivedForPeriod = async (periodType, periodKey) => {
  const all = await SanghScore.find({ periodType, periodKey })
    .select("sanghId sanghName level distributedTo selfScore")
    .lean();

  // reset
  await SanghScore.updateMany(
    { periodType, periodKey },
    { $set: { receivedScore: 0, receivedFrom: [] } },
  );

  const grouped = {};
  for (const doc of all) {
    for (const d of doc.distributedTo || []) {
      const key = String(d.sanghId);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        sanghId: doc.sanghId,
        sanghName: doc.sanghName,
        level: doc.level,
        percentage: d.percentage,
        points: d.points,
      });
    }
  }

  for (const [toSanghId, fromList] of Object.entries(grouped)) {
    const receivedScore = fromList.reduce((s, f) => s + (f.points || 0), 0);
    await SanghScore.findOneAndUpdate(
      { sanghId: toSanghId, periodType, periodKey },
      { $set: { receivedScore, receivedFrom: fromList } },
    );
  }

  // totalScore sync
  const docs = await SanghScore.find({ periodType, periodKey });
  for (const doc of docs) {
    doc.totalScore = (doc.selfScore || 0) + (doc.receivedScore || 0);
    await doc.save();
  }
};

/**
 * Monthly form window band karo (6 tareekh 00:00 par cron chalata hai).
 * Pichle mahine ke saare monthly records lock kar do.
 */
const lockMonthlyReports = async (year = null, month = null) => {
  let y = year;
  let m = month;
  if (!y || !m) {
    const prev = getPreviousMonth();
    y = prev.year;
    m = prev.month;
  }
  const periodKey = buildPeriodKey("monthly", new Date(y, m - 1, 1));

  // ── RULE: jinhone form NAHI bhara → score 0, distribution 0, missed mark ──
  const missed = await SanghScore.updateMany(
    { periodType: "monthly", periodKey, formSubmitted: false },
    {
      $set: {
        selfScore: 0,
        totalScore: 0,
        distributedTo: [],
        distributedTotal: 0,
        formMissed: true,
      },
    },
  );

  // received dobara build karo — missed walon ka contribution hat gaya
  await refreshReceivedForPeriod("monthly", periodKey);

  // ab sab lock kar do
  const res = await SanghScore.updateMany(
    { periodType: "monthly", periodKey, locked: false },
    { $set: { locked: true, lockedAt: new Date() } },
  );

  console.log(
    `[scoreService] MONTHLY LOCK — ${periodKey}: ${res.modifiedCount} locked, ${missed.modifiedCount} form-missed (score 0)`,
  );
  return {
    periodKey,
    locked: res.modifiedCount,
    formMissed: missed.modifiedCount,
  };
};

module.exports = {
  // date helpers
  getDayRange,
  getMonthRange,
  getYearRange,
  getYesterday,
  getPreviousMonth,
  buildPeriodKey,
  isFormWindowOpen,

  // core
  computeAutoCounts,
  calculateScore,
  getAncestors,
  buildDistribution,

  // runners
  runScoreForPeriod,
  runDailyScore,
  runMonthlyScore,
  runYearlyScore,

  // api helpers
  previewSanghScore,
  saveMonthlyManualData,
  refreshReceivedForPeriod,
  lockMonthlyReports,
};
