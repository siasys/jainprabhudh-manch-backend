const mongoose = require("mongoose");
const {
  MEALS,
  ORDER_STATUSES,
  TirthBhojanSetting,
  TirthMenu,
  TirthFoodOrder,
} = require("../../model/TirthModels/tirthBhojanModel");
const Tirth = require("../../model/TirthModels/tirthModel");
const TirthBooking = require("../../model/TirthModels/Tirthbookingmodel");
const User = require("../../model/UserRegistrationModels/userModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");

/* ------------------------------------------------------------------ */
const num = (v) => Number(v) || 0;

/* 'YYYY-MM-DD' -> UTC midnight */
const toDay = (v) => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

const todayUTC = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

/* notification — fail ho to order na ruke */
const safeNotify = async ({ userId, title, message, type }) => {
  try {
    if (!userId) return;
    const Notification = mongoose.model("Notification");
    await Notification.create({
      senderId: userId,
      receiverId: userId,
      type: type || "tirth_food_order",
      message,
    });

    const { sendPushToUsers } = require("../../config/firebaseAdmin");
    await sendPushToUsers([userId], {
      title,
      body: message,
      data: { type: "notification", notifType: type || "tirth_food_order" },
    });
  } catch (err) {
    console.log("ℹ️ bhojan notification skipped:", err.message);
  }
};

/* settings — na ho to bana do */
const getOrCreateSetting = async (tirthId, userId) => {
  let s = await TirthBhojanSetting.findOne({ tirthId });
  if (!s) {
    s = await TirthBhojanSetting.create({ tirthId, updatedBy: userId });
  }
  return s;
};

/* ==================================================================
   SETTINGS
================================================================== */

/**
 * GET /api/tirth-booking/manage/:tirthId/bhojan/settings
 */
const getBhojanSettings = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const setting = await getOrCreateSetting(tirthId, req.user?._id);
    return successResponse(res, { setting });
  } catch (error) {
    console.error("❌ getBhojanSettings error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/tirth-booking/manage/:tirthId/bhojan/settings
 */
const updateBhojanSettings = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const setting = await getOrCreateSetting(tirthId, req.user?._id);

    const fields = [
      "isActive",
      "chargeType",
      "thaliPrice",
      "freeNote",
      "timings",
      "cutoffHours",
      "customAllowed",
      "customNote",
      "outsideAllowed",
    ];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) setting[f] = req.body[f];
    });
    setting.updatedBy = req.user?._id;

    await setting.save();

    return successResponse(res, {
      message: "Bhojanshala settings saved",
      setting,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   MENU — manager
================================================================== */

/**
 * Poora weekly menu ek saath
 * GET /api/tirth-booking/manage/:tirthId/bhojan/menu?date=YYYY-MM-DD
 *
 * date bhejo to us din ka override bhi aa jayega.
 */
const getManageMenu = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const date = toDay(req.query.date);

    const query = { tirthId, status: "active" };
    if (date) {
      // weekly saara + us ek din ka override
      query.$or = [{ scope: "weekly" }, { scope: "date", date }];
    } else {
      query.scope = "weekly";
    }

    const menus = await TirthMenu.find(query).lean();

    /* weekly[weekday][meal] aur override[meal] */
    const weekly = {};
    const override = {};

    menus.forEach((m) => {
      if (m.scope === "weekly") {
        if (!weekly[m.weekday]) weekly[m.weekday] = {};
        weekly[m.weekday][m.meal] = { ...m, id: String(m._id) };
      } else {
        override[m.meal] = { ...m, id: String(m._id) };
      }
    });

    return successResponse(res, {
      weekly,
      override,
      date: date ? date.toISOString().slice(0, 10) : null,
      meals: MEALS,
    });
  } catch (error) {
    console.error("❌ getManageMenu error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Menu save — weekly ya kisi ek din ka
 * PUT /api/tirth-booking/manage/:tirthId/bhojan/menu
 * body: { scope, weekday, date, meal, items, isClosed, closedReason, note }
 *
 * Ek hi din + meal ka menu hamesha ek hi rehta hai (upsert).
 */
const saveMenu = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { scope, weekday, date, meal } = req.body;

    if (!MEALS.includes(meal)) {
      return errorResponse(res, "Valid meal is required", 400);
    }

    const isWeekly = scope !== "date";
    const day = isWeekly ? null : toDay(date);
    const wd = isWeekly ? Number(weekday) : null;

    if (isWeekly && (isNaN(wd) || wd < 0 || wd > 6)) {
      return errorResponse(res, "Valid weekday (0-6) is required", 400);
    }
    if (!isWeekly && !day) {
      return errorResponse(res, "Valid date is required", 400);
    }

    const key = isWeekly
      ? { tirthId, scope: "weekly", weekday: wd, meal, status: "active" }
      : { tirthId, scope: "date", date: day, meal, status: "active" };

    const items = (req.body.items || [])
      .filter((i) => String(i?.name || "").trim())
      .map((i) => ({
        name: String(i.name).trim(),
        price: num(i.price),
        kind: i.kind || "",
        isAvailable: i.isAvailable !== false,
      }));

    const menu = await TirthMenu.findOneAndUpdate(
      key,
      {
        $set: {
          items,
          isClosed: !!req.body.isClosed,
          closedReason: req.body.closedReason || "",
          note: req.body.note || "",
        },
        $setOnInsert: { createdBy: req.user?._id },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return successResponse(res, { message: "Menu saved", menu });
  } catch (error) {
    console.error("❌ saveMenu error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Kisi ek din ka override hata do (weekly wapas laagu)
 * DELETE /api/tirth-booking/manage/bhojan/menu/:menuId
 */
const deleteMenu = async (req, res) => {
  try {
    const { menuId } = req.params;

    const menu = await TirthMenu.findById(menuId);
    if (!menu || menu.status === "deleted") {
      return errorResponse(res, "Menu not found", 404);
    }
    if (!isUserTirthManager(req.user, menu.tirthId)) {
      return errorResponse(res, "You do not have permission", 403);
    }

    menu.status = "deleted";
    await menu.save();

    return successResponse(res, { message: "Menu removed" });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   MENU — user
================================================================== */

/**
 * Ek din ka menu — user ke liye
 * GET /api/tirth-bhojan/menu/:tirthId?date=YYYY-MM-DD
 *
 * Pehle us din ka override dekha jata hai, na mile to weekly.
 */
const getMenuForUser = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const day = toDay(req.query.date) || todayUTC();
    const weekday = day.getUTCDay();

    const [setting, menus] = await Promise.all([
      TirthBhojanSetting.findOne({ tirthId }).lean(),
      TirthMenu.find({
        tirthId,
        status: "active",
        $or: [
          { scope: "date", date: day },
          { scope: "weekly", weekday },
        ],
      }).lean(),
    ]);

    if (!setting || setting.isActive === false) {
      return successResponse(res, {
        available: false,
        message: "Bhojanshala is not accepting orders right now",
        meals: [],
      });
    }

    /* har meal ke liye — override pehle, warna weekly */
    const byMeal = {};
    menus.forEach((m) => {
      const cur = byMeal[m.meal];
      if (!cur || (m.scope === "date" && cur.scope === "weekly")) {
        byMeal[m.meal] = m;
      }
    });

    const now = new Date();
    const cutoffMs = num(setting.cutoffHours) * 3600000;

    const meals = MEALS.map((meal) => {
      const m = byMeal[meal];
      const time = setting.timings?.[meal] || "";

      /* is meal ka samay nikal to nahi gaya */
      let canOrder = true;
      let closedNote = "";

      if (!m || m.items?.length === 0) {
        canOrder = false;
        closedNote = "Menu not set for this meal";
      } else if (m.isClosed) {
        canOrder = false;
        closedNote = m.closedReason || "Closed for this meal";
      } else if (time) {
        const [h, mi] = String(time).split(":").map(Number);
        const mealAt = new Date(day);
        mealAt.setUTCHours((h || 0) - 5, (mi || 0) - 30, 0, 0); // IST -> UTC
        if (mealAt.getTime() - now.getTime() < cutoffMs) {
          canOrder = false;
          closedNote = `Orders close ${setting.cutoffHours} hours before`;
        }
      }

      return {
        meal,
        time,
        items: (m?.items || []).filter((i) => i.isAvailable !== false),
        isClosed: !!m?.isClosed,
        closedReason: m?.closedReason || "",
        note: m?.note || "",
        source: m?.scope || null,
        canOrder,
        closedNote,
      };
    });

    return successResponse(res, {
      available: true,
      date: day.toISOString().slice(0, 10),
      meals,
      setting: {
        chargeType: setting.chargeType,
        thaliPrice: setting.thaliPrice,
        freeNote: setting.freeNote,
        cutoffHours: setting.cutoffHours,
        customAllowed: setting.customAllowed,
        customNote: setting.customNote,
        outsideAllowed: setting.outsideAllowed,
      },
    });
  } catch (error) {
    console.error("❌ getMenuForUser error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   ORDER — user
================================================================== */

/**
 * POST /api/tirth-bhojan/order/:tirthId
 */
const createFoodOrder = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const {
      date, meal, items, customRequest, persons,
      name, phone, note, deliverTo, roomNumber,
    } = req.body;

    if (!MEALS.includes(meal)) {
      return errorResponse(res, "Please select a meal", 400);
    }
    if (!name || !String(name).trim()) {
      return errorResponse(res, "Name is required", 400);
    }
    if (!phone || String(phone).replace(/\D/g, "").length < 10) {
      return errorResponse(res, "Valid 10-digit phone number is required", 400);
    }

    const day = toDay(date);
    if (!day) return errorResponse(res, "Valid date is required", 400);
    if (day < todayUTC()) {
      return errorResponse(res, "Cannot order for a past date", 400);
    }

    const chosen = (items || []).filter((i) => String(i?.name || "").trim());
    if (chosen.length === 0 && !String(customRequest || "").trim()) {
      return errorResponse(
        res,
        "Please choose items from the menu or write a special request",
        400,
      );
    }

    const tirth = await Tirth.findOne({
      _id: tirthId,
      status: "active",
      applicationStatus: "approved",
    })
      .select("basic address")
      .lean();
    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    const setting = await TirthBhojanSetting.findOne({ tirthId }).lean();
    if (!setting || setting.isActive === false) {
      return errorResponse(res, "Bhojanshala is not accepting orders", 400);
    }
    if (customRequest && !setting.customAllowed) {
      return errorResponse(
        res,
        "This Tirth does not accept special requests",
        400,
      );
    }

    /* is tirth me thehre hue hain? — inhe pehle dikhaya jayega */
    const booking = await TirthBooking.findOne({
      tirthId,
      userId: req.user._id,
      status: "approved",
      checkIn: { $lte: day },
      checkOut: { $gte: day },
    })
      .select("_id")
      .lean();

    if (!booking && setting.outsideAllowed === false) {
      return errorResponse(
        res,
        "Only guests staying at this Tirth can order",
        400,
      );
    }

    /* paisa */
    const count = Math.max(1, num(persons) || 1);
    let amount = 0;
    const orderItems = chosen.map((i) => ({
      name: String(i.name).trim(),
      quantity: Math.max(1, num(i.quantity) || 1),
      price: num(i.price),
    }));

    if (setting.chargeType === "perThali") {
      amount = num(setting.thaliPrice) * count;
    } else if (setting.chargeType === "perItem") {
      amount = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);
    }

    const order = await TirthFoodOrder.create({
      tirthId,
      tirthName: tirth.basic?.name || "",
      tirthCity: tirth.address?.city || "",
      tirthState: tirth.address?.state || "",

      userId: req.user._id,
      name: String(name).trim(),
      phone: String(phone).trim(),

      date: day,
      meal,
      items: orderItems,
      customRequest: String(customRequest || "").trim(),
      persons: count,
      note: note || "",

      chargeType: setting.chargeType,
      amount,

      deliverTo: deliverTo === "room" ? "room" : "bhojanshala",
      roomNumber: deliverTo === "room" ? roomNumber || "" : "",

      hasBooking: !!booking,
      bookingId: booking?._id || null,
    });

    /* managers ko notify */
    try {
      const managers = await User.find({ "tirthRoles.tirthId": tirthId })
        .select("_id")
        .lean();
      await Promise.all(
        managers.map((m) =>
          safeNotify({
            userId: m._id,
            title: "New bhojan order",
            message: `${order.name} placed a ${meal} order for ${count} ${
              count > 1 ? "people" : "person"
            }`,
            type: "tirth_food_order",
          }),
        ),
      );
    } catch (e) {
      console.log("ℹ️ manager notify skipped:", e.message);
    }

    return successResponse(res, {
      message: "Your order has been sent to the Bhojanshala",
      order,
    });
  } catch (error) {
    console.error("❌ createFoodOrder error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/tirth-bhojan/my?status=&page=&limit=
 */
const getMyFoodOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const page = Math.max(1, num(req.query.page) || 1);
    const limit = Math.min(50, num(req.query.limit) || 20);

    const query = { userId: req.user._id };
    if (status && status !== "all") query.status = status;

    const [orders, total] = await Promise.all([
      TirthFoodOrder.find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthFoodOrder.countDocuments(query),
    ]);

    return successResponse(res, {
      orders: orders.map((o) => ({ ...o, id: String(o._id) })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/tirth-bhojan/cancel/:orderId
 */
const cancelFoodOrder = async (req, res) => {
  try {
    const order = await TirthFoodOrder.findById(req.params.orderId);
    if (!order) return errorResponse(res, "Order not found", 404);

    if (String(order.userId) !== String(req.user._id)) {
      return errorResponse(res, "Not allowed", 403);
    }
    if (!["pending", "accepted"].includes(order.status)) {
      return errorResponse(
        res,
        "This order can no longer be cancelled",
        400,
      );
    }

    order.status = "cancelled";
    await order.save();

    return successResponse(res, { message: "Order cancelled" });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   ORDER — manager
================================================================== */

/**
 * GET /api/tirth-booking/manage/:tirthId/bhojan/orders?status=&date=&meal=&search=
 */
const getTirthFoodOrders = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { status, date, meal, search } = req.query;

    const query = { tirthId };
    if (status && status !== "all") query.status = status;
    if (meal && meal !== "all") query.meal = meal;
    if (date) {
      const d = toDay(date);
      if (d) query.date = d;
    }

    if (search && String(search).trim()) {
      const rx = new RegExp(
        String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      query.$or = [{ name: rx }, { phone: rx }, { orderCode: rx }];
    }

    const [orders, counts, todayAgg] = await Promise.all([
      // stay wale pehle, phir naya order pehle
      TirthFoodOrder.find(query)
        .sort({ hasBooking: -1, createdAt: -1 })
        .limit(200)
        .lean(),
      TirthFoodOrder.aggregate([
        { $match: { tirthId: new mongoose.Types.ObjectId(String(tirthId)) } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      TirthFoodOrder.aggregate([
        {
          $match: {
            tirthId: new mongoose.Types.ObjectId(String(tirthId)),
            date: todayUTC(),
            status: { $in: ["accepted", "preparing", "ready", "delivered"] },
          },
        },
        {
          $group: {
            _id: "$meal",
            orders: { $sum: 1 },
            persons: { $sum: "$persons" },
          },
        },
      ]),
    ]);

    const countMap = {
      pending: 0, accepted: 0, preparing: 0, ready: 0,
      delivered: 0, rejected: 0, cancelled: 0, all: 0,
    };
    counts.forEach((c) => {
      countMap[c._id] = c.count;
      countMap.all += c.count;
    });

    /* aaj kis meal ke liye kitne log */
    const todayCount = { breakfast: 0, lunch: 0, dinner: 0, total: 0 };
    todayAgg.forEach((t) => {
      todayCount[t._id] = t.persons;
      todayCount.total += t.persons;
    });

    return successResponse(res, {
      orders: orders.map((o) => ({ ...o, id: String(o._id) })),
      counts: countMap,
      todayCount,
    });
  } catch (error) {
    console.error("❌ getTirthFoodOrders error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/tirth-booking/manage/bhojan/orders/:orderId/status
 * body: { status, rejectReason }
 */
const updateFoodOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, rejectReason } = req.body;

    if (!ORDER_STATUSES.includes(status)) {
      return errorResponse(res, "Invalid status", 400);
    }

    const order = await TirthFoodOrder.findById(orderId);
    if (!order) return errorResponse(res, "Order not found", 404);

    if (!isUserTirthManager(req.user, order.tirthId)) {
      return errorResponse(res, "You do not have permission", 403);
    }

    order.status = status;
    if (status === "rejected") order.rejectReason = rejectReason || "";
    order.isReadByTirth = true;
    await order.save();

    const mealName =
      order.meal.charAt(0).toUpperCase() + order.meal.slice(1);

    const messages = {
      accepted: `Your ${mealName} order at ${order.tirthName} is accepted`,
      preparing: `Your ${mealName} order is being prepared`,
      ready: `Your ${mealName} order is ready. Please collect it from the Bhojanshala.`,
      delivered: `Your ${mealName} order has been served. Thank you.`,
      rejected: `Your ${mealName} order could not be accepted. ${rejectReason || ""}`.trim(),
      cancelled: `Your ${mealName} order has been cancelled`,
    };

    if (messages[status]) {
      await safeNotify({
        userId: order.userId,
        title:
          status === "ready" ? "Bhojan Ready" : "Bhojan Order Update",
        message: messages[status],
        type: "tirth_food_status",
      });
    }

    return successResponse(res, {
      message: "Order updated successfully",
      order,
    });
  } catch (error) {
    console.error("❌ updateFoodOrderStatus error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  MEALS,
  ORDER_STATUSES,

  getBhojanSettings,
  updateBhojanSettings,

  getManageMenu,
  saveMenu,
  deleteMenu,
  getMenuForUser,

  createFoodOrder,
  getMyFoodOrders,
  cancelFoodOrder,

  getTirthFoodOrders,
  updateFoodOrderStatus,
};