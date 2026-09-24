const mongoose = require("mongoose");
const TirthEmployee = require("../../model/TirthModels/tirthEmployeeModel");
const TirthAttendance = require("../../model/TirthModels/tirthAttendanceModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");

const STATUSES = ["present", "half", "absent", "leave"];

/* 'YYYY-MM-DD' -> UTC midnight */
const toDay = (v) => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

const todayUTC = () => {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()),
  );
};

/**
 * Attendance tab — ek din ki list
 * GET /api/tirth-booking/manage/:tirthId/attendance?date=YYYY-MM-DD
 *
 * Sabhi active employees + us din ka status (jo mark nahi hua wo null).
 */
const getAttendanceByDate = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const date = toDay(req.query.date) || todayUTC();

    if (date > todayUTC()) {
      return errorResponse(
        res,
        "Future date ki attendance nahi lag sakti",
        400,
      );
    }

    const [employees, records] = await Promise.all([
      TirthEmployee.find({
        tirthId,
        status: "active",
        employmentStatus: "active",
        joinDate: { $lte: date }, // join se pehle ki attendance nahi
      })
        .sort({ name: 1 })
        .lean(),
      TirthAttendance.find({ tirthId, date }).lean(),
    ]);

    const map = {};
    records.forEach((r) => {
      map[String(r.employeeId)] = r;
    });

    const list = employees.map((e) => {
      const rec = map[String(e._id)];
      return {
        employeeId: String(e._id),
        name: e.name,
        role: e.role,
        roleOther: e.roleOther,
        salary: e.salary,
        status: rec?.status || null,
        note: rec?.note || "",
      };
    });

    const summary = { present: 0, half: 0, absent: 0, leave: 0, pending: 0 };
    list.forEach((x) => {
      if (x.status) summary[x.status] += 1;
      else summary.pending += 1;
    });

    return successResponse(res, {
      date: date.toISOString().slice(0, 10),
      employees: list,
      summary,
    });
  } catch (error) {
    console.error("❌ getAttendanceByDate error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Attendance mark / update (ek ya bahut saare ek saath)
 * POST /api/tirth-booking/manage/:tirthId/attendance
 * body: { date, records: [{ employeeId, status, note }] }
 */
const markAttendance = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { date, records } = req.body;

    const day = toDay(date);
    if (!day) return errorResponse(res, "Valid date is required", 400);
    if (day > todayUTC()) {
      return errorResponse(
        res,
        "Future date ki attendance nahi lag sakti",
        400,
      );
    }

    if (!Array.isArray(records) || records.length === 0) {
      return errorResponse(res, "Kam se kam ek record chahiye", 400);
    }

    const invalid = records.find(
      (r) => !r.employeeId || !STATUSES.includes(r.status),
    );
    if (invalid) return errorResponse(res, "Invalid attendance status", 400);

    const ops = records.map((r) => ({
      updateOne: {
        filter: { employeeId: r.employeeId, date: day },
        update: {
          $set: {
            tirthId,
            employeeId: r.employeeId,
            date: day,
            status: r.status,
            note: r.note || "",
            markedBy: req.user?._id,
          },
        },
        upsert: true,
      },
    }));

    await TirthAttendance.bulkWrite(ops);

    return successResponse(res, {
      message: `${records.length} employee ki attendance save ho gayi`,
      date: day.toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error("❌ markAttendance error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Salary Report — mahine ka hisaab
 * GET /api/tirth-booking/manage/:tirthId/attendance/report?month=YYYY-MM
 *
 * Per-day rate = monthly salary / us mahine ke total din (30/31)
 * Payable = (present + leave) × rate + half × rate/2
 */
const getMonthlyReport = async (req, res) => {
  try {
    const { tirthId } = req.params;

    const raw = String(req.query.month || "").slice(0, 7);
    const m = raw.match(/^(\d{4})-(\d{2})$/);

    const now = new Date();
    const year = m ? Number(m[1]) : now.getUTCFullYear();
    const month = m ? Number(m[2]) - 1 : now.getUTCMonth();

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const [employees, agg] = await Promise.all([
      TirthEmployee.find({ tirthId, status: "active" })
        .sort({ name: 1 })
        .lean(),
      TirthAttendance.aggregate([
        {
          $match: {
            tirthId: new mongoose.Types.ObjectId(String(tirthId)),
            date: { $gte: monthStart, $lt: monthEnd },
          },
        },
        {
          $group: {
            _id: { employeeId: "$employeeId", status: "$status" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // employeeId -> { present, half, absent, leave }
    const counts = {};
    agg.forEach((row) => {
      const id = String(row._id.employeeId);
      if (!counts[id])
        counts[id] = { present: 0, half: 0, absent: 0, leave: 0 };
      counts[id][row._id.status] = row.count;
    });

    const rows = employees.map((e) => {
      const c = counts[String(e._id)] || {
        present: 0,
        half: 0,
        absent: 0,
        leave: 0,
      };

      const salary = Number(e.salary) || 0;
      const perDay = daysInMonth > 0 ? salary / daysInMonth : 0;

      const paidDays = c.present + c.leave + c.half * 0.5;
      const payable = Math.round(perDay * paidDays);
      const marked = c.present + c.half + c.absent + c.leave;

      return {
        employeeId: String(e._id),
        name: e.name,
        role: e.role,
        roleOther: e.roleOther,
        employmentStatus: e.employmentStatus,
        salary,
        perDay: Math.round(perDay),
        present: c.present,
        half: c.half,
        absent: c.absent,
        leave: c.leave,
        markedDays: marked,
        unmarkedDays: Math.max(0, daysInMonth - marked),
        paidDays,
        payable,
      };
    });

    const totals = {
      employees: rows.length,
      totalSalary: rows.reduce((s, r) => s + r.salary, 0),
      totalPayable: rows.reduce((s, r) => s + r.payable, 0),
    };
    totals.saved = Math.max(0, totals.totalSalary - totals.totalPayable);

    return successResponse(res, {
      month: `${year}-${String(month + 1).padStart(2, "0")}`,
      daysInMonth,
      rows,
      totals,
    });
  } catch (error) {
    console.error("❌ getMonthlyReport error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  STATUSES,
  getAttendanceByDate,
  markAttendance,
  getMonthlyReport,
};
