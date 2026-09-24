const mongoose = require("mongoose");
const TirthAccounting = require("../../model/TirthModels/Tirthaccountingmodel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");

const INCOME_CATS = ["donation", "booking", "other"];
const EXPENSE_CATS = ["maintenance", "utility", "salary", "supplies", "other"];

/**
 * Booking approve hone par auto income entry
 * (tirthBookingController se call hota hai)
 */
const createBookingIncomeEntry = async (booking, userId) => {
  const exists = await TirthAccounting.findOne({
    bookingId: booking._id,
    status: "active",
  });
  if (exists) return exists;

  return TirthAccounting.create({
    tirthId: booking.tirthId,
    type: "income",
    category: "booking",
    title: `${booking.name} - ${booking.rooms} × ${booking.roomTypeName}`,
    amount: Number(booking.amount) || 0,
    date: booking.checkIn || new Date(),
    note: `Booking ${booking.bookingCode}`,
    bookingId: booking._id,
    isAuto: true,
    createdBy: userId,
  });
};

/**
 * ManageAccounting.jsx — list + totals
 * GET /api/tirth-booking/manage/:tirthId/accounting?type=&search=&from=&to=&page=&limit=
 */
const getAccounting = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { type, search, from, to } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Number(req.query.limit) || 50);

    const query = { tirthId, status: "active" };
    if (type && type !== "all") query.type = type;

    if (from || to) {
      query.date = {};
      if (from)
        query.date.$gte = new Date(
          `${String(from).slice(0, 10)}T00:00:00.000Z`,
        );
      if (to)
        query.date.$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`);
    }

    if (search && String(search).trim()) {
      const rx = new RegExp(
        String(search)
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      query.$or = [{ title: rx }, { category: rx }, { note: rx }];
    }

    const [entries, total, agg] = await Promise.all([
      TirthAccounting.find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthAccounting.countDocuments(query),
      // totals hamesha pure tirth ke (filter se independent)
      TirthAccounting.aggregate([
        {
          $match: {
            tirthId: new mongoose.Types.ObjectId(String(tirthId)),
            status: "active",
          },
        },
        {
          $group: {
            _id: { type: "$type", category: "$category" },
            amount: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    const totals = {
      income: 0,
      expense: 0,
      balance: 0,
      donation: 0,
      booking: 0,
      byCategory: {},
    };

    agg.forEach((row) => {
      const t = row._id.type;
      const c = row._id.category;
      const amt = Number(row.amount) || 0;

      if (t === "income") totals.income += amt;
      if (t === "expense") totals.expense += amt;
      if (c === "donation") totals.donation += amt;
      if (c === "booking") totals.booking += amt;

      totals.byCategory[c] = (totals.byCategory[c] || 0) + amt;
    });

    totals.balance = totals.income - totals.expense;

    return successResponse(res, {
      entries,
      totals,
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
 * ManageAccounting.jsx — add entry
 * POST /api/tirth-booking/manage/:tirthId/accounting
 */
const addAccountingEntry = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { type, category, title, amount, date, note } = req.body;

    if (!["income", "expense"].includes(type)) {
      return errorResponse(res, "Type income ya expense hona chahiye", 400);
    }
    if (!title || !String(title).trim()) {
      return errorResponse(res, "Title is required", 400);
    }
    if (amount === undefined || Number(amount) < 0) {
      return errorResponse(res, "Valid amount is required", 400);
    }

    const allowed = type === "income" ? INCOME_CATS : EXPENSE_CATS;
    const cat = allowed.includes(category) ? category : "other";

    const entry = await TirthAccounting.create({
      tirthId,
      type,
      category: cat,
      title: String(title).trim(),
      amount: Number(amount),
      date: date
        ? new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`)
        : new Date(),
      note: note || "",
      createdBy: req.user?._id,
    });

    return successResponse(res, {
      message: "Entry added successfully",
      entry,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * ManageAccounting.jsx — update entry
 * PUT /api/tirth-booking/manage/accounting/:entryId
 */
const updateAccountingEntry = async (req, res) => {
  try {
    const { entryId } = req.params;

    const entry = await TirthAccounting.findById(entryId);
    if (!entry || entry.status === "deleted") {
      return errorResponse(res, "Entry not found", 404);
    }

    if (!isUserTirthManager(req.user, entry.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    const { type, category, title, amount, date, note } = req.body;

    if (type !== undefined && ["income", "expense"].includes(type))
      entry.type = type;
    if (category !== undefined) {
      const allowed = entry.type === "income" ? INCOME_CATS : EXPENSE_CATS;
      entry.category = allowed.includes(category) ? category : "other";
    }
    if (title !== undefined) entry.title = String(title).trim();
    if (amount !== undefined) entry.amount = Number(amount) || 0;
    if (date !== undefined)
      entry.date = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
    if (note !== undefined) entry.note = note;

    await entry.save();

    return successResponse(res, {
      message: "Entry updated successfully",
      entry,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * ManageAccounting.jsx — delete entry (soft delete)
 * DELETE /api/tirth-booking/manage/accounting/:entryId
 */
const deleteAccountingEntry = async (req, res) => {
  try {
    const { entryId } = req.params;

    const entry = await TirthAccounting.findById(entryId);
    if (!entry || entry.status === "deleted") {
      return errorResponse(res, "Entry not found", 404);
    }

    if (!isUserTirthManager(req.user, entry.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    entry.status = "deleted";
    await entry.save();

    return successResponse(res, { message: "Entry deleted successfully" });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  INCOME_CATS,
  EXPENSE_CATS,
  createBookingIncomeEntry,
  getAccounting,
  addAccountingEntry,
  updateAccountingEntry,
  deleteAccountingEntry,
};
