const mongoose = require("mongoose");
const TirthBooking = require("../../model/TirthModels/Tirthbookingmodel");
const TirthRoom = require("../../model/TirthModels/Tirthroommodel");
const Tirth = require("../../model/TirthModels/tirthModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");
const {
  BLOCKING_STATUSES,
  toDay,
  todayUTC,
  diffNights,
  getRoomsOccupancy,
} = require("./Tirthroomcontroller");

/* ------------------------------------------------------------------
   OPTIONAL: notification bhejne ki koshish (fail ho to booking ruke na)
   Agar aapke project me notification model ka path alag hai to
   sirf ye ek line badal dena.
------------------------------------------------------------------ */
const safeNotify = async ({ userId, title, message, type }) => {
  try {
    if (!userId) return;
    const Notification = require("../../model/SocialMediaModels/notificationModel");
    await Notification.create({
      recipientId: userId,
      senderId: userId,
      type: type || "tirth_booking",
      title,
      message,
    });
  } catch (err) {
    console.log("ℹ️ Tirth booking notification skipped:", err.message);
  }
};

/* ------------------------------------------------------------------
   Purani approved bookings ko auto "completed" mark karo
------------------------------------------------------------------ */
const autoCompleteOldBookings = async (filter = {}) => {
  try {
    await TirthBooking.updateMany(
      { ...filter, status: "approved", checkOut: { $lt: todayUTC() } },
      { $set: { status: "completed" } },
    );
  } catch (err) {
    console.log("ℹ️ autoCompleteOldBookings skipped:", err.message);
  }
};

/* ==================================================================
   USER SIDE
================================================================== */

/**
 * Tirthbook.jsx — booking request bhejna
 * POST /api/tirth-booking/book/:tirthId
 */
const createBooking = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { roomId, checkIn, checkOut, rooms, guests, name, phone, note } =
      req.body;

    if (!roomId) return errorResponse(res, "Room type is required", 400);
    if (!name || !String(name).trim())
      return errorResponse(res, "Name is required", 400);
    if (!phone || String(phone).trim().length < 10) {
      return errorResponse(res, "Valid 10-digit phone number is required", 400);
    }

    const inDate = toDay(checkIn);
    const outDate = toDay(checkOut);

    if (!inDate || !outDate)
      return errorResponse(
        res,
        "Valid check-in / check-out dates required",
        400,
      );
    if (outDate <= inDate)
      return errorResponse(
        res,
        "Check-out date check-in ke baad honi chahiye",
        400,
      );
    if (inDate < todayUTC())
      return errorResponse(res, "Check-in date past me nahi ho sakti", 400);

    const numRooms = Math.max(1, Number(rooms) || 1);
    const numGuests = Math.max(1, Number(guests) || 1);
    const nights = diffNights(inDate, outDate);

    const room = await TirthRoom.findOne({
      _id: roomId,
      tirthId,
      status: "active",
    });
    if (!room) return errorResponse(res, "Room type not found", 404);

    // availability check
    const occupancy = await getRoomsOccupancy([room._id], inDate, outDate);
    const booked = occupancy[String(room._id)] || 0;
    const available = Math.max(0, Number(room.total || 0) - booked);

    if (available < numRooms) {
      return errorResponse(
        res,
        available === 0
          ? "In dates me ye room type fully booked hai"
          : `In dates me sirf ${available} room available hai`,
        400,
      );
    }

    const tirth = await Tirth.findById(tirthId)
      .select("basic address team")
      .lean();

    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    const pricePerNight = Number(room.price || 0);
    const amount = pricePerNight * numRooms * nights;

    const booking = await TirthBooking.create({
      tirthId,
      roomId: room._id,
      roomTypeName: room.name,
      isAC: room.isAC,
      hasBath: room.hasBath,

      tirthName: tirth.basic?.name || "",
      tirthCity: tirth.address?.city || "",
      tirthState: tirth.address?.state || "",
      tirthPhone: tirth.team?.bookingContact || tirth.team?.managerPhone || "",

      userId: req.user?._id,
      name: String(name).trim(),
      phone: String(phone).trim(),
      note: note || "",

      checkIn: inDate,
      checkOut: outDate,
      nights,
      rooms: numRooms,
      guests: numGuests,

      pricePerNight,
      amount,
      status: "pending",
    });

    // tirth manager ko notify (soft)
    try {
      const User = require("../../model/UserRegistrationModels/userModel");
      const managers = await User.find({ "tirthRoles.tirthId": tirthId })
        .select("_id")
        .lean();
      await Promise.all(
        managers.map((m) =>
          safeNotify({
            userId: m._id,
            title: "Nayi booking request",
            message: `${booking.name} ne ${booking.roomTypeName} ke liye booking request bheji hai`,
            type: "tirth_booking",
          }),
        ),
      );
    } catch (e) {
      console.log("ℹ️ manager notify skipped:", e.message);
    }

    return successResponse(res, {
      message: "Booking request bhej di gayi hai",
      booking,
    });
  } catch (error) {
    console.error("❌ createBooking error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * MyBookings.jsx
 * GET /api/tirth-booking/my-bookings?status=&page=&limit=
 */
const getMyBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);

    await autoCompleteOldBookings({ userId });

    const query = { userId };
    if (status && status !== "all") query.status = status;

    const [bookings, total] = await Promise.all([
      TirthBooking.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthBooking.countDocuments(query),
    ]);

    return successResponse(res, {
      bookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * MyBookings.jsx — user apni booking cancel kare
 * PUT /api/tirth-booking/cancel/:bookingId
 */
const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await TirthBooking.findById(bookingId);
    if (!booking) return errorResponse(res, "Booking not found", 404);

    const isOwner =
      booking.userId && booking.userId.toString() === req.user._id.toString();
    const isManager = isUserTirthManager(req.user, booking.tirthId);

    if (!isOwner && !isManager) {
      return errorResponse(res, "You cannot cancel this booking", 403);
    }

    if (!["pending", "approved"].includes(booking.status)) {
      return errorResponse(
        res,
        `Ye booking already ${booking.status} hai`,
        400,
      );
    }

    booking.status = "cancelled";
    booking.cancelledAt = new Date();
    await booking.save();

    return successResponse(res, {
      message: "Booking cancelled successfully",
      booking,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Single booking detail
 * GET /api/tirth-booking/detail/:bookingId
 */
const getBookingDetails = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await TirthBooking.findById(bookingId).lean();
    if (!booking) return errorResponse(res, "Booking not found", 404);

    const isOwner =
      booking.userId && booking.userId.toString() === req.user._id.toString();
    const isManager = isUserTirthManager(req.user, booking.tirthId);

    if (!isOwner && !isManager) {
      return errorResponse(res, "You cannot view this booking", 403);
    }

    return successResponse(res, booking);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   MANAGER SIDE
================================================================== */

/**
 * ManageBookings.jsx — list + tab counts + search
 * GET /api/tirth-booking/manage/:tirthId/bookings?status=&search=&page=&limit=
 */
const getTirthBookings = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { status, search } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);

    await autoCompleteOldBookings({ tirthId });

    const query = { tirthId };
    if (status && status !== "all") query.status = status;

    if (search && String(search).trim()) {
      const rx = new RegExp(
        String(search)
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      query.$or = [{ name: rx }, { phone: rx }, { roomTypeName: rx }];
    }

    const [bookings, total, counts] = await Promise.all([
      TirthBooking.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthBooking.countDocuments(query),
      TirthBooking.aggregate([
        { $match: { tirthId: new mongoose.Types.ObjectId(String(tirthId)) } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const countMap = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
      completed: 0,
      all: 0,
    };
    counts.forEach((c) => {
      countMap[c._id] = c.count;
      countMap.all += c.count;
    });

    return successResponse(res, {
      bookings,
      counts: countMap,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * ManageBookings.jsx — Approve / Reject
 * PUT /api/tirth-booking/manage/booking/:bookingId/status
 * body: { status: 'approved' | 'rejected', rejectReason }
 */
const updateBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, rejectReason } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return errorResponse(
        res,
        "Invalid status. approved ya rejected hona chahiye",
        400,
      );
    }

    const booking = await TirthBooking.findById(bookingId);
    if (!booking) return errorResponse(res, "Booking not found", 404);

    if (!isUserTirthManager(req.user, booking.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    if (booking.status !== "pending") {
      return errorResponse(
        res,
        `Ye booking already ${booking.status} hai`,
        400,
      );
    }

    // approve karte waqt dobara availability verify
    if (status === "approved") {
      const room = await TirthRoom.findById(booking.roomId);
      if (!room) return errorResponse(res, "Room type not found", 404);

      const occupancy = await getRoomsOccupancy(
        [room._id],
        booking.checkIn,
        booking.checkOut,
        booking._id, // khud ko count na kare
      );
      const booked = occupancy[String(room._id)] || 0;
      const available = Math.max(0, Number(room.total || 0) - booked);

      if (available < booking.rooms) {
        return errorResponse(
          res,
          `In dates me sirf ${available} room available hai, ye booking approve nahi ho sakti`,
          400,
        );
      }
    }

    booking.status = status;
    booking.rejectReason = status === "rejected" ? rejectReason || "" : "";
    booking.actionBy = req.user._id;
    booking.actionAt = new Date();
    await booking.save();

    // approved + paid booking ka auto accounting entry
    if (status === "approved" && Number(booking.amount) > 0) {
      try {
        const {
          createBookingIncomeEntry,
        } = require("./Tirthaccountingcontroller");
        await createBookingIncomeEntry(booking, req.user._id);
      } catch (e) {
        console.log("ℹ️ auto accounting entry skipped:", e.message);
      }
    }

    await safeNotify({
      userId: booking.userId,
      title: status === "approved" ? "Booking approved" : "Booking rejected",
      message:
        status === "approved"
          ? `${booking.tirthName} me aapki booking approve ho gayi hai`
          : `${booking.tirthName} me aapki booking reject ho gayi hai`,
      type: "tirth_booking",
    });

    return successResponse(res, {
      message: `Booking ${status} successfully`,
      booking,
    });
  } catch (error) {
    console.error("❌ updateBookingStatus error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  BLOCKING_STATUSES,
  autoCompleteOldBookings,

  createBooking,
  getMyBookings,
  cancelBooking,
  getBookingDetails,

  getTirthBookings,
  updateBookingStatus,
};
