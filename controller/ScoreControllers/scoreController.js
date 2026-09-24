const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const SanghScore = require("../../model/ScoreModels/Sanghscoremodel");
const scoreService = require("../../services/scoreService");
const { triggers } = require("../../jobs/scoreJob");
const {
  POINTS,
  AUTO_FIELDS,
  MANUAL_FIELDS,
  FIELD_LABELS,
  DONATION_SLABS,
  DISTRIBUTION,
  FORM_WINDOW,
} = require("../../config/scoreConfig");

/**
 * scoreController.js
 * ----------------------------------------------------------------------------
 * Sangh Scoring ke saare API endpoints.
 * NAYA controller — koi purana controller (reportingController etc.) touch nahi hua.
 * ----------------------------------------------------------------------------
 */

const Sangh = () => mongoose.model("HierarchicalSangh");

// ── PERMISSION HELPERS ──────────────────────────────────────────────────

/**
 * User is sangh ka president/secretary hai ya nahi.
 * Do jagah check karte hain:
 *   1. user.sanghRoles[]  (User model me)
 *   2. sangh.officeBearers[] (HierarchicalSangh model me)
 */
const canManageSangh = async (user, sanghId) => {
  if (!user) return false;

  // superadmin sab kuch kar sakta hai
  if (user.role === "superadmin") return true;

  const sid = String(sanghId);

  // 1. sanghRoles se check
  const roles = user.sanghRoles || [];
  const hasRole = roles.some(
    (r) =>
      String(r.sanghId) === sid &&
      ["president", "secretary", "treasurer"].includes(r.role),
  );
  if (hasRole) return true;

  // 2. officeBearers se check (fallback)
  const sangh = await Sangh().findById(sanghId).select("officeBearers").lean();
  if (!sangh) return false;

  return (sangh.officeBearers || []).some(
    (ob) =>
      String(ob.userId) === String(user._id) &&
      ob.status === "active" &&
      ["president", "secretary", "treasurer"].includes(ob.role),
  );
};

/** Date string "2026-07-13" ko safely parse karo */
const parseDate = (str) => {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

/** Aaj ka din hai ya nahi */
const isToday = (date) => {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};

// ════════════════════════════════════════════════════════════════════════
//  1. DAILY SCORE
// ════════════════════════════════════════════════════════════════════════

/**
 * GET /api/score/daily/:sanghId?date=2026-07-13
 *
 * Aaj ki date ho → LIVE preview (cron ka wait nahi, turant count)
 * Purani date ho → saved record (cron ne banaya tha)
 */
const getDailyScore = asyncHandler(async (req, res) => {
  const { sanghId } = req.params;
  const target = parseDate(req.query.date) || new Date();

  if (!mongoose.Types.ObjectId.isValid(sanghId)) {
    return res.status(400).json({ success: false, message: "Invalid sanghId" });
  }

  const { start, end } = scoreService.getDayRange(target);
  const periodKey = scoreService.buildPeriodKey("daily", start);

  // aaj ka din → live count (cron abhi nahi chala)
  if (isToday(target)) {
    const live = await scoreService.previewSanghScore(sanghId, start, end);

    // kal ka score bhi nikal lo — "+52 kal se" wala comparison dikhane ke liye
    const yesterdayKey = scoreService.buildPeriodKey(
      "daily",
      scoreService.getYesterday(target),
    );
    const yesterday = await SanghScore.findOne({
      sanghId,
      periodType: "daily",
      periodKey: yesterdayKey,
    })
      .select("totalScore selfScore")
      .lean();

    return res.json({
      success: true,
      message: {
        ...live,
        periodType: "daily",
        periodKey,
        periodStart: start,
        periodEnd: end,
        receivedScore: 0, // live me received nahi milta (cron banata hai)
        totalScore: live.selfScore,
        comparison: {
          previousTotal: yesterday?.totalScore || 0,
          change: live.selfScore - (yesterday?.totalScore || 0),
        },
        note: "Live preview - receivedScore appears after the midnight cron run",
      },
    });
  }

  // purani date → saved record
  const saved = await SanghScore.findOne({
    sanghId,
    periodType: "daily",
    periodKey,
  }).lean();

  if (!saved) {
    return res.json({
      success: true,
      message: {
        sanghId,
        periodType: "daily",
        periodKey,
        counts: {},
        breakdown: {},
        selfScore: 0,
        receivedScore: 0,
        totalScore: 0,
        distributedTo: [],
        receivedFrom: [],
        empty: true,
      },
    });
  }

  return res.json({ success: true, message: saved });
});

// ════════════════════════════════════════════════════════════════════════
//  2. MONTHLY SCORE  (+ form window status)
// ════════════════════════════════════════════════════════════════════════

/**
 * GET /api/score/monthly/:sanghId?year=2026&month=7
 *
 * Response me 3 cheezein:
 *   - saved monthly record (agar hai)
 *   - autoPreview → 5 auto fields ke live counts (form pre-fill ke liye)
 *   - formWindow  → form khula hai ya band
 */
const getMonthlyScore = asyncHandler(async (req, res) => {
  const { sanghId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(sanghId)) {
    return res.status(400).json({ success: false, message: "Invalid sanghId" });
  }

  // default = PICHLA mahina (kyunki form pichle mahine ka bharta hai)
  const prev = scoreService.getPreviousMonth();
  const year = parseInt(req.query.year, 10) || prev.year;
  const month = parseInt(req.query.month, 10) || prev.month;

  const { start, end } = scoreService.getMonthRange(year, month);
  const periodKey = scoreService.buildPeriodKey("monthly", start);

  const saved = await SanghScore.findOne({
    sanghId,
    periodType: "monthly",
    periodKey,
  }).lean();

  // auto fields ka live count — form me pre-fill karne ke liye
  const autoPreview = await scoreService.previewSanghScore(sanghId, start, end);

  // form window: 1-5 tareekh + pichla mahina + lock nahi hua
  const now = new Date();
  const isPrevMonth = year === prev.year && month === prev.month;
  const windowOpen =
    isPrevMonth && scoreService.isFormWindowOpen(now) && !saved?.locked;

  return res.json({
    success: true,
    message: {
      sanghId,
      year,
      month,
      periodKey,
      periodStart: start,
      periodEnd: end,

      // saved score (cron ya form se)
      counts: saved?.counts || {},
      breakdown: saved?.breakdown || {},
      selfScore: saved?.selfScore || 0,
      receivedScore: saved?.receivedScore || 0,
      totalScore: saved?.totalScore || 0,
      distributedTo: saved?.distributedTo || [],
      receivedFrom: saved?.receivedFrom || [],

      // form status
      formSubmitted: saved?.formSubmitted || false,
      formSubmittedAt: saved?.formSubmittedAt || null,
      locked: saved?.locked || false,
      reportId: saved?.reportId || null,

      // RULE: form nahi bhara → us mahine ka score 0 (auto points bhi nahi)
      formMissed: saved?.formMissed || false,

      // form ke liye pre-fill data (5 auto fields — read-only dikhana)
      autoPreview: {
        counts: {
          sanghCreate: autoPreview.counts.sanghCreate,
          memberCreate: autoPreview.counts.memberCreate,
          membershipFees: autoPreview.counts.membershipFees,
          shravakCard: autoPreview.counts.shravakCard,
          panchCreate: autoPreview.counts.panchCreate,
        },
        sanghType: autoPreview.sanghType,
      },

      formWindow: {
        open: windowOpen,
        startDay: FORM_WINDOW.startDay,
        endDay: FORM_WINDOW.endDay,
        message: windowOpen
          ? `Form is open until midnight on the ${FORM_WINDOW.endDay}th`
          : saved?.formMissed
            ? "Form was not submitted. Score for this month is 0."
            : saved?.locked
              ? "Form window has closed. Score is final."
              : `Form opens between the ${FORM_WINDOW.startDay}st and ${FORM_WINDOW.endDay}th`,
      },
    },
  });
});

// ════════════════════════════════════════════════════════════════════════
//  3. YEARLY SCORE
// ════════════════════════════════════════════════════════════════════════

/** GET /api/score/yearly/:sanghId?year=2026 */
const getYearlyScore = asyncHandler(async (req, res) => {
  const { sanghId } = req.params;
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();

  if (!mongoose.Types.ObjectId.isValid(sanghId)) {
    return res.status(400).json({ success: false, message: "Invalid sanghId" });
  }

  const periodKey = String(year);

  const saved = await SanghScore.findOne({
    sanghId,
    periodType: "yearly",
    periodKey,
  }).lean();

  // saal ke 12 monthly records — trend graph ke liye
  const months = await SanghScore.find({
    sanghId,
    periodType: "monthly",
    year,
  })
    .select("month periodKey selfScore receivedScore totalScore formSubmitted")
    .sort({ month: 1 })
    .lean();

  // agar yearly snapshot nahi bana (saal chal raha hai) → monthly se jod do
  const running = months.reduce(
    (acc, m) => {
      acc.selfScore += m.selfScore || 0;
      acc.receivedScore += m.receivedScore || 0;
      acc.totalScore += m.totalScore || 0;
      return acc;
    },
    { selfScore: 0, receivedScore: 0, totalScore: 0 },
  );

  return res.json({
    success: true,
    message: {
      sanghId,
      year,
      periodKey,
      counts: saved?.counts || {},
      breakdown: saved?.breakdown || {},
      selfScore: saved?.selfScore ?? running.selfScore,
      receivedScore: saved?.receivedScore ?? running.receivedScore,
      totalScore: saved?.totalScore ?? running.totalScore,
      distributedTo: saved?.distributedTo || [],
      receivedFrom: saved?.receivedFrom || [],
      isFinal: !!saved, // false = saal abhi chal raha hai (running total)
      monthlyTrend: months,
    },
  });
});

// ════════════════════════════════════════════════════════════════════════
//  4. HISTORY  (trend graph)
// ════════════════════════════════════════════════════════════════════════

/** GET /api/score/history/:sanghId?periodType=daily&limit=30 */
const getScoreHistory = asyncHandler(async (req, res) => {
  const { sanghId } = req.params;
  const periodType = req.query.periodType || "daily";
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 366);

  if (!mongoose.Types.ObjectId.isValid(sanghId)) {
    return res.status(400).json({ success: false, message: "Invalid sanghId" });
  }

  if (!["daily", "monthly", "yearly"].includes(periodType)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid periodType" });
  }

  const records = await SanghScore.find({ sanghId, periodType })
    .select(
      "periodKey periodStart selfScore receivedScore totalScore formSubmitted locked",
    )
    .sort({ periodStart: -1 })
    .limit(limit)
    .lean();

  return res.json({
    success: true,
    message: {
      sanghId,
      periodType,
      count: records.length,
      records: records.reverse(), // graph ke liye purana → naya
    },
  });
});

// ════════════════════════════════════════════════════════════════════════
//  5. MONTHLY FORM SUBMIT  (manual data)
// ════════════════════════════════════════════════════════════════════════

/**
 * POST /api/score/monthly-form
 * body: {
 *   sanghId, year, month, reportId (optional),
 *   officialVisit, meetings, projects, trainings,
 *   tirthAccount, businessAccount, sadhuAccount,
 *   matrimonyRegister, employmentRegister, scholarshipRegister,
 *   donationAmount
 * }
 *
 * Sirf president/secretary/treasurer bhar sakta hai.
 * 1-5 tareekh ke beech hi chalega. Lock ke baad reject.
 */
const submitMonthlyForm = asyncHandler(async (req, res) => {
  const { sanghId, year, month, reportId } = req.body;

  if (!sanghId || !mongoose.Types.ObjectId.isValid(sanghId)) {
    return res
      .status(400)
      .json({ success: false, message: "Valid sanghId required" });
  }

  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!y || !m || m < 1 || m > 12) {
    return res
      .status(400)
      .json({ success: false, message: "Valid year and month required" });
  }

  // ── permission ──
  const allowed = await canManageSangh(req.user, sanghId);
  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: "Only the sangh president/secretary can submit this form",
    });
  }

  // ── form window check ──
  const prev = scoreService.getPreviousMonth();
  const isPrevMonth = y === prev.year && m === prev.month;
  const windowOpen = scoreService.isFormWindowOpen(new Date());

  if (req.user.role !== "superadmin") {
    if (!isPrevMonth) {
      return res.status(400).json({
        success: false,
        message: `You can only submit the form for last month (${prev.month}/${prev.year})`,
      });
    }
    if (!windowOpen) {
      return res.status(400).json({
        success: false,
        message: `Form can only be submitted between the ${FORM_WINDOW.startDay}st and ${FORM_WINDOW.endDay}th of the month`,
      });
    }
  }

  // ── manual counts ──
  const manualCounts = {
    officialVisit: req.body.officialVisit,
    meetings: req.body.meetings,
    projects: req.body.projects,
    trainings: req.body.trainings,
    tirthAccount: req.body.tirthAccount,
    businessAccount: req.body.businessAccount,
    sadhuAccount: req.body.sadhuAccount,
    matrimonyRegister: req.body.matrimonyRegister,
    employmentRegister: req.body.employmentRegister,
    scholarshipRegister: req.body.scholarshipRegister,
    donationAmount: req.body.donationAmount,
  };

  try {
    const doc = await scoreService.saveMonthlyManualData({
      sanghId,
      year: y,
      month: m,
      manualCounts,
      reportId: reportId || null,
    });

    return res.json({
      success: true,
      message: {
        saved: true,
        sanghId,
        year: y,
        month: m,
        periodKey: doc.periodKey,
        counts: doc.counts,
        breakdown: doc.breakdown,
        selfScore: doc.selfScore,
        receivedScore: doc.receivedScore,
        totalScore: doc.totalScore,
        distributedTo: doc.distributedTo,
      },
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════
//  6. LEADERBOARD
// ════════════════════════════════════════════════════════════════════════

/**
 * GET /api/score/leaderboard?periodType=monthly&periodKey=2026-07&level=city&sanghType=main&limit=20
 */
const getLeaderboard = asyncHandler(async (req, res) => {
  const periodType = req.query.periodType || "monthly";
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  let periodKey = req.query.periodKey;
  if (!periodKey) {
    if (periodType === "daily") {
      periodKey = scoreService.buildPeriodKey(
        "daily",
        scoreService.getYesterday(),
      );
    } else if (periodType === "monthly") {
      const prev = scoreService.getPreviousMonth();
      periodKey = scoreService.buildPeriodKey(
        "monthly",
        new Date(prev.year, prev.month - 1, 1),
      );
    } else {
      periodKey = String(new Date().getFullYear());
    }
  }

  const filter = { periodType, periodKey };
  if (req.query.level) filter.level = req.query.level;
  if (req.query.sanghType) filter.sanghType = req.query.sanghType;

  const records = await SanghScore.find(filter)
    .select(
      "sanghId sanghName level sanghType selfScore receivedScore totalScore",
    )
    .sort({ totalScore: -1 })
    .limit(limit)
    .lean();

  // ── NEW: har sangh ka location (state/district/city) jodo — podium ke liye ──
  let locationMap = {};
  try {
    const sanghIds = records.map((r) => r.sanghId).filter(Boolean);
    if (sanghIds.length) {
      const sanghs = await Sangh()
        .find({ _id: { $in: sanghIds } })
        .select("location")
        .lean();
      sanghs.forEach((sg) => {
        locationMap[String(sg._id)] = sg.location || {};
      });
    }
  } catch (locErr) {
    console.error("Leaderboard location fetch skipped:", locErr.message);
  }

  return res.json({
    success: true,
    message: {
      periodType,
      periodKey,
      count: records.length,
      leaderboard: records.map((r, i) => ({
        rank: i + 1,
        ...r,
        location: locationMap[String(r.sanghId)] || {},
      })),
    },
  });
});

// ════════════════════════════════════════════════════════════════════════
//  7. CONFIG  (UI ke liye point table)
// ════════════════════════════════════════════════════════════════════════

/** GET /api/score/config — frontend point table dikhane ke liye */
const getScoreConfig = asyncHandler(async (req, res) => {
  return res.json({
    success: true,
    message: {
      points: POINTS,
      autoFields: AUTO_FIELDS,
      manualFields: MANUAL_FIELDS,
      labels: FIELD_LABELS,
      donationSlabs: DONATION_SLABS.map((s) => ({
        min: s.min,
        max: s.max === Infinity ? null : s.max,
        points: s.points,
      })),
      distribution: DISTRIBUTION,
      formWindow: FORM_WINDOW,
    },
  });
});

// ════════════════════════════════════════════════════════════════════════
//  8. MANUAL TRIGGERS  (superadmin — testing)
// ════════════════════════════════════════════════════════════════════════

/** POST /api/score/trigger/daily   body: { date? } */
const triggerDaily = asyncHandler(async (req, res) => {
  const result = await triggers.daily(req.body.date || null);
  return res.json({ success: true, message: result });
});

/** POST /api/score/trigger/monthly  body: { year, month } */
const triggerMonthly = asyncHandler(async (req, res) => {
  const result = await triggers.monthly(
    parseInt(req.body.year, 10) || null,
    parseInt(req.body.month, 10) || null,
  );
  return res.json({ success: true, message: result });
});

/** POST /api/score/trigger/yearly  body: { year } */
const triggerYearly = asyncHandler(async (req, res) => {
  const result = await triggers.yearly(parseInt(req.body.year, 10) || null);
  return res.json({ success: true, message: result });
});

/** POST /api/score/trigger/lock  body: { year, month } */
const triggerLock = asyncHandler(async (req, res) => {
  const result = await triggers.lock(
    parseInt(req.body.year, 10) || null,
    parseInt(req.body.month, 10) || null,
  );
  return res.json({ success: true, message: result });
});

module.exports = {
  getDailyScore,
  getMonthlyScore,
  getYearlyScore,
  getScoreHistory,
  submitMonthlyForm,
  getLeaderboard,
  getScoreConfig,
  triggerDaily,
  triggerMonthly,
  triggerYearly,
  triggerLock,
};
