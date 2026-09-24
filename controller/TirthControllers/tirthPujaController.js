const mongoose = require("mongoose");
const {
  OCCASIONS,
  BOOKING_STATUSES,
  TirthPujaType,
  TirthPujaBooking,
} = require("../../model/TirthModels/tirthPujaModel");
const Tirth = require("../../model/TirthModels/tirthModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");
const { recordPujaIncome } = require("./tirthAccountingAutoController");

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

/* ek date se n mahine / saal aage ki date */
const shiftDate = (d, type, n) => {
  const x = new Date(d);
  if (type === "monthly") x.setUTCMonth(x.getUTCMonth() + n);
  else if (type === "yearly") x.setUTCFullYear(x.getUTCFullYear() + n);
  return x;
};

/* notification — fail ho to booking na ruke */
const safeNotify = async ({ userId, title, message, type }) => {
  try {
    if (!userId) return;
    const Notification = mongoose.model("Notification");
    await Notification.create({
      senderId: userId,
      receiverId: userId,
      type: type || "tirth_puja_booking",
      message,
    });

    const { sendPushToUsers } = require("../../config/firebaseAdmin");
    await sendPushToUsers([userId], {
      title,
      body: message,
      data: { type: "notification", notifType: type || "tirth_puja_booking" },
    });
  } catch (err) {
    console.log("ℹ️ puja notification skipped:", err.message);
  }
};

/* ==================================================================
   PUJA TYPES — manager
================================================================== */

/**
 * GET /api/tirth-booking/manage/:tirthId/puja-types
 */
const getManagePujaTypes = async (req, res) => {
  try {
    const { tirthId } = req.params;

    // ✅ Sirf wahi pujaen jo is tirth ke manager ne khud add ki hain
    // (pehle khali tirth me default pujaen apne aap ban jaati thin)
    const types = await TirthPujaType.find({ tirthId, status: "active" })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    return successResponse(res, {
      pujaTypes: types.map((t) => ({ ...t, id: String(t._id) })),
    });
  } catch (error) {
    console.error("❌ getManagePujaTypes error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /api/tirth-booking/manage/:tirthId/puja-types
 */
const createPujaType = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { name } = req.body;

    if (!name || !String(name).trim()) {
      return errorResponse(res, "Puja name is required", 400);
    }

    const tirth = await Tirth.findById(tirthId).select("basic.sect").lean();

    const pujaType = await TirthPujaType.create({
      ...req.body,
      tirthId,
      name: String(name).trim(),
      sect: req.body.sect || tirth?.basic?.sect || "both",
      createdBy: req.user?._id,
    });

    return successResponse(res, {
      message: "Puja added successfully",
      pujaType,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/tirth-booking/manage/puja-types/:pujaTypeId
 */
const updatePujaType = async (req, res) => {
  try {
    const { pujaTypeId } = req.params;

    const pujaType = await TirthPujaType.findById(pujaTypeId);
    if (!pujaType || pujaType.status === "deleted") {
      return errorResponse(res, "Puja not found", 404);
    }
    if (!isUserTirthManager(req.user, pujaType.tirthId)) {
      return errorResponse(res, "You do not have permission", 403);
    }

    const fields = [
      "name",
      "description",
      "sect",
      "labhRashi",
      "durationMinutes",
      "timeSlots",
      "availableDays",
      "samagriProvided",
      "samagriNote",
      "niyam",
      "advanceDays",
      "isActive",
      "sortOrder",
    ];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) pujaType[f] = req.body[f];
    });

    await pujaType.save();

    return successResponse(res, {
      message: "Puja updated successfully",
      pujaType,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/tirth-booking/manage/puja-types/:pujaTypeId
 */
const deletePujaType = async (req, res) => {
  try {
    const { pujaTypeId } = req.params;

    const pujaType = await TirthPujaType.findById(pujaTypeId);
    if (!pujaType || pujaType.status === "deleted") {
      return errorResponse(res, "Puja not found", 404);
    }
    if (!isUserTirthManager(req.user, pujaType.tirthId)) {
      return errorResponse(res, "You do not have permission", 403);
    }

    // aane wali bookings hain to delete block
    const upcoming = await TirthPujaBooking.countDocuments({
      pujaTypeId,
      date: { $gte: todayUTC() },
      status: { $in: ["pending", "approved"] },
    });
    if (upcoming > 0) {
      return errorResponse(
        res,
        `Is puja ki ${upcoming} aane wali booking hain. Pehle unhe handle karein.`,
        400,
      );
    }

    pujaType.status = "deleted";
    await pujaType.save();

    return successResponse(res, { message: "Puja deleted successfully" });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   PUBLIC — user booking karta hai
================================================================== */

/**
 * Ek tirth ki available pujaen + chuni hui date ki availability
 * GET /api/tirth-puja/types/:tirthId?date=YYYY-MM-DD
 */
const getPujaTypesForUser = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const date = toDay(req.query.date);

    const types = await TirthPujaType.find({
      tirthId,
      status: "active",
      isActive: true,
    })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    if (types.length === 0) {
      return successResponse(res, { pujaTypes: [], date: null });
    }

    // us din ki bookings — slot-wise count
    let bookedMap = {};
    if (date) {
      const bookings = await TirthPujaBooking.find({
        tirthId,
        date,
        status: { $in: ["pending", "approved"] },
      })
        .select("pujaTypeId slotId")
        .lean();

      bookings.forEach((b) => {
        const key = `${b.pujaTypeId}_${b.slotId}`;
        bookedMap[key] = (bookedMap[key] || 0) + 1;
      });
    }

    const weekday = date ? date.getUTCDay() : null;

    const data = types.map((t) => {
      // is din ye puja hoti hai ya nahi
      const dayOk =
        !date ||
        !t.availableDays ||
        t.availableDays.length === 0 ||
        t.availableDays.includes(weekday);

      // itne din pehle booking honi chahiye
      const minDate = new Date(todayUTC());
      minDate.setUTCDate(minDate.getUTCDate() + (t.advanceDays || 0));
      const advanceOk = !date || date >= minDate;

      const slots = (t.timeSlots || []).map((s) => {
        const booked = bookedMap[`${t._id}_${s._id}`] || 0;
        const left = Math.max(0, Number(s.maxBookings || 1) - booked);
        return {
          id: String(s._id),
          startTime: s.startTime,
          endTime: s.endTime,
          maxBookings: s.maxBookings,
          booked,
          available: left,
          isFull: left === 0,
        };
      });

      return {
        ...t,
        id: String(t._id),
        slots,
        dayOk,
        advanceOk,
        minDate: minDate.toISOString().slice(0, 10),
        bookable: dayOk && advanceOk && slots.some((s) => !s.isFull),
      };
    });

    return successResponse(res, {
      pujaTypes: data,
      date: date ? date.toISOString().slice(0, 10) : null,
    });
  } catch (error) {
    console.error("❌ getPujaTypesForUser error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /api/tirth-puja/book/:tirthId
 */
const createPujaBooking = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const {
      pujaTypeId,
      date,
      slotId,
      name,
      phone,
      gotra,
      sankalpName,
      occasion,
      occasionNote,
      persons,
      note,
    } = req.body;

    if (!pujaTypeId) return errorResponse(res, "Please select a puja", 400);
    if (!name || !String(name).trim())
      return errorResponse(res, "Name is required", 400);
    if (!phone || String(phone).replace(/\D/g, "").length < 10)
      return errorResponse(res, "Valid 10-digit phone number is required", 400);

    const day = toDay(date);
    if (!day) return errorResponse(res, "Valid date is required", 400);
    if (day < todayUTC())
      return errorResponse(res, "Past date ki booking nahi ho sakti", 400);

    const tirth = await Tirth.findOne({
      _id: tirthId,
      status: "active",
      applicationStatus: "approved",
    })
      .select("basic address")
      .lean();
    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    const pujaType = await TirthPujaType.findOne({
      _id: pujaTypeId,
      tirthId,
      status: "active",
      isActive: true,
    });
    if (!pujaType) return errorResponse(res, "Puja not available", 404);

    // advance booking ka niyam
    const minDate = new Date(todayUTC());
    minDate.setUTCDate(minDate.getUTCDate() + (pujaType.advanceDays || 0));
    if (day < minDate) {
      return errorResponse(
        res,
        `Ye puja kam se kam ${pujaType.advanceDays} din pehle book karni hoti hai`,
        400,
      );
    }

    // us din ye puja hoti hai ya nahi
    if (pujaType.availableDays?.length > 0) {
      if (!pujaType.availableDays.includes(day.getUTCDay())) {
        return errorResponse(res, "Is din ye puja nahi hoti", 400);
      }
    }

    // slot
    const slot = (pujaType.timeSlots || []).find(
      (s) => String(s._id) === String(slotId),
    );
    if (!slot) return errorResponse(res, "Please select a time slot", 400);

    // slot bhara to nahi
    const alreadyBooked = await TirthPujaBooking.countDocuments({
      pujaTypeId,
      date: day,
      slotId: String(slot._id),
      status: { $in: ["pending", "approved"] },
    });
    if (alreadyBooked >= Number(slot.maxBookings || 1)) {
      return errorResponse(
        res,
        "Ye slot bhar chuka hai. Doosra samay ya din chunein.",
        400,
      );
    }

    /* recurring — kitni bookings banani hain */
    const repeat = ["monthly", "yearly"].includes(req.body.repeatType)
      ? req.body.repeatType
      : "once";
    const maxCount = repeat === "monthly" ? 24 : 10;
    const count =
      repeat === "once"
        ? 1
        : Math.min(maxCount, Math.max(2, Number(req.body.repeatCount) || 2));

    const base = {
      tirthId,
      tirthName: tirth.basic?.name || "",
      tirthCity: tirth.address?.city || "",
      tirthState: tirth.address?.state || "",

      pujaTypeId,
      pujaName: pujaType.name,
      labhRashi: pujaType.labhRashi,

      userId: req.user._id,
      name: String(name).trim(),
      phone: String(phone).trim(),
      gotra: gotra || "",
      sankalpName: sankalpName || "",

      slotId: String(slot._id),
      startTime: slot.startTime,
      endTime: slot.endTime,

      occasion: OCCASIONS.includes(occasion) ? occasion : "other",
      occasionNote: occasionNote || "",
      persons: Math.max(1, Number(persons) || 1),
      note: note || "",

      repeatType: repeat,
      seriesTotal: count,
    };

    // pehli booking
    const booking = await TirthPujaBooking.create({
      ...base,
      date: day,
      seriesIndex: 1,
    });

    // series me sab ek hi seriesId se judi rehti hain
    if (count > 1) {
      booking.seriesId = booking._id;
      await booking.save();

      const rest = [];
      for (let i = 1; i < count; i++) {
        rest.push({
          ...base,
          date: shiftDate(day, repeat, i),
          seriesId: booking._id,
          seriesIndex: i + 1,
        });
      }
      // slot bhara hone par bhi banti hain — manager decide karega
      await TirthPujaBooking.insertMany(rest);
    }

    // managers ko notify
    try {
      const managers = await User.find({ "tirthRoles.tirthId": tirthId })
        .select("_id")
        .lean();
      await Promise.all(
        managers.map((m) =>
          safeNotify({
            userId: m._id,
            title: "New puja booking",
            message: `${booking.name} ne ${booking.pujaName} ke liye booking bheji hai`,
            type: "tirth_puja_booking",
          }),
        ),
      );
    } catch (e) {
      console.log("ℹ️ manager notify skipped:", e.message);
    }

    return successResponse(res, {
      message: "Aapki puja booking request bhej di gayi hai",
      booking,
    });
  } catch (error) {
    console.error("❌ createPujaBooking error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * User apni puja bookings dekhe
 * GET /api/tirth-puja/my?status=&page=&limit=
 */
const getMyPujaBookings = async (req, res) => {
  try {
    const { status } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);

    const query = { userId: req.user._id };
    if (status && status !== "all") query.status = status;

    const [bookings, total] = await Promise.all([
      TirthPujaBooking.find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthPujaBooking.countDocuments(query),
    ]);

    return successResponse(res, {
      bookings: bookings.map((b) => ({ ...b, id: String(b._id) })),
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
 * User apni booking cancel kare
 * PUT /api/tirth-puja/cancel/:bookingId
 */
const cancelPujaBooking = async (req, res) => {
  try {
    const booking = await TirthPujaBooking.findById(req.params.bookingId);
    if (!booking) return errorResponse(res, "Booking not found", 404);

    if (String(booking.userId) !== String(req.user._id)) {
      return errorResponse(res, "Not allowed", 403);
    }
    if (!["pending", "approved"].includes(booking.status)) {
      return errorResponse(res, "Ye booking cancel nahi ho sakti", 400);
    }

    booking.status = "cancelled";
    await booking.save();

    return successResponse(res, { message: "Booking cancelled" });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   MANAGER — bookings
================================================================== */

/**
 * GET /api/tirth-booking/manage/:tirthId/puja-bookings?status=&date=&search=
 */
const getTirthPujaBookings = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { status, date, search } = req.query;

    const query = { tirthId };
    if (status && status !== "all") query.status = status;
    if (date) {
      const d = toDay(date);
      if (d) query.date = d;
    }

    if (search && String(search).trim()) {
      const rx = new RegExp(
        String(search)
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      query.$or = [
        { name: rx },
        { phone: rx },
        { pujaName: rx },
        { bookingCode: rx },
      ];
    }

    const [bookings, counts, todayCount] = await Promise.all([
      TirthPujaBooking.find(query)
        .sort({ date: 1, startTime: 1 })
        .limit(200)
        .lean(),
      TirthPujaBooking.aggregate([
        { $match: { tirthId: new mongoose.Types.ObjectId(String(tirthId)) } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      TirthPujaBooking.countDocuments({
        tirthId,
        date: todayUTC(),
        status: "approved",
      }),
    ]);

    const countMap = {
      pending: 0,
      approved: 0,
      rejected: 0,
      completed: 0,
      cancelled: 0,
      all: 0,
    };
    counts.forEach((c) => {
      countMap[c._id] = c.count;
      countMap.all += c.count;
    });

    return successResponse(res, {
      bookings: bookings.map((b) => ({ ...b, id: String(b._id) })),
      counts: countMap,
      todayCount,
    });
  } catch (error) {
    console.error("❌ getTirthPujaBookings error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/tirth-booking/manage/puja-bookings/:bookingId/status
 * body: { status, rejectReason }
 */
const updatePujaBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, rejectReason } = req.body;

    if (!BOOKING_STATUSES.includes(status)) {
      return errorResponse(res, "Invalid status", 400);
    }

    const booking = await TirthPujaBooking.findById(bookingId);
    if (!booking) return errorResponse(res, "Booking not found", 404);

    if (!isUserTirthManager(req.user, booking.tirthId)) {
      return errorResponse(res, "You do not have permission", 403);
    }

    booking.status = status;
    if (status === "rejected") booking.rejectReason = rejectReason || "";
    booking.isReadByTirth = true;
    await booking.save();

    // puja sampann hui to labh rashi accounting me
    if (status === "completed") {
      await recordPujaIncome(booking, req.user?._id);
    }

    /* recurring booking hai to poori series par bhi laagu karo —
       manager ko 12 baar approve na karna pade.
       "completed" sirf usi din ki booking par lagta hai. */
    let seriesUpdated = 0;
    const sid = booking.seriesId;

    if (sid && ["approved", "rejected", "cancelled"].includes(status)) {
      const result = await TirthPujaBooking.updateMany(
        {
          seriesId: sid,
          _id: { $ne: booking._id },
          status: { $in: ["pending", "approved"] },
          date: { $gte: todayUTC() },
        },
        {
          $set: {
            status,
            rejectReason: status === "rejected" ? rejectReason || "" : "",
            isReadByTirth: true,
          },
        },
      );
      seriesUpdated = result.modifiedCount || 0;
    }

    const dateText = new Date(booking.date).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const messages = {
      approved: `Aapki ${booking.pujaName} booking ${dateText} ${booking.startTime} ke liye confirm ho gayi hai`,
      rejected:
        `Aapki ${booking.pujaName} booking (${dateText}) sweekar nahi ho payi. ${rejectReason || ""}`.trim(),
      completed: `${booking.pujaName} sampann hui. ${booking.tirthName} ki or se dhanyavaad.`,
      cancelled: `Aapki ${booking.pujaName} booking (${dateText}) cancel kar di gayi hai`,
    };

    // series me kai bookings hain to message me bata do
    const seriesSuffix =
      seriesUpdated > 0
        ? ` (${seriesUpdated + 1} bookings in this series)`
        : "";

    if (messages[status]) {
      await safeNotify({
        userId: booking.userId,
        title: status === "approved" ? "Puja Confirmed" : "Puja Booking Update",
        message: messages[status] + seriesSuffix,
        type: "tirth_puja_status",
      });
    }

    return successResponse(res, {
      message:
        seriesUpdated > 0
          ? `${seriesUpdated + 1} bookings updated`
          : "Booking updated successfully",
      booking,
      seriesUpdated,
    });
  } catch (error) {
    console.error("❌ updatePujaBookingStatus error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  OCCASIONS,
  BOOKING_STATUSES,
  getManagePujaTypes,
  createPujaType,
  updatePujaType,
  deletePujaType,
  getPujaTypesForUser,
  createPujaBooking,
  getMyPujaBookings,
  cancelPujaBooking,

  getTirthPujaBookings,
  updatePujaBookingStatus,
};
