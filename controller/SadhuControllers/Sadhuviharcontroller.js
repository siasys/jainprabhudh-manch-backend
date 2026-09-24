const SadhuVihar = require("../../model/SadhuModels/sadhuViharModel");
const Sadhu = require("../../model/SadhuModels/sadhuModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");

/* ── Helpers ──────────────────────────────────────────────── */

const toDateOrNull = (val) => {
  if (val === undefined || val === null || String(val).trim() === "")
    return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const toNumberOrNull = (val) => {
  if (val === undefined || val === null || String(val).trim() === "")
    return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
};

const toBool = (val) =>
  val === true || val === "true" || val === 1 || val === "1";

/**
 * Sadhu.currentLocation ko ek vihar record se sync karta hai.
 * Sirf currentLocation subdocument touch hota hai — baaki fields untouched.
 */
const syncCurrentLocation = async (sadhuId, vihar, userId) => {
  await Sadhu.findByIdAndUpdate(
    sadhuId,
    {
      $set: {
        "currentLocation.placeName": vihar.placeName || "",
        "currentLocation.state": vihar.state || "",
        "currentLocation.city": vihar.city || "",
        "currentLocation.fromDate": vihar.fromDate || null,
        "currentLocation.toDate": vihar.toDate || null,
        "currentLocation.lat": vihar.lat ?? null,
        "currentLocation.lng": vihar.lng ?? null,
        "currentLocation.updatedAt": new Date(),
        "currentLocation.updatedBy": userId || null,
      },
    },
    { new: false },
  );
};

/**
 * Ek sadhu ke saare records me se sirf diye gaye record ko current banata hai.
 * Standalone mongod hai (no replica set) — isliye koi transaction nahi.
 */
const markOnlyOneCurrent = async (sadhuId, viharId) => {
  await SadhuVihar.updateMany(
    { sadhuId, _id: { $ne: viharId } },
    { $set: { isCurrent: false } },
  );
  await SadhuVihar.findByIdAndUpdate(viharId, { $set: { isCurrent: true } });
};

/* ── Add new vihar / location entry ───────────────────────── */

const addSadhuVihar = async (req, res) => {
  try {
    const { sadhuId } = req.params;

    const sadhu = await Sadhu.findById(sadhuId).select("_id");
    if (!sadhu) {
      return errorResponse(res, "Sadhu not found", 404);
    }

    const setAsCurrent =
      req.body.setAsCurrent === undefined
        ? true
        : toBool(req.body.setAsCurrent);

    const vihar = new SadhuVihar({
      sadhuId,
      placeName: req.body.placeName || "",
      address: req.body.address || "",
      state: req.body.state || "",
      district: req.body.district || "",
      city: req.body.city || "",
      fromDate: toDateOrNull(req.body.fromDate),
      toDate: toDateOrNull(req.body.toDate),
      lat: toNumberOrNull(req.body.lat),
      lng: toNumberOrNull(req.body.lng),
      notes: req.body.notes || "",
      isCurrent: false,
      updatedBy: req.user?._id || null,
    });

    await vihar.save();

    if (setAsCurrent) {
      await markOnlyOneCurrent(sadhuId, vihar._id);
      vihar.isCurrent = true;
      await syncCurrentLocation(sadhuId, vihar, req.user?._id);
    }

    return successResponse(res, "Vihar record added", vihar);
  } catch (error) {
    console.error("addSadhuVihar error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── List records for a sadhu ─────────────────────────────── */

const getSadhuViharList = async (req, res) => {
  try {
    const { sadhuId } = req.params;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 20, 1),
      50,
    );
    const skip = (page - 1) * limit;

    const query = { sadhuId };

    // ?filter=upcoming  -> aane wale stops
    // ?filter=past      -> guzar chuke stops
    const now = new Date();
    if (req.query.filter === "upcoming") {
      query.fromDate = { $gte: now };
    } else if (req.query.filter === "past") {
      query.fromDate = { $lt: now };
    }

    const [records, total] = await Promise.all([
      SadhuVihar.find(query)
        .sort({ fromDate: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      SadhuVihar.countDocuments(query),
    ]);

    return successResponse(res, "Vihar records retrieved", {
      records,
      total,
      page,
      limit,
      hasMore: skip + records.length < total,
    });
  } catch (error) {
    console.error("getSadhuViharList error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── Current location only ────────────────────────────────── */

const getSadhuCurrentVihar = async (req, res) => {
  try {
    const { sadhuId } = req.params;
    const current = await SadhuVihar.findOne({ sadhuId, isCurrent: true });
    return successResponse(res, "Current vihar retrieved", current || null);
  } catch (error) {
    return errorResponse(res, error.message);
  }
};

/* ── Update an existing record ────────────────────────────── */

const updateSadhuVihar = async (req, res) => {
  try {
    const { viharId } = req.params;

    const vihar = await SadhuVihar.findById(viharId);
    if (!vihar) {
      return errorResponse(res, "Vihar record not found", 404);
    }

    const fields = [
      "placeName",
      "address",
      "state",
      "district",
      "city",
      "notes",
    ];
    fields.forEach((key) => {
      if (req.body[key] !== undefined) vihar[key] = req.body[key];
    });

    if (req.body.fromDate !== undefined)
      vihar.fromDate = toDateOrNull(req.body.fromDate);
    if (req.body.toDate !== undefined)
      vihar.toDate = toDateOrNull(req.body.toDate);
    if (req.body.lat !== undefined) vihar.lat = toNumberOrNull(req.body.lat);
    if (req.body.lng !== undefined) vihar.lng = toNumberOrNull(req.body.lng);

    vihar.updatedBy = req.user?._id || vihar.updatedBy;
    await vihar.save();

    // Agar yahi current record hai to snapshot bhi refresh karo
    if (vihar.isCurrent) {
      await syncCurrentLocation(vihar.sadhuId, vihar, req.user?._id);
    }

    return successResponse(res, "Vihar record updated", vihar);
  } catch (error) {
    console.error("updateSadhuVihar error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── Mark a record as current ─────────────────────────────── */

const setCurrentVihar = async (req, res) => {
  try {
    const { viharId } = req.params;

    const vihar = await SadhuVihar.findById(viharId);
    if (!vihar) {
      return errorResponse(res, "Vihar record not found", 404);
    }

    await markOnlyOneCurrent(vihar.sadhuId, vihar._id);
    vihar.isCurrent = true;
    await syncCurrentLocation(vihar.sadhuId, vihar, req.user?._id);

    return successResponse(res, "Current location updated", vihar);
  } catch (error) {
    console.error("setCurrentVihar error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── Delete a record ──────────────────────────────────────── */

const deleteSadhuVihar = async (req, res) => {
  try {
    const { viharId } = req.params;

    const vihar = await SadhuVihar.findById(viharId);
    if (!vihar) {
      return errorResponse(res, "Vihar record not found", 404);
    }

    const wasCurrent = vihar.isCurrent;
    const sadhuId = vihar.sadhuId;

    await SadhuVihar.findByIdAndDelete(viharId);

    // Current wala delete hua to next latest ko current bana do
    if (wasCurrent) {
      const next = await SadhuVihar.findOne({ sadhuId }).sort({
        fromDate: -1,
        _id: -1,
      });
      if (next) {
        next.isCurrent = true;
        await next.save();
        await syncCurrentLocation(sadhuId, next, req.user?._id);
      } else {
        await Sadhu.findByIdAndUpdate(sadhuId, {
          $set: {
            "currentLocation.placeName": "",
            "currentLocation.state": "",
            "currentLocation.city": "",
            "currentLocation.fromDate": null,
            "currentLocation.toDate": null,
            "currentLocation.updatedAt": new Date(),
          },
        });
      }
    }

    return successResponse(res, "Vihar record deleted", { _id: viharId });
  } catch (error) {
    console.error("deleteSadhuVihar error:", error);
    return errorResponse(res, error.message);
  }
};

module.exports = {
  addSadhuVihar,
  getSadhuViharList,
  getSadhuCurrentVihar,
  updateSadhuVihar,
  setCurrentVihar,
  deleteSadhuVihar,
};
