const cron = require("node-cron");
const {
  runDailyScore,
  runMonthlyScore,
  runYearlyScore,
  lockMonthlyReports,
  getPreviousMonth,
} = require("../services/scoreService");
const { CRON } = require("../config/scoreConfig");

/**
 * scoreJob.js
 * ----------------------------------------------------------------------------
 * Sangh Scoring ke saare scheduled jobs.
 * Purani koi job (storyCleanupJob, boostExpiry) touch nahi hui.
 *
 * TIMELINE — July ka example:
 *
 *   1 Jul – 31 Jul  → roz raat 12:00 par DAILY score banta rahega
 *                     (5 auto fields: sangh, member, fees, shravak card, panch)
 *
 *   1 Aug 00:05     → MONTHLY snapshot bana (July ka poora auto score)
 *                     Form window KHUL gayi — president ab manual data bharega
 *
 *   1 Aug – 5 Aug   → form khula hai. Jitni baar bhare, score recalculate hoga.
 *
 *   6 Aug 00:00     → form LOCK. July ka score final. Ab edit nahi hoga.
 *
 *   1 Jan 00:30     → YEARLY snapshot (pichle poore saal ka score)
 * ----------------------------------------------------------------------------
 */

const TZ = CRON.timezone; // 'Asia/Kolkata'

/** Ek job ko safely chalao — crash hua to server na gire */
const safeRun = async (label, fn) => {
  const startedAt = Date.now();
  try {
    console.log(`[scoreJob] ▶ ${label} — shuru`);
    const result = await fn();
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[scoreJob] ✅ ${label} — done (${secs}s)`, result || "");
    return result;
  } catch (err) {
    console.error(`[scoreJob] ❌ ${label} — FAIL:`, err.message);
    console.error(err.stack);
  }
};

/**
 * Saare score cron jobs start karo.
 * index.js se ek baar call hoga.
 */
const scheduleScoreJobs = () => {
  // ── 1. DAILY — roz raat 12:00 (midnight) ──────────────────────────
  // PICHLE din ka score banta hai (aaj 00:00 par kal ka din poora ho chuka)
  cron.schedule(
    CRON.daily, // '0 0 * * *'
    () => safeRun("DAILY score", () => runDailyScore()),
    { scheduled: true, timezone: TZ },
  );

  // ── 2. MONTHLY — har mahine ki 1 tareekh, 00:05 ───────────────────
  // Pichle mahine ka snapshot. Auto fields poore mahine ke.
  // Manual fields abhi 0 rahenge — form bharne par recalculate honge.
  cron.schedule(
    CRON.monthly, // '5 0 1 * *'
    () =>
      safeRun("MONTHLY snapshot", async () => {
        const { year, month } = getPreviousMonth();
        return runMonthlyScore(year, month);
      }),
    { scheduled: true, timezone: TZ },
  );

  // ── 3. MONTHLY LOCK — 6 tareekh 00:00 ─────────────────────────────
  // 5 tareekh raat 12 baje form band. Uske baad koi edit nahi.
  // Lock se pehle ek final recalculate — taaki aakhri minute ki entry bhi aa jaye.
  cron.schedule(
    CRON.monthlyLock, // '0 0 6 * *'
    () =>
      safeRun("MONTHLY lock", async () => {
        const { year, month } = getPreviousMonth();
        await runMonthlyScore(year, month); // final recalc
        return lockMonthlyReports(year, month); // ab lock
      }),
    { scheduled: true, timezone: TZ },
  );

  // ── 4. YEARLY — 1 January 00:30 ───────────────────────────────────
  // Pichle poore saal ka score (12 monthly records ka jod + auto counts)
  cron.schedule(
    CRON.yearly, // '30 0 1 1 *'
    () =>
      safeRun("YEARLY snapshot", async () => {
        const year = new Date().getFullYear() - 1;
        return runYearlyScore(year);
      }),
    { scheduled: true, timezone: TZ },
  );

  console.log("[scoreJob] 🕐 Score cron jobs scheduled:");
  console.log(`   DAILY   → ${CRON.daily}        (roz raat 12:00)`);
  console.log(`   MONTHLY → ${CRON.monthly}      (1 tareekh 00:05)`);
  console.log(`   LOCK    → ${CRON.monthlyLock}  (6 tareekh 00:00)`);
  console.log(`   YEARLY  → ${CRON.yearly}   (1 Jan 00:30)`);
  console.log(`   Timezone: ${TZ}`);
};

/**
 * MANUAL TRIGGERS — testing ke liye.
 * Cron ka wait kiye bina turant chala sakte ho.
 * (scoreController inko expose karega, superadmin only)
 */
const triggers = {
  daily: (date) => safeRun("DAILY (manual)", () => runDailyScore(date)),
  monthly: (year, month) =>
    safeRun("MONTHLY (manual)", () => runMonthlyScore(year, month)),
  yearly: (year) => safeRun("YEARLY (manual)", () => runYearlyScore(year)),
  lock: (year, month) =>
    safeRun("LOCK (manual)", () => lockMonthlyReports(year, month)),
};

module.exports = { scheduleScoreJobs, triggers };
