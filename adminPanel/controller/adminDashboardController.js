const asyncHandler = require("express-async-handler");
const { successResponse } = require("../../utils/apiResponse");
const AuditLog = require("../model/auditLogModel");

// Existing models — we only READ from these
const User = require("../../model/UserRegistrationModels/userModel");
const Post = require("../../model/SocialMediaModels/postModel");
const Story = require("../../model/SocialMediaModels/storyModel");
const Report = require("../../model/SocialMediaModels/Report");
const StoryReport = require("../../model/SocialMediaModels/StoryReport");
const CommentReport = require("../../model/SocialMediaModels/CommentReport");
const JainAadhar = require("../../model/UserRegistrationModels/jainAadharModel");
const SuggestionComplaint = require("../../model/SuggestionComplaintModels/SuggestionComplaint");
const { VyavahikBiodata } = require("../../model/Matrimonial/VyavahikBiodata");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Counts a collection, returning 0 instead of throwing if the model
 * or collection isn't there. Keeps one bad module from breaking the
 * whole dashboard.
 */
const safeCount = (model, filter = {}) =>
  model
    ? model.countDocuments(filter).catch(() => 0)
    : Promise.resolve(0);

/* ───────────── GET /api/admin-panel/dashboard/stats ───────────── */
const getStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const last24h = new Date(now.getTime() - DAY_MS);
  const last7d = new Date(now.getTime() - 7 * DAY_MS);
  const in30Days = new Date(now.getTime() + 30 * DAY_MS);

  const [
    // Users
    totalUsers,
    newUsers7d,
    suspendedUsers,
    normalUsers,
    businessUsers,
    tirthUsers,
    sadhuUsers,

    // Content
    totalPosts,
    posts24h,
    hiddenPosts,
    activeStories,

    // Moderation
    pendingPostReports,
    pendingStoryReports,
    pendingCommentReports,

    // Shravak Card
    aadharApproved,
    aadharPending,
    aadharRejected,

    // Suggestions
    feedbackOpen,
    feedbackComplaints,

    // Matrimonial
    matrimonialTotal,
    matrimonialLive,
    matrimonialExpiring,
    matrimonialLapsedLive,
  ] = await Promise.all([
    safeCount(User),
    safeCount(User, { createdAt: { $gte: last7d } }),
    safeCount(User, { accountStatus: "deactivated" }),
    safeCount(User, { accountType: "user" }),
    safeCount(User, { accountType: "business" }),
    safeCount(User, { accountType: "tirth" }),
    safeCount(User, { accountType: "sadhu" }),

    safeCount(Post, { isDeleted: { $ne: true } }),
    safeCount(Post, { createdAt: { $gte: last24h }, isDeleted: { $ne: true } }),
    safeCount(Post, { isHidden: true, isDeleted: { $ne: true } }),
    safeCount(Story, { createdAt: { $gte: last24h }, isDeleted: { $ne: true } }),

    safeCount(Report, { status: "Pending" }),
    safeCount(StoryReport, { status: "Pending" }),
    safeCount(CommentReport, { status: "Pending" }),

    safeCount(JainAadhar, { status: "approved" }),
    safeCount(JainAadhar, { status: "pending" }),
    safeCount(JainAadhar, { status: "rejected" }),

    safeCount(SuggestionComplaint, { status: { $in: ["pending", "in-review"] } }),
    safeCount(SuggestionComplaint, {
      type: "complaint",
      status: { $ne: "resolved" },
    }),

    safeCount(VyavahikBiodata),
    safeCount(VyavahikBiodata, { isVisible: true }),
    safeCount(VyavahikBiodata, {
      isVisible: true,
      "membershipInfo.validityDate": { $gte: now, $lte: in30Days },
    }),
    safeCount(VyavahikBiodata, {
      isVisible: true,
      "membershipInfo.validityDate": { $lt: now },
    }),
  ]);

  return successResponse(
    res,
    {
      users: {
        total: totalUsers,
        newLast7Days: newUsers7d,
        suspended: suspendedUsers,
        byType: {
          user: normalUsers,
          business: businessUsers,
          tirth: tirthUsers,
          sadhu: sadhuUsers,
        },
      },
      posts: {
        total: totalPosts,
        last24Hours: posts24h,
        hidden: hiddenPosts,
      },
      stories: { activeNow: activeStories },
      reports: {
        pendingPost: pendingPostReports,
        pendingStory: pendingStoryReports,
        pendingComment: pendingCommentReports,
        pendingTotal:
          pendingPostReports + pendingStoryReports + pendingCommentReports,
      },
      shravak: {
        approved: aadharApproved,
        pending: aadharPending,
        rejected: aadharRejected,
      },
      feedback: {
        open: feedbackOpen,
        openComplaints: feedbackComplaints,
      },
      matrimonial: {
        total: matrimonialTotal,
        live: matrimonialLive,
        expiringSoon: matrimonialExpiring,
        lapsedButLive: matrimonialLapsedLive,
      },
    },
    "OK",
  );
});

/* ───────────── GET /api/admin-panel/audit ───────────── */
const getAuditLogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 30);
  const { adminId, action } = req.query;

  const query = {};
  if (adminId) query.admin = adminId;
  if (action) query.action = { $regex: `^${action}`, $options: "i" };

  const [logs, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(query),
  ]);

  return successResponse(
    res,
    { logs, total, page, pages: Math.ceil(total / limit) },
    "OK",
  );
});

module.exports = { getStats, getAuditLogs };