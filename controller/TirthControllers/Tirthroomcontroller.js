const mongoose = require("mongoose");
const TirthRoom = require("../../model/TirthModels/Tirthroommodel");
const TirthBooking = require("../../model/TirthModels/Tirthbookingmodel");
const Tirth = require("../../model/TirthModels/tirthModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");

/* ------------------------------------------------------------------
   HELPERS
------------------------------------------------------------------ */

// ye statuses room ko block karte hain (over-booking se bachne ke liye pending bhi)
const BLOCKING_STATUSES = ["pending", "approved"];

// 'YYYY-MM-DD' ya Date -> UTC midnight Date (timezone problem se bachne ke liye)
const toDay = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    return new Date(
      Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()),
    );
  }
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

const todayUTC = () => toDay(new Date());

const addDaysUTC = (d, n) => {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

const diffNights = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);

/**
 * Diye gaye date-range me har room ka MAX occupancy nikalta hai.
 * Day-by-day sweep — kyunki alag alag dates par alag bookings overlap karti hain.
 *
 * @returns {Object} { roomIdString: maxRoomsOccupied }
 */
const getRoomsOccupancy = async (
  roomIds,
  checkIn,
  checkOut,
  excludeBookingId,
) => {
  const start = toDay(checkIn) || todayUTC();
  let end = toDay(checkOut) || addDaysUTC(start, 1);
  if (end <= start) end = addDaysUTC(start, 1);

  const query = {
    roomId: { $in: roomIds },
    status: { $in: BLOCKING_STATUSES },
    checkIn: { $lt: end },
    checkOut: { $gt: start },
  };

  if (excludeBookingId) {
    query._id = { $ne: new mongoose.Types.ObjectId(String(excludeBookingId)) };
  }

  const bookings = await TirthBooking.find(query)
    .select("roomId rooms checkIn checkOut")
    .lean();

  // har din ke liye per-room sum, phir max
  const result = {};
  roomIds.forEach((id) => {
    result[String(id)] = 0;
  });

  const totalDays = Math.max(1, diffNights(start, end));

  for (let i = 0; i < totalDays; i++) {
    const day = addDaysUTC(start, i);
    const dayMap = {};

    bookings.forEach((b) => {
      const bIn = toDay(b.checkIn);
      const bOut = toDay(b.checkOut);
      if (bIn <= day && bOut > day) {
        const key = String(b.roomId);
        dayMap[key] = (dayMap[key] || 0) + Number(b.rooms || 0);
      }
    });

    Object.keys(dayMap).forEach((key) => {
      if (dayMap[key] > (result[key] || 0)) result[key] = dayMap[key];
    });
  }

  return result;
};

/* ------------------------------------------------------------------
   PUBLIC — Tirthbook.jsx : room types + availability
   GET /api/tirth-booking/rooms/:tirthId?checkIn=&checkOut=
------------------------------------------------------------------ */
const getTirthRooms = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { checkIn, checkOut } = req.query;

    const rooms = await TirthRoom.find({ tirthId, status: "active" })
      .sort({ createdAt: 1 })
      .lean();

    const tirth = await Tirth.findById(tirthId)
      .select("basic address acc team photos")
      .lean();

    let occupancy = {};
    if (rooms.length > 0) {
      occupancy = await getRoomsOccupancy(
        rooms.map((r) => r._id),
        checkIn,
        checkOut,
      );
    }

    /* aane wale dinon ki saari bookings — chahe kisi bhi date par hon.
       Manager ko turant pata chale ki is room type par demand hai ya nahi. */
    let upcoming = {};
    if (rooms.length > 0) {
      const upcomingList = await TirthBooking.find({
        roomId: { $in: rooms.map((r) => r._id) },
        status: { $in: BLOCKING_STATUSES },
        checkOut: { $gte: todayUTC() },
      })
        .select("roomId rooms")
        .lean();

      upcomingList.forEach((b) => {
        const key = String(b.roomId);
        if (!upcoming[key]) upcoming[key] = { count: 0, rooms: 0 };
        upcoming[key].count += 1;
        upcoming[key].rooms += Number(b.rooms || 0);
      });
    }

    const data = rooms.map((r) => {
      const booked = occupancy[String(r._id)] || 0;
      const available = Math.max(0, Number(r.total || 0) - booked);
      const up = upcoming[String(r._id)] || { count: 0, rooms: 0 };
      return {
        ...r,
        id: String(r._id),
        booked,
        available,
        upcomingBookings: up.count,
        upcomingRooms: up.rooms,
      };
    });

    return successResponse(res, {
      tirth: tirth
        ? {
            _id: tirth._id,
            name: tirth.basic?.name || "",
            city: tirth.address?.city || "",
            state: tirth.address?.state || "",
            phone: tirth.team?.bookingContact || tirth.team?.managerPhone || "",
            photos: tirth.photos || [],
            hallCount: tirth.acc?.hallCount || "",
            yatriCapacity: tirth.acc?.yatriCapacity || "",
          }
        : null,
      rooms: data,
      summary: {
        totalRooms: data.reduce((s, r) => s + Number(r.total || 0), 0),
        totalBooked: data.reduce((s, r) => s + Number(r.booked || 0), 0),
        totalAvailable: data.reduce((s, r) => s + Number(r.available || 0), 0),
      },
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ------------------------------------------------------------------
   MANAGER — ManageRooms.jsx : add room type
   POST /api/tirth-booking/manage/:tirthId/rooms
------------------------------------------------------------------ */
const createRoom = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { name, isAC, hasBath, total, price, description } = req.body;

    if (!name || !String(name).trim()) {
      return errorResponse(res, "Room type name is required", 400);
    }
    if (total === undefined || total === null || Number(total) < 0) {
      return errorResponse(res, "Total rooms is required", 400);
    }

    const room = await TirthRoom.create({
      tirthId,
      name: String(name).trim(),
      isAC: isAC === true || isAC === "true",
      hasBath: hasBath === true || hasBath === "true",
      total: Number(total) || 0,
      price: Number(price) || 0,
      description: description || "",
      createdBy: req.user?._id,
    });

    return successResponse(res, {
      message: "Room type added successfully",
      room,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ------------------------------------------------------------------
   MANAGER — update room type
   PUT /api/tirth-booking/manage/rooms/:roomId
------------------------------------------------------------------ */
const updateRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await TirthRoom.findById(roomId);
    if (!room) return errorResponse(res, "Room type not found", 404);

    if (!isUserTirthManager(req.user, room.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    const { name, isAC, hasBath, total, price, description, status } = req.body;

    if (name !== undefined) room.name = String(name).trim();
    if (isAC !== undefined) room.isAC = isAC === true || isAC === "true";
    if (hasBath !== undefined)
      room.hasBath = hasBath === true || hasBath === "true";
    if (total !== undefined) room.total = Number(total) || 0;
    if (price !== undefined) room.price = Number(price) || 0;
    if (description !== undefined) room.description = description;
    if (status !== undefined && ["active", "inactive"].includes(status)) {
      room.status = status;
    }

    await room.save();

    return successResponse(res, {
      message: "Room type updated successfully",
      room,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ------------------------------------------------------------------
   MANAGER — delete room type (soft delete)
   DELETE /api/tirth-booking/manage/rooms/:roomId
------------------------------------------------------------------ */
const deleteRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await TirthRoom.findById(roomId);
    if (!room) return errorResponse(res, "Room type not found", 404);

    if (!isUserTirthManager(req.user, room.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    // agar active bookings hain to delete block
    const activeCount = await TirthBooking.countDocuments({
      roomId,
      status: { $in: BLOCKING_STATUSES },
      checkOut: { $gte: todayUTC() },
    });

    if (activeCount > 0) {
      return errorResponse(
        res,
        `Is room type par ${activeCount} active booking hai. Pehle unhe handle karein.`,
        400,
      );
    }

    room.status = "inactive";
    await room.save();

    return successResponse(res, { message: "Room type deleted successfully" });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ------------------------------------------------------------------
   MANAGER — ManageRooms.jsx : Total Halls / Yatri Capacity
   PUT /api/tirth-booking/manage/:tirthId/property-info
   (existing Tirth model ke facilities fields hi update karta hai)
------------------------------------------------------------------ */
const updatePropertyInfo = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { hallCount, yatriCapacity } = req.body;

    const setObj = {};
    if (hallCount !== undefined) setObj["acc.hallCount"] = String(hallCount);
    if (yatriCapacity !== undefined)
      setObj["acc.yatriCapacity"] = String(yatriCapacity);

    if (Object.keys(setObj).length === 0) {
      return errorResponse(res, "Nothing to update", 400);
    }

    const tirth = await Tirth.findByIdAndUpdate(
      tirthId,
      { $set: setObj },
      { new: true },
    ).select("acc");

    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    return successResponse(res, {
      message: "Property info updated successfully",
      acc: tirth.acc,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  // helpers (booking/dashboard controller me reuse)
  BLOCKING_STATUSES,
  toDay,
  todayUTC,
  addDaysUTC,
  diffNights,
  getRoomsOccupancy,

  // handlers
  getTirthRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  updatePropertyInfo,
};
