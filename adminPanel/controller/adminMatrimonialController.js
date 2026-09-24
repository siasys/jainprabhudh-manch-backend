const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const { VyavahikBiodata } = require("../../model/Matrimonial/VyavahikBiodata");
const User = require("../../model/UserRegistrationModels/userModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");

const DAY_MS = 24 * 60 * 60 * 1000;

const USER_FIELDS =
  "firstName lastName fullName accountType profilePicture jainAadharStatus jainAadharNumber phoneNumber email accountStatus";

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/matrimonial/stats
   ═══════════════════════════════════════════════════ */
const getMatrimonialStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const in30Days = new Date(Date.now() + 30 * DAY_MS);

  const [
    total,
    visible,
    hiddenByAdmin,
    paid,
    unpaid,
    male,
    female,
    expiringSoon,
    expiredButLive,
  ] = await Promise.all([
    VyavahikBiodata.countDocuments(),
    VyavahikBiodata.countDocuments({ isVisible: true }),
    VyavahikBiodata.countDocuments({ hiddenByAdmin: true }),
    VyavahikBiodata.countDocuments({ "membershipInfo.paymentStatus": "paid" }),
    VyavahikBiodata.countDocuments({
      "membershipInfo.paymentStatus": { $ne: "paid" },
    }),
    VyavahikBiodata.countDocuments({ gender: { $regex: /^male$/i } }),
    VyavahikBiodata.countDocuments({ gender: { $regex: /^female$/i } }),
    VyavahikBiodata.countDocuments({
      isVisible: true,
      "membershipInfo.validityDate": { $gte: now, $lte: in30Days },
    }),
    // Membership already lapsed but the profile is still on the feed
    VyavahikBiodata.countDocuments({
      isVisible: true,
      "membershipInfo.validityDate": { $lt: now },
    }),
  ]);

  return successResponse(
    res,
    {
      total,
      visible,
      hidden: total - visible,
      hiddenByAdmin,
      paid,
      unpaid,
      male,
      female,
      expiringSoon,
      expiredButLive,
    },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/matrimonial
   Query: status, gender, payment, search, page, limit
   ═══════════════════════════════════════════════════ */
const listProfiles = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const {
    status = "",
    gender = "",
    payment = "",
    search = "",
    sortBy = "recent",
  } = req.query;

  const now = new Date();
  const in30Days = new Date(Date.now() + 30 * DAY_MS);
  const query = {};

  if (status === "visible") query.isVisible = true;
  else if (status === "hidden") query.isVisible = false;
  else if (status === "hidden_by_admin") query.hiddenByAdmin = true;
  else if (status === "expiring") {
    query.isVisible = true;
    query["membershipInfo.validityDate"] = { $gte: now, $lte: in30Days };
  } else if (status === "expired_but_live") {
    query.isVisible = true;
    query["membershipInfo.validityDate"] = { $lt: now };
  }

  if (gender) query.gender = { $regex: `^${gender}$`, $options: "i" };
  if (payment) query["membershipInfo.paymentStatus"] = payment;

  if (search.trim()) {
    const rx = new RegExp(search.trim(), "i");
    query.$or = [
      { name: rx },
      { shravakId: rx },
      { "contactInfo.mobileNumber": rx },
      { "contactInfo.email": rx },
      { "addressInfo.city": rx },
      { "addressInfo.state": rx },
      { "communityInfo.gotra": rx },
    ];
  }

  let sort = { createdAt: -1 };
  if (sortBy === "expiring") sort = { "membershipInfo.validityDate": 1 };
  else if (sortBy === "oldest") sort = { createdAt: 1 };

  const [profiles, total] = await Promise.all([
    VyavahikBiodata.find(query)
      .populate("userId", USER_FIELDS)
      .select(
        "name gender dob age height shravakId jainShravak profile creatorName " +
          "isVisible hiddenByAdmin hideReason hiddenAt expiredAt createdAt " +
          "addressInfo contactInfo communityInfo membershipInfo uploadedPhotos " +
          "marriageInfo education workInfo",
      )
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    VyavahikBiodata.countDocuments(query),
  ]);

  const data = profiles.map((p) => {
    const validity = p.membershipInfo?.validityDate;
    const daysLeft = validity
      ? Math.ceil((new Date(validity) - Date.now()) / DAY_MS)
      : null;

    return {
      ...p,
      photo: p.uploadedPhotos?.[0]?.url || null,
      photoCount: p.uploadedPhotos?.length || 0,
      uploadedPhotos: undefined, // full list only in the detail view
      daysLeft,
      isExpired: daysLeft !== null && daysLeft < 0,
    };
  });

  return successResponse(
    res,
    { profiles: data, total, page, pages: Math.ceil(total / limit) },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/matrimonial/:id
   ═══════════════════════════════════════════════════ */
const getProfileDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return errorResponse(res, "Invalid profile id", 400);

  const profile = await VyavahikBiodata.findById(id)
    .populate("userId", USER_FIELDS)
    .populate("hiddenBy", "name role")
    .select("-likedProfiles -interestsSent -interestsReceived") // private to users
    .lean();

  if (!profile) return errorResponse(res, "Profile not found", 404);

  const validity = profile.membershipInfo?.validityDate;
  const daysLeft = validity
    ? Math.ceil((new Date(validity) - Date.now()) / DAY_MS)
    : null;

  return successResponse(
    res,
    {
      profile: {
        ...profile,
        daysLeft,
        isExpired: daysLeft !== null && daysLeft < 0,
      },
    },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════
   PATCH /api/admin-panel/matrimonial/:id/visibility
   Body: { action: "hide" | "unhide", reason }
   ═══════════════════════════════════════════════════ */
const toggleVisibility = asyncHandler(async (req, res) => {
  const { action, reason = "" } = req.body;

  if (!["hide", "unhide"].includes(action))
    return errorResponse(res, "Action must be 'hide' or 'unhide'", 400);
  if (action === "hide" && !reason.trim())
    return errorResponse(res, "Please give a reason for hiding", 400);

  const profile = await VyavahikBiodata.findById(req.params.id);
  if (!profile) return errorResponse(res, "Profile not found", 404);

  if (action === "hide") {
    profile.isVisible = false;
    profile.hiddenByAdmin = true;
    profile.hiddenBy = req.admin._id;
    profile.hiddenAt = new Date();
    profile.hideReason = reason;
  } else {
    profile.hiddenByAdmin = false;
    profile.hiddenBy = null;
    profile.hiddenAt = null;
    profile.hideReason = "";

    // Only put it back on the feed if the membership is still valid
    const validity = profile.membershipInfo?.validityDate;
    const stillValid = validity && new Date(validity) > new Date();
    profile.isVisible = !!stillValid;
  }

  await profile.save();

  await logAction(req, {
    action: action === "hide" ? "matrimonial.hide" : "matrimonial.unhide",
    targetType: "VyavahikBiodata",
    targetId: profile._id,
    description: `${action === "hide" ? "Hid" : "Unhid"} the matrimonial profile of ${profile.name}${
      reason ? ` — ${reason}` : ""
    }`,
    meta: { reason },
  });

  return successResponse(
    res,
    { isVisible: profile.isVisible, hiddenByAdmin: profile.hiddenByAdmin },
    action === "hide"
      ? "Profile hidden"
      : profile.isVisible
      ? "Profile is visible again"
      : "Unhidden, but the membership has expired so it stays off the feed",
  );
});

/* ═══════════════════════════════════════════════════
   PATCH /api/admin-panel/matrimonial/:id/membership
   Body: { action: "extend" | "expire", months, reason }
   ═══════════════════════════════════════════════════ */
const updateMembership = asyncHandler(async (req, res) => {
  const { action, months = 12, reason = "" } = req.body;

  if (!["extend", "expire"].includes(action))
    return errorResponse(res, "Action must be 'extend' or 'expire'", 400);

  const profile = await VyavahikBiodata.findById(req.params.id);
  if (!profile) return errorResponse(res, "Profile not found", 404);

  if (!profile.membershipInfo) profile.membershipInfo = {};

  if (action === "extend") {
    const n = parseInt(months);
    if (!n || n < 1 || n > 60)
      return errorResponse(res, "Months must be between 1 and 60", 400);

    // Extend from the current expiry if it's still in the future,
    // otherwise from today
    const current = profile.membershipInfo.validityDate;
    const base =
      current && new Date(current) > new Date() ? new Date(current) : new Date();
    base.setMonth(base.getMonth() + n);

    profile.membershipInfo.validityDate = base;
    profile.expiredAt = null;

    // Put it back on the feed unless an admin deliberately hid it
    if (!profile.hiddenByAdmin) profile.isVisible = true;
  } else {
    profile.membershipInfo.validityDate = new Date();
    profile.expiredAt = new Date();
    profile.isVisible = false;
  }

  await profile.save();

  await logAction(req, {
    action: action === "extend" ? "matrimonial.extend" : "matrimonial.expire",
    targetType: "VyavahikBiodata",
    targetId: profile._id,
    description:
      action === "extend"
        ? `Extended ${profile.name}'s membership by ${months} month(s)${reason ? ` — ${reason}` : ""}`
        : `Ended ${profile.name}'s membership${reason ? ` — ${reason}` : ""}`,
    meta: { reason, months, newValidity: profile.membershipInfo.validityDate },
  });

  return successResponse(
    res,
    {
      validityDate: profile.membershipInfo.validityDate,
      isVisible: profile.isVisible,
    },
    action === "extend"
      ? `Membership extended by ${months} month(s)`
      : "Membership ended",
  );
});

/* ═══════════════════════════════════════════════════
   DELETE /api/admin-panel/matrimonial/:id/photos/:photoId
   Removes one photo. Admins remove, never replace.
   ═══════════════════════════════════════════════════ */
const removePhoto = asyncHandler(async (req, res) => {
  const { id, photoId } = req.params;
  const { reason = "" } = req.body;

  const profile = await VyavahikBiodata.findById(id);
  if (!profile) return errorResponse(res, "Profile not found", 404);

  const photo = profile.uploadedPhotos.id(photoId);
  if (!photo) return errorResponse(res, "Photo not found", 404);

  const label = photo.label || "photo";
  photo.deleteOne();
  await profile.save();

  await logAction(req, {
    action: "matrimonial.remove_photo",
    targetType: "VyavahikBiodata",
    targetId: profile._id,
    description: `Removed a ${label} from ${profile.name}'s matrimonial profile${
      reason ? ` — ${reason}` : ""
    }`,
    meta: { photoId, label, reason },
  });

  return successResponse(res, null, "Photo removed");
});

/* ═══════════════════════════════════════════════════
   POST /api/admin-panel/matrimonial/expire-lapsed

   Sweeps every profile whose membership has run out but is
   still on the feed, and takes it down. Safe to run repeatedly.
   ═══════════════════════════════════════════════════ */
const expireLapsed = asyncHandler(async (req, res) => {
  const now = new Date();

  const result = await VyavahikBiodata.updateMany(
    {
      isVisible: true,
      "membershipInfo.validityDate": { $lt: now },
    },
    { $set: { isVisible: false, expiredAt: now } },
  );

  await logAction(req, {
    action: "matrimonial.expire_sweep",
    targetType: "VyavahikBiodata",
    targetId: null,
    description: `Took ${result.modifiedCount} lapsed profile(s) off the feed`,
    meta: { count: result.modifiedCount },
  });

  return successResponse(
    res,
    { expired: result.modifiedCount },
    result.modifiedCount === 0
      ? "No lapsed profiles found"
      : `${result.modifiedCount} lapsed profile(s) taken off the feed`,
  );
});

module.exports = {
  getMatrimonialStats,
  listProfiles,
  getProfileDetail,
  toggleVisibility,
  updateMembership,
  removePhoto,
  expireLapsed,
};