const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const SuggestionComplaint = require("../../model/SuggestionComplaintModels/SuggestionComplaint");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");

const USER_FIELDS =
  "firstName lastName fullName businessName tirthName sadhuName accountType profilePicture location city state phoneNumber email jainAadharStatus";

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/feedback/stats
   ═══════════════════════════════════════════════════ */
const getFeedbackStats = asyncHandler(async (req, res) => {
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [pending, inReview, resolved, complaints, newThisWeek, oldestPending] =
    await Promise.all([
      SuggestionComplaint.countDocuments({ status: "pending" }),
      SuggestionComplaint.countDocuments({ status: "in-review" }),
      SuggestionComplaint.countDocuments({ status: "resolved" }),
      SuggestionComplaint.countDocuments({
        type: "complaint",
        status: { $ne: "resolved" },
      }),
      SuggestionComplaint.countDocuments({ createdAt: { $gte: last7d } }),
      SuggestionComplaint.findOne({ status: { $ne: "resolved" } })
        .sort({ createdAt: 1 })
        .select("createdAt")
        .lean(),
    ]);

  const waitingDays = oldestPending
    ? Math.floor((Date.now() - new Date(oldestPending.createdAt)) / 86400000)
    : 0;

  return successResponse(
    res,
    {
      pending,
      inReview,
      resolved,
      openComplaints: complaints,
      newThisWeek,
      oldestOpenDays: waitingDays,
      openTotal: pending + inReview,
    },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/feedback
   Query: status, type, search, page, limit, sortBy
   ═══════════════════════════════════════════════════ */
const listFeedback = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const { status = "", type = "", search = "", sortBy = "oldest" } = req.query;

  const query = {};

  if (status === "open") query.status = { $in: ["pending", "in-review"] };
  else if (status) query.status = status;

  if (type) query.type = type;

  if (search.trim()) {
    const rx = new RegExp(search.trim(), "i");
    query.$or = [{ subject: rx }, { description: rx }];
  }

  // Open items go oldest-first so nothing sits ignored;
  // resolved ones newest-first since they're just history
  const sort =
    sortBy === "newest" || status === "resolved"
      ? { createdAt: -1 }
      : { createdAt: 1 };

  const [items, total] = await Promise.all([
    SuggestionComplaint.find(query)
      .populate("submittedBy", USER_FIELDS)
      .populate("respondedBy", "name role")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SuggestionComplaint.countDocuments(query),
  ]);

  const data = items.map((it) => ({
    ...it,
    waitingDays: Math.floor((Date.now() - new Date(it.createdAt)) / 86400000),
  }));

  return successResponse(
    res,
    { items: data, total, page, pages: Math.ceil(total / limit) },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/feedback/:id
   ═══════════════════════════════════════════════════ */
const getFeedbackDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return errorResponse(res, "Invalid id", 400);

  const item = await SuggestionComplaint.findById(id)
    .populate("submittedBy", USER_FIELDS)
    .populate("respondedBy", "name role")
    .lean();

  if (!item) return errorResponse(res, "Not found", 404);

  // Has this person written in before? Useful context for whoever replies.
  const otherItems = await SuggestionComplaint.find({
    submittedBy: item.submittedBy?._id,
    _id: { $ne: id },
  })
    .select("type subject status createdAt")
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  return successResponse(res, { item, previousFromUser: otherItems }, "OK");
});

/* ═══════════════════════════════════════════════════
   PUT /api/admin-panel/feedback/:id/respond
   Body: { status, response }
   ═══════════════════════════════════════════════════ */
const respondToFeedback = asyncHandler(async (req, res) => {
  const { status, response = "" } = req.body;

  const VALID = ["pending", "in-review", "resolved"];
  if (status && !VALID.includes(status))
    return errorResponse(res, "Invalid status", 400);

  if (status === "resolved" && !response.trim())
    return errorResponse(
      res,
      "Please write a reply before marking this as resolved",
      400,
    );

  const item = await SuggestionComplaint.findById(req.params.id);
  if (!item) return errorResponse(res, "Not found", 404);

  const before = { status: item.status, response: item.response };

  if (status) item.status = status;
  if (response.trim()) {
    item.response = response.trim();
    item.respondedBy = req.admin._id;
    item.respondedAt = new Date();
  }

  await item.save();

  await logAction(req, {
    action: "feedback.respond",
    targetType: "SuggestionComplaint",
    targetId: item._id,
    description: `Updated a ${item.type} — "${item.subject?.slice(0, 60)}" → ${item.status}`,
    meta: { before, after: { status: item.status, response: item.response } },
  });

  // TODO: notify the user that their submission got a reply

  return successResponse(
    res,
    { status: item.status },
    status === "resolved" ? "Marked as resolved" : "Updated",
  );
});

module.exports = {
  getFeedbackStats,
  listFeedback,
  getFeedbackDetail,
  respondToFeedback,
};