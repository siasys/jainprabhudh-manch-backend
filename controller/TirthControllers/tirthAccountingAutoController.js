const mongoose = require("mongoose");
const TirthAccounting = require("../../model/TirthModels/Tirthaccountingmodel");
const TirthEmployee = require("../../model/TirthModels/tirthEmployeeModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");

/**
 * Tirth Accounting — auto entries + report
 *
 * Purana Tirthaccountingcontroller.js waisa hi hai (manual entries).
 * Ye file uske upar chalti hai:
 *   - doosre modules se apne aap entry banati hai
 *   - mahine ka poora hisaab nikaalti hai
 *
 * Har auto entry me source aur sourceId hota hai, isliye ek hi cheez
 * ki do entry kabhi nahi banti.
 */

const num = (v) => Number(v) || 0;

const toDay = (v) => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

/* ==================================================================
   AUTO ENTRY HELPERS
   Inhe doosre controllers se call karte hain.
   Fail ho jaayein to sirf log — asli kaam nahi rukta.
================================================================== */

/** ek hi source ki dobara entry na bane */
const alreadyExists = async (source, sourceId) => {
  if (!sourceId) return false;
  const found = await TirthAccounting.findOne({
    source,
    sourceId,
    status: "active",
  })
    .select("_id")
    .lean();
  return !!found;
};

/**
 * Puja booking complete hone par — labh rashi income
 */
const recordPujaIncome = async (booking, userId) => {
  try {
    if (!booking || num(booking.labhRashi) <= 0) return;
    if (await alreadyExists("puja", booking._id)) return;

    await TirthAccounting.create({
      tirthId: booking.tirthId,
      type: "income",
      category: "puja",
      title: `${booking.pujaName} — ${booking.name}`,
      amount: num(booking.labhRashi),
      date: booking.date || new Date(),
      note: booking.sankalpName
        ? `Sankalp: ${booking.sankalpName}`
        : "",
      source: "puja",
      sourceId: booking._id,
      isAuto: true,
      createdBy: userId,
    });
  } catch (err) {
    console.log("ℹ️ puja accounting entry skipped:", err.message);
  }
};

/**
 * Donation settle hone par — jo raashi tirth ko mili wo income
 */
const recordDonationIncome = async (donation, userId) => {
  try {
    if (!donation || num(donation.payableAmount) <= 0) return;
    if (await alreadyExists("donation", donation._id)) return;

    const donorName = donation.isGuptDan
      ? "Gupt Daan"
      : donation.userId?.fullName || "Donor";

    await TirthAccounting.create({
      tirthId: donation.beneficiaryTirthId,
      type: "income",
      category: "donation",
      title: `Donation — ${donorName}`,
      amount: num(donation.payableAmount),
      date: donation.settledAt || new Date(),
      note: [
        donation.purpose,
        donation.receiptNumber,
        donation.settlementRef ? `Ref ${donation.settlementRef}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      source: "donation",
      sourceId: donation._id,
      isAuto: true,
      createdBy: userId,
    });
  } catch (err) {
    console.log("ℹ️ donation accounting entry skipped:", err.message);
  }
};

/**
 * Inventory me saamaan aane par — kharch
 * (movement me cost bheja ho to hi entry banti hai)
 */
const recordInventoryExpense = async (movement, cost, userId) => {
  try {
    if (!movement || num(cost) <= 0) return;
    if (await alreadyExists("inventory", movement._id)) return;

    await TirthAccounting.create({
      tirthId: movement.tirthId,
      type: "expense",
      category: "inventory",
      title: `${movement.itemName} — ${movement.quantity} ${movement.unit}`,
      amount: num(cost),
      date: movement.date || new Date(),
      note: movement.person ? `Received by ${movement.person}` : "",
      source: "inventory",
      sourceId: movement._id,
      isAuto: true,
      createdBy: userId,
    });
  } catch (err) {
    console.log("ℹ️ inventory accounting entry skipped:", err.message);
  }
};

/* ==================================================================
   SALARY
================================================================== */

/**
 * Mahine ki salary ko kharch me daalo
 * POST /api/tirth-booking/manage/:tirthId/accounting/salary
 * body: { month: "2026-08", amount }
 *
 * Salary Report se amount aata hai. Manager confirm karke bhejta hai.
 */
const recordSalaryExpense = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { month, amount, note } = req.body;

    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return errorResponse(res, "Valid month is required (YYYY-MM)", 400);
    }

    const amt = num(amount);
    if (amt <= 0) return errorResponse(res, "Amount must be more than zero", 400);

    // us mahine ki entry pehle se to nahi
    const exists = await TirthAccounting.findOne({
      tirthId,
      source: "salary",
      salaryMonth: month,
      status: "active",
    })
      .select("_id amount")
      .lean();

    if (exists) {
      return errorResponse(
        res,
        "Is mahine ki salary pehle se dari ja chuki hai",
        400,
      );
    }

    const [y, mo] = month.split("-").map(Number);
    // mahine ka aakhri din
    const date = new Date(Date.UTC(y, mo, 0));

    const activeCount = await TirthEmployee.countDocuments({
      tirthId,
      status: "active",
      employmentStatus: "active",
    });

    const entry = await TirthAccounting.create({
      tirthId,
      type: "expense",
      category: "salary",
      title: `Staff salary — ${date.toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })}`,
      amount: amt,
      date,
      note: note || `${activeCount} employees`,
      source: "salary",
      salaryMonth: month,
      isAuto: false,
      createdBy: req.user?._id,
    });

    return successResponse(res, {
      message: "Salary recorded in accounting",
      entry,
    });
  } catch (error) {
    console.error("❌ recordSalaryExpense error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   REPORT
================================================================== */

/**
 * Mahine ka poora hisaab
 * GET /api/tirth-booking/manage/:tirthId/accounting/report?month=YYYY-MM
 */
const getAccountingReport = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const oid = new mongoose.Types.ObjectId(String(tirthId));

    const raw = String(req.query.month || "").slice(0, 7);
    const m = raw.match(/^(\d{4})-(\d{2})$/);

    const now = new Date();
    const year = m ? Number(m[1]) : now.getUTCFullYear();
    const month = m ? Number(m[2]) - 1 : now.getUTCMonth();

    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));

    // pichhla mahina — tulna ke liye
    const prevStart = new Date(Date.UTC(year, month - 1, 1));

    const [agg, prevAgg, salaryEntry] = await Promise.all([
      TirthAccounting.aggregate([
        {
          $match: {
            tirthId: oid,
            status: "active",
            date: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: { type: "$type", category: "$category" },
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      TirthAccounting.aggregate([
        {
          $match: {
            tirthId: oid,
            status: "active",
            date: { $gte: prevStart, $lt: start },
          },
        },
        { $group: { _id: "$type", amount: { $sum: "$amount" } } },
      ]),
      TirthAccounting.findOne({
        tirthId,
        source: "salary",
        salaryMonth: `${year}-${String(month + 1).padStart(2, "0")}`,
        status: "active",
      })
        .select("_id amount")
        .lean(),
    ]);

    const income = { total: 0, byCategory: {} };
    const expense = { total: 0, byCategory: {} };

    agg.forEach((r) => {
      const bucket = r._id.type === "income" ? income : expense;
      bucket.total += num(r.amount);
      bucket.byCategory[r._id.category] = {
        amount: num(r.amount),
        count: r.count,
      };
    });

    const prev = { income: 0, expense: 0 };
    prevAgg.forEach((r) => {
      if (r._id === "income") prev.income = num(r.amount);
      if (r._id === "expense") prev.expense = num(r.amount);
    });

    const balance = income.total - expense.total;
    const prevBalance = prev.income - prev.expense;

    const pct = (curr, old) => {
      if (!old) return null;
      return Math.round(((curr - old) / old) * 100);
    };

    return successResponse(res, {
      month: `${year}-${String(month + 1).padStart(2, "0")}`,
      income,
      expense,
      balance,
      previous: {
        income: prev.income,
        expense: prev.expense,
        balance: prevBalance,
      },
      change: {
        income: pct(income.total, prev.income),
        expense: pct(expense.total, prev.expense),
      },
      // salary is mahine ki dari ja chuki hai ya nahi
      salaryRecorded: !!salaryEntry,
      salaryAmount: num(salaryEntry?.amount),
    });
  } catch (error) {
    console.error("❌ getAccountingReport error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  // doosre controllers se call hote hain
  recordPujaIncome,
  recordDonationIncome,
  recordInventoryExpense,

  // routes
  recordSalaryExpense,
  getAccountingReport,
};