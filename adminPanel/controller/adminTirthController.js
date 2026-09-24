const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Tirth = require("../../model/TirthModels/tirthModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");

const OWNER_FIELDS =
  "firstName lastName fullName accountType profilePicture phoneNumber email city state createdAt";

/* ═══════════════════════════════════════════════
   GET /api/admin-panel/tirth/stats
   ═══════════════════════════════════════════════ */
const getTirthStats = asyncHandler(async (req, res) => {
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [pending, approved, rejected, newThisWeek, oldestPending] =
    await Promise.all([
      Tirth.countDocuments({ applicationStatus: "pending", status: "active" }),
      Tirth.countDocuments({ applicationStatus: "approved", status: "active" }),
      Tirth.countDocuments({ applicationStatus: "rejected", status: "active" }),
      Tirth.countDocuments({ createdAt: { $gte: last7d }, status: "active" }),
      Tirth.findOne({ applicationStatus: "pending", status: "active" })
        .sort({ createdAt: 1 })
        .select("createdAt")
        .lean(),
    ]);

  const waitingDays = oldestPending
    ? Math.floor((Date.now() - new Date(oldestPending.createdAt)) / 86400000)
    : 0;

  return successResponse(
    res,
    { pending, approved, rejected, newThisWeek, oldestPendingDays: waitingDays },
    "OK",
  );
});

/* ═══════════════════════════════════════════════
   GET /api/admin-panel/tirth
   Query: status, search, page, limit, sortBy
   ═══════════════════════════════════════════════ */
const listTirths = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const { status = "pending", search = "", sortBy = "oldest" } = req.query;

  const query = { status: "active" };
  if (status && status !== "all") query.applicationStatus = status;

  if (search.trim()) {
    const rx = new RegExp(
      search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    query.$or = [
      { "basic.name": rx },
      { "basic.trust": rx },
      { "address.city": rx },
      { "address.state": rx },
      { "contact.primary": rx },
      { "team.managerName": rx },
    ];
  }

  // pending queue oldest-first — koi hamesha intezaar na kare
  const sort = sortBy === "newest" ? { createdAt: -1 } : { createdAt: 1 };

  const [tirths, total] = await Promise.all([
    Tirth.find(query)
      .populate("submittedBy", OWNER_FIELDS)
      .select(
        "basic address contact team photos applicationStatus reviewNotes createdAt updatedAt",
      )
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Tirth.countDocuments(query),
  ]);

  const data = tirths.map((t) => ({
    _id: t._id,
    name: t.basic?.name || "",
    trust: t.basic?.trust || "",
    sect: t.basic?.sect || "",
    type: t.basic?.type || "",
    city: t.address?.city || "",
    district: t.address?.district || "",
    state: t.address?.state || "",
    phone: t.contact?.primary || "",
    managerName: t.team?.managerName || "",
    photo: t.photos?.[0] || "",
    photoCount: (t.photos || []).length,
    applicationStatus: t.applicationStatus,
    reviewNotes: t.reviewNotes,
    submittedBy: t.submittedBy,
    createdAt: t.createdAt,
    waitingDays: Math.floor((Date.now() - new Date(t.createdAt)) / 86400000),
  }));

  return successResponse(
    res,
    { tirths: data, total, page, pages: Math.ceil(total / limit) },
    "OK",
  );
});

/* ═══════════════════════════════════════════════
   GET /api/admin-panel/tirth/:id
   Poori application — har field
   ═══════════════════════════════════════════════ */
const getTirthDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return errorResponse(res, "Invalid tirth id", 400);

  const tirth = await Tirth.findById(id)
    .populate("submittedBy", OWNER_FIELDS)
    .populate("reviewNotes.reviewedBy", "firstName lastName fullName")
    .lean();

  if (!tirth) return errorResponse(res, "Tirth not found", 404);

  // isi user ne aur kaunse tirth submit kiye — reviewer ke liye context
  const otherTirths = await Tirth.find({
    submittedBy: tirth.submittedBy?._id,
    _id: { $ne: id },
    status: "active",
  })
    .select("basic.name address.city applicationStatus createdAt")
    .sort({ createdAt: -1 })
    .lean();

  return successResponse(
    res,
    {
      tirth,
      otherTirths: otherTirths.map((t) => ({
        _id: t._id,
        name: t.basic?.name || "",
        city: t.address?.city || "",
        applicationStatus: t.applicationStatus,
        createdAt: t.createdAt,
      })),
    },
    "OK",
  );
});

/* ═══════════════════════════════════════════════
   PUT /api/admin-panel/tirth/:id/review
   Body: { status: "approved" | "rejected", remarks }
   ═══════════════════════════════════════════════ */
const reviewTirth = asyncHandler(async (req, res) => {
  const { status, remarks = "" } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return errorResponse(res, "Status must be 'approved' or 'rejected'", 400);
  }
  if (status === "rejected" && !remarks.trim()) {
    return errorResponse(res, "Please give a reason for rejecting", 400);
  }

  const tirth = await Tirth.findById(req.params.id);
  if (!tirth) return errorResponse(res, "Tirth not found", 404);

  if (tirth.applicationStatus === status) {
    return errorResponse(res, `This tirth is already ${status}`, 400);
  }

  tirth.applicationStatus = status;
  tirth.reviewNotes = {
    text: `[Admin Panel · ${req.admin?.name || "Admin"}] ${remarks}`.trim(),
    reviewedBy: tirth.submittedBy, // schema User ref maangta hai
    reviewedAt: new Date(),
  };

  await tirth.save();

  const ownerId = tirth.submittedBy;
  const tirthName = tirth.basic?.name || "Your Tirth";

  if (ownerId) {
    if (status === "approved") {
      // role pehle se hota hai (apply ke waqt mil jata hai), phir bhi
      // safety ke liye check kar lete hain
      try {
        const user = await User.findById(ownerId).select("tirthRoles");
        if (user) {
          if (!Array.isArray(user.tirthRoles)) user.tirthRoles = [];
          const has = user.tirthRoles.some(
            (r) => String(r.tirthId) === String(tirth._id),
          );
          if (!has) {
            user.tirthRoles.push({
              tirthId: tirth._id,
              role: "manager",
              approvedAt: new Date(),
            });
            user.markModified("tirthRoles");
            await user.save();
          }
        }
      } catch (e) {
        console.error("[adminPanel] tirth role assign failed:", e.message);
      }
    } else {
      // reject par access wapas le lo
      try {
        await User.updateOne(
          { _id: ownerId },
          { $pull: { tirthRoles: { tirthId: tirth._id } } },
        );
      } catch (e) {
        console.error("[adminPanel] tirth role remove failed:", e.message);
      }
    }

    /* ---- app me notification ---- */
    const message =
      status === "approved"
        ? `🎉 ${tirthName} ki profile approve ho gayi hai. Ab aap ise manage kar sakte hain.`
        : `${tirthName} ki application reject ho gayi hai. ${remarks}`.trim();

    try {
      const Notification = mongoose.model("Notification");
      await Notification.create({
        senderId: ownerId,
        receiverId: ownerId,
        type: status === "approved" ? "tirth_approved" : "tirth_rejected",
        tirthId: tirth._id,
        message,
      });
    } catch (e) {
      console.error("[adminPanel] tirth notification failed:", e.message);
    }

    /* push alag se — model ka hook self-notification par push skip karta hai */
    try {
      const { sendPushToUsers } = require("../../config/firebaseAdmin");
      await sendPushToUsers([ownerId], {
        title: status === "approved" ? "Tirth Approved" : "Tirth Rejected",
        body: message,
        data: {
          type: "notification",
          notifType: status === "approved" ? "tirth_approved" : "tirth_rejected",
          tirthId: String(tirth._id),
        },
      });
    } catch (e) {
      console.error("[adminPanel] tirth push failed:", e.message);
    }
  }

  await logAction(req, {
    action: status === "approved" ? "tirth.approve" : "tirth.reject",
    targetType: "Tirth",
    targetId: tirth._id,
    description: `${status === "approved" ? "Approved" : "Rejected"} the Tirth application of ${tirthName}${
      remarks ? ` — ${remarks}` : ""
    }`,
    meta: { remarks, ownerId: String(ownerId || "") },
  });

  return successResponse(
    res,
    { status },
    status === "approved"
      ? "Tirth approved. The owner can now manage it."
      : "Tirth application rejected",
  );
});

module.exports = {
  getTirthStats,
  listTirths,
  getTirthDetail,
  reviewTirth,
};