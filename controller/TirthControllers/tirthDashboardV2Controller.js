const mongoose = require("mongoose");
const TirthBooking = require("../../model/TirthModels/tirthBookingModel");
const TirthRoom = require("../../model/TirthModels/tirthRoomModel");
const TirthEmployee = require("../../model/TirthModels/tirthEmployeeModel");
const TirthComplaint = require("../../model/TirthModels/tirthComplaintModel");
const TirthAnnouncement = require("../../model/TirthModels/tirthAnnouncementModel");
const Donation = require("../../model/Donation/donation");
const { TirthItem } = require("../../model/TirthModels/tirthInventoryModel");
const { TirthPujaBooking } = require("../../model/TirthModels/tirthPujaModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");

/**
 * Manage Dashboard — saare modules ka data ek jagah.
 *
 * Purana getTirthOverview waisa hi hai (booking-focused).
 * Ye uske upar chalta hai — manager ko ek nazar me poora tirth dikhta hai
 * aur pata chalta hai ki aaj kaunsa kaam pending hai.
 */

const todayUTC = () => {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()),
  );
};

const addDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

const num = (v) => Number(v) || 0;

/**
 * GET /api/tirth-booking/manage/:tirthId/dashboard
 */
const getTirthDashboard = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const oid = new mongoose.Types.ObjectId(String(tirthId));

    const today = todayUTC();
    const tomorrow = addDays(today, 1);
    const in30 = addDays(today, 30);

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const [
      /* bookings */
      pendingBookings,
      todayCheckIns,
      todayCheckOuts,
      monthBookings,
      rooms,
      occupiedToday,

      /* puja */
      pendingPuja,
      todayPuja,
      upcomingPuja,

      /* complaints */
      openComplaints,

      /* employees */
      employeeAgg,
      todayAttendance,

      /* inventory */
      items,

      /* announcements */
      liveAnnouncements,

      /* donations */
      donationAgg,
    ] = await Promise.all([
      TirthBooking.countDocuments({ tirthId, status: "pending" }),
      TirthBooking.countDocuments({
        tirthId,
        status: "approved",
        checkIn: today,
      }),
      TirthBooking.countDocuments({
        tirthId,
        status: "approved",
        checkOut: today,
      }),
      TirthBooking.countDocuments({
        tirthId,
        createdAt: { $gte: monthStart },
        status: { $ne: "cancelled" },
      }),
      TirthRoom.find({ tirthId, status: "active" })
        .select("total booked")
        .lean(),
      // aaj kitne kamre bhare hain
      TirthBooking.aggregate([
        {
          $match: {
            tirthId: oid,
            status: "approved",
            checkIn: { $lte: today },
            checkOut: { $gt: today },
          },
        },
        { $group: { _id: null, rooms: { $sum: "$rooms" } } },
      ]),

      TirthPujaBooking.countDocuments({ tirthId, status: "pending" }),
      TirthPujaBooking.find({
        tirthId,
        status: "approved",
        date: today,
      })
        .select("pujaName name startTime persons")
        .sort({ startTime: 1 })
        .lean(),
      TirthPujaBooking.countDocuments({
        tirthId,
        status: "approved",
        date: { $gt: today, $lte: addDays(today, 7) },
      }),

      TirthComplaint.countDocuments({
        tirthId,
        status: { $in: ["open", "in_progress"] },
      }),

      TirthEmployee.aggregate([
        { $match: { tirthId: oid, status: "active" } },
        {
          $group: {
            _id: "$employmentStatus",
            count: { $sum: 1 },
            salary: { $sum: "$salary" },
          },
        },
      ]),
      // aaj ki attendance lagi ya nahi
      mongoose
        .model("TirthAttendance")
        .countDocuments({ tirthId, date: today }),

      TirthItem.find({ tirthId, status: "active" })
        .select("name stock minStock unit expiryDate")
        .lean(),

      TirthAnnouncement.countDocuments({
        tirthId,
        status: "active",
        expiresAt: { $gte: new Date() },
      }),

      Donation.aggregate([
        {
          $match: {
            beneficiaryTirthId: oid,
            paymentStatus: "success",
          },
        },
        {
          $group: {
            _id: "$settlementStatus",
            count: { $sum: 1 },
            amount: { $sum: { $toDouble: { $ifNull: ["$amount", 0] } } },
            payable: { $sum: { $ifNull: ["$payableAmount", 0] } },
          },
        },
      ]),
    ]);

    /* ---- rooms ---- */
    const totalRooms = rooms.reduce((s, r) => s + num(r.total), 0);
    const roomsOccupied = num(occupiedToday?.[0]?.rooms);
    const occupancy = totalRooms
      ? Math.round((roomsOccupied / totalRooms) * 100)
      : 0;

    /* ---- employees ---- */
    const emp = { total: 0, active: 0, monthlySalary: 0 };
    employeeAgg.forEach((r) => {
      emp.total += num(r.count);
      if (r._id === "active") {
        emp.active = num(r.count);
        emp.monthlySalary = num(r.salary);
      }
    });

    /* ---- inventory ---- */
    const inv = {
      totalItems: items.length,
      lowStock: 0,
      expiringSoon: 0,
      expired: 0,
    };
    const lowStockItems = [];

    items.forEach((it) => {
      if (num(it.stock) <= num(it.minStock)) {
        inv.lowStock += 1;
        if (lowStockItems.length < 5) {
          lowStockItems.push({
            name: it.name,
            stock: it.stock,
            minStock: it.minStock,
            unit: it.unit,
          });
        }
      }
      if (it.expiryDate) {
        const exp = new Date(it.expiryDate);
        if (exp < now) inv.expired += 1;
        else if (exp <= in30) inv.expiringSoon += 1;
      }
    });

    /* ---- donations ---- */
    const don = {
      total: 0,
      totalAmount: 0,
      pendingCount: 0,
      pendingAmount: 0,
      settledAmount: 0,
    };
    donationAgg.forEach((r) => {
      don.total += num(r.count);
      don.totalAmount += num(r.amount);
      if (r._id === "settled") don.settledAmount += num(r.payable);
      else {
        don.pendingCount += num(r.count);
        don.pendingAmount += num(r.payable);
      }
    });

    /* ---- action center — jo kaam pending hai ---- */
    const actions = [];

    if (pendingBookings > 0) {
      actions.push({
        id: "bookings",
        tab: "bookings",
        priority: 1,
        icon: "calendar",
        label: `${pendingBookings} room booking${pendingBookings > 1 ? "s" : ""} to approve`,
        count: pendingBookings,
      });
    }
    if (pendingPuja > 0) {
      actions.push({
        id: "puja",
        tab: "puja",
        priority: 1,
        icon: "flame",
        label: `${pendingPuja} puja booking${pendingPuja > 1 ? "s" : ""} to approve`,
        count: pendingPuja,
      });
    }
    if (openComplaints > 0) {
      actions.push({
        id: "complaints",
        tab: "complaints",
        priority: 2,
        icon: "message",
        label: `${openComplaints} complaint${openComplaints > 1 ? "s" : ""} need a reply`,
        count: openComplaints,
      });
    }
    if (emp.active > 0 && todayAttendance < emp.active) {
      const left = emp.active - todayAttendance;
      actions.push({
        id: "attendance",
        tab: "employees",
        priority: 2,
        icon: "users",
        label: `Attendance not marked for ${left} employee${left > 1 ? "s" : ""}`,
        count: left,
      });
    }
    if (inv.lowStock > 0) {
      actions.push({
        id: "lowstock",
        tab: "inventory",
        priority: 3,
        icon: "package",
        label: `${inv.lowStock} item${inv.lowStock > 1 ? "s" : ""} running low`,
        count: inv.lowStock,
      });
    }
    if (inv.expired > 0) {
      actions.push({
        id: "expired",
        tab: "inventory",
        priority: 3,
        icon: "alert",
        label: `${inv.expired} item${inv.expired > 1 ? "s have" : " has"} expired`,
        count: inv.expired,
      });
    }
    if (don.pendingCount > 0) {
      actions.push({
        id: "donations",
        tab: "donations",
        priority: 4,
        icon: "heart",
        label: `₹${don.pendingAmount.toLocaleString("en-IN")} donation payout awaited`,
        count: don.pendingCount,
      });
    }

    actions.sort((a, b) => a.priority - b.priority);

    return successResponse(res, {
      actions,

      today: {
        checkIns: todayCheckIns,
        checkOuts: todayCheckOuts,
        pujas: todayPuja.map((p) => ({
          id: String(p._id),
          pujaName: p.pujaName,
          name: p.name,
          startTime: p.startTime,
          persons: p.persons,
        })),
        attendanceMarked: todayAttendance,
        attendanceTotal: emp.active,
      },

      modules: {
        bookings: {
          pending: pendingBookings,
          thisMonth: monthBookings,
        },
        rooms: {
          total: totalRooms,
          occupied: roomsOccupied,
          free: Math.max(0, totalRooms - roomsOccupied),
          occupancy,
        },
        puja: {
          pending: pendingPuja,
          today: todayPuja.length,
          upcoming: upcomingPuja,
        },
        employees: emp,
        inventory: inv,
        lowStockItems,
        complaints: { open: openComplaints },
        announcements: { live: liveAnnouncements },
        donations: don,
      },
    });
  } catch (error) {
    console.error("❌ getTirthDashboard error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = { getTirthDashboard };
