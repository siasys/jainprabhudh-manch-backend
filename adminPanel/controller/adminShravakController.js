const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const JainAadhar = require("../../model/UserRegistrationModels/jainAadharModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");


const USER_FIELDS =
  "firstName lastName fullName accountType profilePicture jainAadharStatus jainAadharNumber location city state phoneNumber email createdAt";

/**
/**
 * Generates a Jain Aadhar number: "JAIN" + a random 8-digit number.
 * Matches the existing generator exactly so both panels issue numbers
 * in the same format and never collide.
 */
const generateJainAadharNumber = async () => {
  // Retry until we find a number nobody has
  for (let i = 0; i < 50; i++) {
    const randomNum = Math.floor(10000000 + Math.random() * 90000000);
    const jainAadharNumber = `JAIN${randomNum}`;

    const [userClash, appClash] = await Promise.all([
      User.findOne({ jainAadharNumber }).select("_id").lean(),
      JainAadhar.findOne({ jainAadharNumber }).select("_id").lean(),
    ]);

    if (!userClash && !appClash) return jainAadharNumber;
  }

  throw new Error("Could not generate a unique card number, please try again");
};

/* ═══════════════════════════════════════════════
   GET /api/admin-panel/shravak/stats
   ═══════════════════════════════════════════════ */
const getShravakStats = asyncHandler(async (req, res) => {
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [pending, approved, rejected, newThisWeek, oldestPending] =
    await Promise.all([
      JainAadhar.countDocuments({ status: "pending" }),
      JainAadhar.countDocuments({ status: "approved" }),
      JainAadhar.countDocuments({ status: "rejected" }),
      JainAadhar.countDocuments({ createdAt: { $gte: last7d } }),
      JainAadhar.findOne({ status: "pending" })
        .sort({ createdAt: 1 })
        .select("createdAt")
        .lean(),
    ]);

  // How many days the oldest pending application has been waiting
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
   GET /api/admin-panel/shravak
   Query: status, search, page, limit, sortBy
   ═══════════════════════════════════════════════ */
const listApplications = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const { status = "pending", search = "", sortBy = "oldest" } = req.query;

  const query = {};
  if (status && status !== "all") query.status = status;

  if (search.trim()) {
    const rx = new RegExp(search.trim(), "i");
    query.$or = [
      { name: rx },
      { jainAadharNumber: rx },
      { "contactDetails.number": rx },
      { "contactDetails.email": rx },
      { "location.city": rx },
      { "location.state": rx },
    ];
  }

  // Pending queue is oldest-first so nobody waits forever
  const sort = sortBy === "newest" ? { createdAt: -1 } : { createdAt: 1 };

  const [apps, total] = await Promise.all([
    JainAadhar.find(query)
      .populate("userId", USER_FIELDS)
      .select(
        "name gender dob age contactDetails location status createdAt updatedAt " +
          "jainAadharNumber userProfile AadharCard mulJain panth applicationLevel " +
          "marriedStatus education job business student reviewedBy",
      )
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    JainAadhar.countDocuments(query),
  ]);

  const data = apps.map((a) => ({
    ...a,
    waitingDays: Math.floor((Date.now() - new Date(a.createdAt)) / 86400000),
  }));

  return successResponse(
    res,
    { applications: data, total, page, pages: Math.ceil(total / limit) },
    "OK",
  );
});

/* ═══════════════════════════════════════════════
   GET /api/admin-panel/shravak/:id
   Full application with every field
   ═══════════════════════════════════════════════ */
const getApplicationDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return errorResponse(res, "Invalid application id", 400);

  const app = await JainAadhar.findById(id)
    .populate("userId", USER_FIELDS)
    .populate("createdBy", USER_FIELDS)
    .populate("reviewHistory.by", "firstName lastName fullName")
    .populate("reviewedBy.userId", "firstName lastName fullName")
    .lean();

  if (!app) return errorResponse(res, "Application not found", 404);

  // Has this person applied before? Useful context for the reviewer.
  const otherApps = await JainAadhar.find({
    userId: app.userId?._id,
    _id: { $ne: id },
  })
    .select("status createdAt jainAadharNumber")
    .sort({ createdAt: -1 })
    .lean();

  return successResponse(
    res,
    { application: app, previousApplications: otherApps },
    "OK",
  );
});

/* ═══════════════════════════════════════════════
   PUT /api/admin-panel/shravak/:id/review
   Body: { status: "approved" | "rejected", remarks }

   This is the admin panel's own reviewer. It uses permissions
   instead of a hardcoded list of user IDs, so the CEO can grant
   review rights to any team member.
   ═══════════════════════════════════════════════ */
const reviewApplication = asyncHandler(async (req, res) => {
  const { status, remarks = "" } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return errorResponse(res, "Status must be 'approved' or 'rejected'", 400);
  }
  if (status === "rejected" && !remarks.trim()) {
    return errorResponse(res, "Please give a reason for rejecting", 400);
  }

  const app = await JainAadhar.findById(req.params.id);
  if (!app) return errorResponse(res, "Application not found", 404);

  if (app.status === "approved") {
    return errorResponse(res, "This application is already approved", 400);
  }

  app.status = status;

  // The existing schema expects reviewHistory.by to be a User ref, but an
  // admin panel account is not a User. Store the applicant's own id there to
  // satisfy the ref, and keep the real reviewer in remarks + our audit log.
  app.reviewHistory.push({
    action: status,
    by: app.userId,
    level: "admin",
    sanghId: null,
    remarks: `[Admin Panel · ${req.admin.name}] ${remarks}`.trim(),
    timestamp: new Date(),
  });

  let issuedNumber = null;

  if (status === "approved") {
    if (!app.jainAadharNumber) {
      issuedNumber = await generateJainAadharNumber();
      app.jainAadharNumber = issuedNumber;
    } else {
      issuedNumber = app.jainAadharNumber;
    }

    await User.findByIdAndUpdate(app.userId, {
      jainAadharStatus: "verified",
      jainAadharNumber: issuedNumber,
      adminVerifiedAt: new Date(),
    });
  } else {
    await User.findByIdAndUpdate(app.userId, { jainAadharStatus: "rejected" });
  }

  await app.save();

  // Notify the applicant — same notification type the existing flow uses
  if (status === "approved") {
    try {
      const Notification = mongoose.model("Notification");
      await Notification.create({
        senderId: app.userId,
        receiverId: app.userId,
        type: "jain_aadhar_approved",
        jainAadharId: app._id,
        message: "🎉 Your Jain Shravak Card has been approved.",
      });
    } catch (e) {
      console.error("[adminPanel] shravak approval notification failed:", e.message);
    }
  }

  await logAction(req, {
    action: status === "approved" ? "shravak.approve" : "shravak.reject",
    targetType: "JainAadhar",
    targetId: app._id,
    description: `${status === "approved" ? "Approved" : "Rejected"} the Shravak Card application of ${app.name}${
      remarks ? ` — ${remarks}` : ""
    }`,
    meta: { remarks, issuedNumber, applicantId: String(app.userId) },
  });

  return successResponse(
    res,
    { status, jainAadharNumber: issuedNumber },
    status === "approved"
      ? `Application approved. Card number ${issuedNumber} issued.`
      : "Application rejected",
  );
});

module.exports = {
  getShravakStats,
  listApplications,
  getApplicationDetail,
  reviewApplication,
};