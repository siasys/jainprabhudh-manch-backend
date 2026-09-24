const express = require("express");
const router = express.Router();

const {
  authMiddleware,
} = require("../../middlewares/authMiddlewares");

const {
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
} = require("../../controller/ScoreControllers/scoreController");

/**
 * scoreRoutes.js
 * ----------------------------------------------------------------------------
 * Base: /api/score
 * NAYI routes — reportingRoutes.js ko haath nahi lagaya.
 * ----------------------------------------------------------------------------
 */

// saari routes par auth zaroori
router.use(authMiddleware);

// ── CONFIG ──────────────────────────────────────────────────────────────
// GET /api/score/config — point table, donation slabs, distribution %
router.get("/config", getScoreConfig);

// ── LEADERBOARD ─────────────────────────────────────────────────────────
// GET /api/score/leaderboard?periodType=monthly&periodKey=2026-07&level=city
router.get("/leaderboard", getLeaderboard);

// ── MONTHLY FORM SUBMIT (president only) ────────────────────────────────
// POST /api/score/monthly-form
router.post("/monthly-form", submitMonthlyForm);

// ── MANUAL TRIGGERS (superadmin only — testing) ─────────────────────────
router.post("/trigger/daily", triggerDaily);
router.post("/trigger/monthly", triggerMonthly);
router.post("/trigger/yearly", triggerYearly);
router.post("/trigger/lock", triggerLock);

// ── SCORE READS ─────────────────────────────────────────────────────────
// NOTE: ye :sanghId wali routes SABSE NEECHE hain — warna '/config' aur
// '/leaderboard' ko bhi sanghId samajh liya jaata.

// GET /api/score/daily/:sanghId?date=2026-07-13
router.get("/daily/:sanghId", getDailyScore);

// GET /api/score/monthly/:sanghId?year=2026&month=7
router.get("/monthly/:sanghId", getMonthlyScore);

// GET /api/score/yearly/:sanghId?year=2026
router.get("/yearly/:sanghId", getYearlyScore);

// GET /api/score/history/:sanghId?periodType=daily&limit=30
router.get("/history/:sanghId", getScoreHistory);

module.exports = router;
