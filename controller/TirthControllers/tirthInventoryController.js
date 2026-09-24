const mongoose = require("mongoose");
const {
  UNITS,
  IN_REASONS,
  OUT_REASONS,
  TirthCategory,
  TirthItem,
  TirthMovement,
} = require("../../model/TirthModels/tirthInventoryModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");

const DEFAULT_CATEGORIES = [
  "Ghee",
  "Pooja Stock",
  "Kitchen Stock",
  "Flowers",
  "Cleaning",
];

/* 'YYYY-MM-DD' -> UTC midnight */
const toDay = (v) => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

const escapeRx = (s) =>
  String(s)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* pehli baar khali tirth ke liye default categories bana do */
const ensureCategories = async (tirthId, userId) => {
  const count = await TirthCategory.countDocuments({
    tirthId,
    status: "active",
  });
  if (count > 0) return;

  await TirthCategory.insertMany(
    DEFAULT_CATEGORIES.map((name) => ({ tirthId, name, createdBy: userId })),
  );
};

/* ==================================================================
   CATEGORIES
================================================================== */

/**
 * GET /api/tirth-booking/manage/:tirthId/inventory/categories
 */
const getCategories = async (req, res) => {
  try {
    const { tirthId } = req.params;
    await ensureCategories(tirthId, req.user?._id);

    const categories = await TirthCategory.find({ tirthId, status: "active" })
      .sort({ name: 1 })
      .lean();

    // har category me kitne item hain
    const counts = await TirthItem.aggregate([
      {
        $match: {
          tirthId: new mongoose.Types.ObjectId(String(tirthId)),
          status: "active",
        },
      },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ]);

    const map = {};
    counts.forEach((c) => {
      map[String(c._id)] = c.count;
    });

    return successResponse(res, {
      categories: categories.map((c) => ({
        ...c,
        id: String(c._id),
        itemCount: map[String(c._id)] || 0,
      })),
    });
  } catch (error) {
    console.error("❌ getCategories error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /api/tirth-booking/manage/:tirthId/inventory/categories
 */
const createCategory = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { name } = req.body;

    if (!name || !String(name).trim()) {
      return errorResponse(res, "Category name is required", 400);
    }

    const clean = String(name).trim();

    const exists = await TirthCategory.findOne({
      tirthId,
      status: "active",
      name: new RegExp(`^${escapeRx(clean)}$`, "i"),
    });
    if (exists) return errorResponse(res, "Ye category pehle se hai", 400);

    const category = await TirthCategory.create({
      tirthId,
      name: clean,
      createdBy: req.user?._id,
    });

    return successResponse(res, {
      message: "Category added successfully",
      category,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/tirth-booking/manage/inventory/categories/:categoryId
 */
const updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { name } = req.body;

    const category = await TirthCategory.findById(categoryId);
    if (!category || category.status === "deleted") {
      return errorResponse(res, "Category not found", 404);
    }
    if (!isUserTirthManager(req.user, category.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }
    if (!name || !String(name).trim()) {
      return errorResponse(res, "Category name is required", 400);
    }

    category.name = String(name).trim();
    await category.save();

    // items ka snapshot bhi update karo
    await TirthItem.updateMany(
      { categoryId: category._id },
      { $set: { categoryName: category.name } },
    );

    return successResponse(res, {
      message: "Category updated successfully",
      category,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/tirth-booking/manage/inventory/categories/:categoryId
 */
const deleteCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const category = await TirthCategory.findById(categoryId);
    if (!category || category.status === "deleted") {
      return errorResponse(res, "Category not found", 404);
    }
    if (!isUserTirthManager(req.user, category.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    // items hain to delete block — warna wo orphan ho jayenge
    const itemCount = await TirthItem.countDocuments({
      categoryId,
      status: "active",
    });
    if (itemCount > 0) {
      return errorResponse(
        res,
        `Is category me ${itemCount} item hain. Pehle unhe hatao ya doosri category me le jao.`,
        400,
      );
    }

    category.status = "deleted";
    await category.save();

    return successResponse(res, { message: "Category deleted successfully" });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   ITEMS
================================================================== */

/**
 * GET /api/tirth-booking/manage/:tirthId/inventory/items
 *      ?categoryId=&search=&filter=low|expiring|expired&page=&limit=
 */
const getItems = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { categoryId, search, filter } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Number(req.query.limit) || 100);

    const query = { tirthId, status: "active" };
    if (categoryId && categoryId !== "all") query.categoryId = categoryId;

    if (search && String(search).trim()) {
      const rx = new RegExp(escapeRx(search), "i");
      query.$or = [{ name: rx }, { itemCode: rx }, { supplier: rx }];
    }

    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400000);

    if (filter === "low") query.$expr = { $lte: ["$stock", "$minStock"] };
    if (filter === "expiring") {
      query.expiryDate = { $gte: now, $lte: in30 };
    }
    if (filter === "expired") query.expiryDate = { $lt: now };

    const [items, total, allItems, categoryCount] = await Promise.all([
      TirthItem.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthItem.countDocuments(query),
      // stats ke liye poora data (filter se independent)
      TirthItem.find({ tirthId, status: "active" })
        .select("stock minStock expiryDate")
        .lean(),
      TirthCategory.countDocuments({ tirthId, status: "active" }),
    ]);

    const stats = {
      totalItems: allItems.length,
      lowStock: 0,
      expiringSoon: 0,
      expired: 0,
      categories: categoryCount,
    };

    allItems.forEach((it) => {
      if (Number(it.stock) <= Number(it.minStock)) stats.lowStock += 1;
      if (it.expiryDate) {
        const exp = new Date(it.expiryDate);
        if (exp < now) stats.expired += 1;
        else if (exp <= in30) stats.expiringSoon += 1;
      }
    });

    return successResponse(res, {
      items: items.map((i) => ({ ...i, id: String(i._id) })),
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("❌ getItems error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /api/tirth-booking/manage/:tirthId/inventory/items
 * Opening stock diya ho to uski movement bhi ban jati hai.
 */
const createItem = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const {
      name,
      categoryId,
      unit,
      stock,
      minStock,
      supplier,
      supplierPhone,
      expiryDate,
      note,
    } = req.body;

    if (!name || !String(name).trim()) {
      return errorResponse(res, "Item name is required", 400);
    }
    if (!categoryId) return errorResponse(res, "Category is required", 400);

    const category = await TirthCategory.findOne({
      _id: categoryId,
      tirthId,
      status: "active",
    });
    if (!category) return errorResponse(res, "Category not found", 404);

    // INV1000 se shuru, har tirth ki apni series
    const count = await TirthItem.countDocuments({ tirthId });
    const itemCode = `INV${1000 + count}`;

    const openingStock = Math.max(0, Number(stock) || 0);

    const item = await TirthItem.create({
      tirthId,
      itemCode,
      name: String(name).trim(),
      categoryId,
      categoryName: category.name,
      unit: UNITS.includes(unit) ? unit : "pcs",
      stock: openingStock,
      minStock: Math.max(0, Number(minStock) || 0),
      supplier: supplier || "",
      supplierPhone: supplierPhone || "",
      expiryDate: toDay(expiryDate),
      note: note || "",
      createdBy: req.user?._id,
    });

    if (openingStock > 0) {
      await TirthMovement.create({
        tirthId,
        itemId: item._id,
        itemName: item.name,
        unit: item.unit,
        type: "in",
        quantity: openingStock,
        reason: "correction",
        stockAfter: openingStock,
        note: "Opening stock",
        createdBy: req.user?._id,
      });
    }

    return successResponse(res, {
      message: "Item added successfully",
      item,
    });
  } catch (error) {
    console.error("❌ createItem error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/tirth-booking/manage/inventory/items/:itemId
 * NOTE: `stock` yahan se nahi badalta — uske liye stock-in/out hai.
 */
const updateItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    const item = await TirthItem.findById(itemId);
    if (!item || item.status === "deleted") {
      return errorResponse(res, "Item not found", 404);
    }
    if (!isUserTirthManager(req.user, item.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    const {
      name,
      categoryId,
      unit,
      minStock,
      supplier,
      supplierPhone,
      expiryDate,
      note,
    } = req.body;

    if (name !== undefined) item.name = String(name).trim();

    if (
      categoryId !== undefined &&
      String(categoryId) !== String(item.categoryId)
    ) {
      const category = await TirthCategory.findOne({
        _id: categoryId,
        tirthId: item.tirthId,
        status: "active",
      });
      if (!category) return errorResponse(res, "Category not found", 404);
      item.categoryId = category._id;
      item.categoryName = category.name;
    }

    if (unit !== undefined && UNITS.includes(unit)) item.unit = unit;
    if (minStock !== undefined)
      item.minStock = Math.max(0, Number(minStock) || 0);
    if (supplier !== undefined) item.supplier = supplier;
    if (supplierPhone !== undefined) item.supplierPhone = supplierPhone;
    if (expiryDate !== undefined) item.expiryDate = toDay(expiryDate);
    if (note !== undefined) item.note = note;

    await item.save();

    return successResponse(res, {
      message: "Item updated successfully",
      item,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/tirth-booking/manage/inventory/items/:itemId
 */
const deleteItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    const item = await TirthItem.findById(itemId);
    if (!item || item.status === "deleted") {
      return errorResponse(res, "Item not found", 404);
    }
    if (!isUserTirthManager(req.user, item.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    item.status = "deleted";
    await item.save();

    return successResponse(res, { message: "Item deleted successfully" });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   MOVEMENTS
================================================================== */

/**
 * POST /api/tirth-booking/manage/inventory/items/:itemId/movement
 * body: { type: 'in'|'out', quantity, reason, person, note, date }
 */
const addMovement = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { type, quantity, reason, person, note, date } = req.body;

    if (!["in", "out"].includes(type)) {
      return errorResponse(res, "Type 'in' ya 'out' hona chahiye", 400);
    }

    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      return errorResponse(res, "Valid quantity is required", 400);
    }

    const item = await TirthItem.findById(itemId);
    if (!item || item.status === "deleted") {
      return errorResponse(res, "Item not found", 404);
    }
    if (!isUserTirthManager(req.user, item.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    if (type === "out" && qty > Number(item.stock)) {
      return errorResponse(
        res,
        `Sirf ${item.stock} ${item.unit} stock hai, itna nikaal nahi sakte`,
        400,
      );
    }

    const allowed = type === "in" ? IN_REASONS : OUT_REASONS;
    const cleanReason = allowed.includes(reason) ? reason : "other";

    const newStock =
      type === "in" ? Number(item.stock) + qty : Number(item.stock) - qty;

    item.stock = newStock;
    await item.save();

    const movement = await TirthMovement.create({
      tirthId: item.tirthId,
      itemId: item._id,
      itemName: item.name,
      unit: item.unit,
      type,
      quantity: qty,
      reason: cleanReason,
      stockAfter: newStock,
      person: person || "",
      note: note || "",
      date: toDay(date) || new Date(),
      createdBy: req.user?._id,
    });

    return successResponse(res, {
      message:
        type === "in"
          ? `${qty} ${item.unit} stock added`
          : `${qty} ${item.unit} stock issued`,
      movement,
      item,
    });
  } catch (error) {
    console.error("❌ addMovement error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/tirth-booking/manage/:tirthId/inventory/movements
 *      ?itemId=&type=&from=&to=&page=&limit=
 */
const getMovements = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { itemId, type, from, to } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Number(req.query.limit) || 50);

    const query = { tirthId };
    if (itemId && itemId !== "all") query.itemId = itemId;
    if (type && type !== "all") query.type = type;

    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = toDay(from);
      if (to) {
        const t = toDay(to);
        if (t) query.date.$lte = new Date(t.getTime() + 86399999);
      }
    }

    const [movements, total] = await Promise.all([
      TirthMovement.find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthMovement.countDocuments(query),
    ]);

    return successResponse(res, {
      movements: movements.map((m) => ({ ...m, id: String(m._id) })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("❌ getMovements error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  UNITS,
  IN_REASONS,
  OUT_REASONS,

  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,

  getItems,
  createItem,
  updateItem,
  deleteItem,

  addMovement,
  getMovements,
};
