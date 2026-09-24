const mongoose = require("mongoose");
const TirthBooking = require("../../model/TirthModels/tirthBookingModel");
const TirthRoom = require("../../model/TirthModels/tirthRoomModel");
const TirthAccounting = require("../../model/TirthModels/tirthAccountingModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const {
  todayUTC,
  addDaysUTC,
  getRoomsOccupancy,
} = require("./tirthRoomController");

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pct = (curr, prev) => {
  if (!prev) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
};

/**
 * ManageOverview.jsx ka pura data
 * GET /api/tirth-booking/manage/:tirthId/overview
 */
const getTirthOverview = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const oid = new mongoose.Types.ObjectId(String(tirthId));

    const today = todayUTC();
    const weekStart = addDaysUTC(today, -6);

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const prevMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );

    const [
      totalBookings,
      thisMonthBookings,
      prevMonthBookings,
      pendingCount,
      rooms,
      weeklyAgg,
      pendingList,
      upcomingList,
      monthAcc,
      prevMonthAcc,
    ] = await Promise.all([
      TirthBooking.countDocuments({ tirthId, status: { $ne: "cancelled" } }),

      TirthBooking.countDocuments({ tirthId, createdAt: { $gte: monthStart } }),
      TirthBooking.countDocuments({
        tirthId,
        createdAt: { $gte: prevMonthStart, $lt: monthStart },
      }),

      TirthBooking.countDocuments({ tirthId, status: "pending" }),

      TirthRoom.find({ tirthId, status: "active" }).select("_id total").lean(),

      TirthBooking.aggregate([
        { $match: { tirthId: oid, createdAt: { $gte: weekStart } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: "UTC",
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),

      TirthBooking.find({ tirthId, status: "pending" })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),

      TirthBooking.find({
        tirthId,
        status: "approved",
        checkIn: { $gte: today },
      })
        .sort({ checkIn: 1 })
        .limit(5)
        .lean(),

      TirthAccounting.aggregate([
        {
          $match: {
            tirthId: oid,
            status: "active",
            date: { $gte: monthStart },
          },
        },
        {
          $group: {
            _id: { type: "$type", category: "$category" },
            amount: { $sum: "$amount" },
          },
        },
      ]),

      TirthAccounting.aggregate([
        {
          $match: {
            tirthId: oid,
            status: "active",
            date: { $gte: prevMonthStart, $lt: monthStart },
          },
        },
        { $group: { _id: "$type", amount: { $sum: "$amount" } } },
      ]),
    ]);

    /* ---- rooms occupancy (aaj ke din) ---- */
    const roomsTotal = rooms.reduce((s, r) => s + Number(r.total || 0), 0);
    let roomsOccupied = 0;
    if (rooms.length > 0) {
      const occ = await getRoomsOccupancy(
        rooms.map((r) => r._id),
        today,
        addDaysUTC(today, 1),
      );
      roomsOccupied = Object.values(occ).reduce(
        (s, v) => s + Number(v || 0),
        0,
      );
    }

    /* ---- weekly chart (last 7 days) ---- */
    const weekMap = {};
    weeklyAgg.forEach((w) => {
      weekMap[w._id] = w.count;
    });

    const weekly = [];
    for (let i = 0; i < 7; i++) {
      const d = addDaysUTC(weekStart, i);
      const key = d.toISOString().slice(0, 10);
      weekly.push({
        day: DAY_NAMES[d.getUTCDay()],
        date: key,
        count: weekMap[key] || 0,
      });
    }

    /* ---- money ---- */
    let monthIncome = 0;
    let monthExpense = 0;
    let monthDonation = 0;
    let monthBooking = 0;

    monthAcc.forEach((row) => {
      const amt = Number(row.amount) || 0;
      if (row._id.type === "income") monthIncome += amt;
      if (row._id.type === "expense") monthExpense += amt;
      if (row._id.category === "donation") monthDonation += amt;
      if (row._id.category === "booking") monthBooking += amt;
    });

    let prevIncome = 0;
    prevMonthAcc.forEach((row) => {
      if (row._id === "income") prevIncome = Number(row.amount) || 0;
    });

    return successResponse(res, {
      stats: {
        totalBookings,
        bookingsTrend: pct(thisMonthBookings, prevMonthBookings),
        pendingRequests: pendingCount,
        roomsTotal,
        roomsOccupied,
        roomsFree: Math.max(0, roomsTotal - roomsOccupied),
        occupancy: roomsTotal
          ? Math.round((roomsOccupied / roomsTotal) * 100)
          : 0,
        monthIncome,
        monthExpense,
        monthBalance: monthIncome - monthExpense,
        incomeTrend: pct(monthIncome, prevIncome),
        monthDonation,
        monthBooking,
      },
      weekly,
      pending: pendingList,
      upcoming: upcomingList,
    });
  } catch (error) {
    console.error("❌ getTirthOverview error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = { getTirthOverview };
