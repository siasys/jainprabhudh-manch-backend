const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Report = require("../../model/SocialMediaModels/Report");
const StoryReport = require("../../model/SocialMediaModels/StoryReport");
const CommentReport = require("../../model/SocialMediaModels/CommentReport");
const Post = require("../../model/SocialMediaModels/postModel");
const Story = require("../../model/SocialMediaModels/storyModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");

const USER_FIELDS =
  "firstName lastName fullName businessName tirthName sadhuName accountType profilePicture jainAadharStatus location city state accountStatus";

/**
 * The four kinds of report we handle.
 *  - post    → Report with reportType "A specific post"
 *  - account → Report with reportType "Something about this account"
 *  - story   → StoryReport
 *  - comment → CommentReport
 */
const KIND = {
  POST: "post",
  ACCOUNT: "account",
  STORY: "story",
  COMMENT: "comment",
};

/* Resolve which model a report kind lives in */
const modelFor = (kind) => {
  if (kind === KIND.STORY) return StoryReport;
  if (kind === KIND.COMMENT) return CommentReport;
  return Report; // post + account
};

/* ═══════════════════════════════════════════════════════════
   GET /api/admin-panel/reports/stats
   ═══════════════════════════════════════════════════════════ */
const getReportStats = asyncHandler(async (req, res) => {
  const [
    pendingPost,
    pendingAccount,
    pendingStory,
    pendingComment,
    resolvedTotal,
  ] = await Promise.all([
    Report.countDocuments({ status: "Pending", reportType: "A specific post" }),
    Report.countDocuments({
      status: "Pending",
      reportType: "Something about this account",
    }),
    StoryReport.countDocuments({ status: "Pending" }),
    CommentReport.countDocuments({ status: "Pending" }),
    Promise.all([
      Report.countDocuments({ status: { $in: ["Resolved", "Rejected", "Reviewed"] } }),
      StoryReport.countDocuments({ status: { $in: ["Resolved", "Rejected", "Reviewed"] } }),
      CommentReport.countDocuments({
        status: { $in: ["Resolved", "Rejected", "Reviewed"] },
      }),
    ]).then((a) => a.reduce((x, y) => x + y, 0)),
  ]);

  return successResponse(
    res,
    {
      pendingPost,
      pendingAccount,
      pendingStory,
      pendingComment,
      pendingTotal: pendingPost + pendingAccount + pendingStory + pendingComment,
      resolvedTotal,
    },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════════════
   GET /api/admin-panel/reports
   Query: kind, status, page, limit

   Reports for the same target are GROUPED into one row, so if
   10 people reported the same post the admin sees one entry
   with a count of 10 — not 10 separate rows to act on.
   ═══════════════════════════════════════════════════════════ */
const listReports = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const kind = req.query.kind || "";
  const status = req.query.status || "Pending";

  /**
   * Builds a grouped aggregation for one report model.
   * groupKey — the field that identifies the reported thing.
   */
  const buildGroups = async (Model, groupKey, extraMatch = {}) => {
    const match = { ...extraMatch };
    if (status !== "all") match.status = status;

    return Model.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: `$${groupKey}`,
          reportCount: { $sum: 1 },
          latestAt: { $first: "$createdAt" },
          firstAt: { $last: "$createdAt" },
          reasons: { $push: "$reason" },
          reporters: { $push: "$reportedBy" },
          reportIds: { $push: "$_id" },
          statuses: { $addToSet: "$status" },
          latestStatus: { $first: "$status" },
          reviewedBy: { $first: "$reviewedBy" },
          reviewedAt: { $first: "$reviewedAt" },
          actionTaken: { $first: "$actionTaken" },
          adminNote: { $first: "$adminNote" },
          commentId: { $first: "$commentId" },
        },
      },
      { $match: { _id: { $ne: null } } },
    ]);
  };

  // Collect groups from whichever models are in scope
  let groups = [];

  if (!kind || kind === KIND.POST) {
    const g = await buildGroups(Report, "postId", {
      reportType: "A specific post",
    });
    groups.push(...g.map((x) => ({ ...x, kind: KIND.POST })));
  }

  if (!kind || kind === KIND.ACCOUNT) {
    const g = await buildGroups(Report, "reportedUser", {
      reportType: "Something about this account",
    });
    groups.push(...g.map((x) => ({ ...x, kind: KIND.ACCOUNT })));
  }

  if (!kind || kind === KIND.STORY) {
    const g = await buildGroups(StoryReport, "storyId");
    groups.push(...g.map((x) => ({ ...x, kind: KIND.STORY })));
  }

  if (!kind || kind === KIND.COMMENT) {
    // Comments are grouped by commentId so each comment is one row
    const g = await buildGroups(CommentReport, "commentId");
    groups.push(...g.map((x) => ({ ...x, kind: KIND.COMMENT })));
  }

  // Most-reported first, then most recent
  groups.sort((a, b) => {
    if (b.reportCount !== a.reportCount) return b.reportCount - a.reportCount;
    return new Date(b.latestAt) - new Date(a.latestAt);
  });

  const total = groups.length;
  const paged = groups.slice((page - 1) * limit, page * limit);

  /* ── Now hydrate: fetch the actual posts / stories / users ── */
  const postIds = paged.filter((g) => g.kind === KIND.POST).map((g) => g._id);
  const storyIds = paged.filter((g) => g.kind === KIND.STORY).map((g) => g._id);
  const accountIds = paged.filter((g) => g.kind === KIND.ACCOUNT).map((g) => g._id);
  const reviewerIds = paged.map((g) => g.reviewedBy).filter(Boolean);

  // For comment reports we need the parent post, so fetch those separately
  const commentGroups = paged.filter((g) => g.kind === KIND.COMMENT);
  const commentPostIds = [];
  if (commentGroups.length) {
    const crs = await CommentReport.find({
      commentId: { $in: commentGroups.map((g) => g._id) },
    })
      .select("commentId postId")
      .lean();
    crs.forEach((cr) => {
      const g = commentGroups.find((x) => String(x._id) === String(cr.commentId));
      if (g && !g.parentPostId) {
        g.parentPostId = cr.postId;
        commentPostIds.push(cr.postId);
      }
    });
  }

  const AdminUser = require("../model/adminUserModel");

  const [posts, stories, accounts, commentPosts, reviewers] = await Promise.all([
    postIds.length
      ? Post.find({ _id: { $in: postIds } })
          .setOptions({ includeScheduled: true })
          .populate("user", USER_FIELDS)
          .select("caption text media postType isHidden isDeleted createdAt user")
          .lean()
      : [],
    storyIds.length
      ? Story.find({ _id: { $in: storyIds } })
          .populate("userId", USER_FIELDS)
          .lean()
      : [],
    accountIds.length
      ? User.find({ _id: { $in: accountIds } }).select(USER_FIELDS).lean()
      : [],
    commentPostIds.length
      ? Post.find({ _id: { $in: commentPostIds } })
          .setOptions({ includeScheduled: true })
          .select("comments caption")
          .lean()
      : [],
    reviewerIds.length
      ? AdminUser.find({ _id: { $in: reviewerIds } }).select("name role").lean()
      : [],
  ]);

  const byId = (arr) =>
    arr.reduce((m, x) => ({ ...m, [String(x._id)]: x }), {});
  const postMap = byId(posts);
  const storyMap = byId(stories);
  const accountMap = byId(accounts);
  const reviewerMap = byId(reviewers);

  // Reporters — fetch all unique reporters in one query
  const allReporterIds = [
    ...new Set(paged.flatMap((g) => g.reporters.map(String))),
  ];
  const reporters = allReporterIds.length
    ? await User.find({ _id: { $in: allReporterIds } }).select(USER_FIELDS).lean()
    : [];
  const reporterMap = byId(reporters);

  /* ── Shape each row for the frontend ── */
  const data = paged.map((g) => {
    const row = {
      groupId: String(g._id),
      kind: g.kind,
      reportCount: g.reportCount,
      reportIds: g.reportIds,
      // Unique reasons with how many times each was given
      reasons: Object.entries(
        g.reasons.reduce((m, r) => ({ ...m, [r]: (m[r] || 0) + 1 }), {}),
      ).map(([reason, count]) => ({ reason, count })),
      reporters: [...new Set(g.reporters.map(String))]
        .map((id) => reporterMap[id])
        .filter(Boolean),
      firstReportedAt: g.firstAt,
      lastReportedAt: g.latestAt,
      status: g.latestStatus,
      allStatuses: g.statuses,
      reviewedBy: g.reviewedBy ? reviewerMap[String(g.reviewedBy)] : null,
      reviewedAt: g.reviewedAt || null,
      actionTaken: g.actionTaken || "none",
      adminNote: g.adminNote || "",
      target: null,
    };

    if (g.kind === KIND.POST) {
      const p = postMap[String(g._id)];
      row.target = p
        ? {
            _id: p._id,
            caption: p.caption || p.text || "",
            media: p.media || [],
            postType: p.postType,
            isHidden: p.isHidden,
            isDeleted: p.isDeleted,
            createdAt: p.createdAt,
            owner: p.user || null,
          }
        : { missing: true };
    }

    if (g.kind === KIND.STORY) {
      const s = storyMap[String(g._id)];
      row.target = s
        ? {
            _id: s._id,
            slideCount: (s.media || []).filter((m) => !m.isDeleted).length,
            media: (s.media || []).slice(0, 3),
            isDeleted: s.isDeleted,
            createdAt: s.createdAt,
            owner: s.userId || null,
          }
        : { missing: true };
    }

    if (g.kind === KIND.ACCOUNT) {
      const u = accountMap[String(g._id)];
      row.target = u ? { ...u, owner: u } : { missing: true };
    }

    if (g.kind === KIND.COMMENT) {
      const parent = commentPosts.find(
        (p) => String(p._id) === String(g.parentPostId),
      );
      const comment = parent?.comments?.find(
        (c) => String(c._id) === String(g._id),
      );
      row.target = {
        _id: g._id,
        postId: g.parentPostId || null,
        text: comment?.text || "",
        isHidden: comment?.isHidden,
        missing: !comment,
        owner: comment?.user
          ? reporterMap[String(comment.user)] || { _id: comment.user }
          : null,
      };
    }

    return row;
  });

  return successResponse(
    res,
    { reports: data, total, page, pages: Math.ceil(total / limit) },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════════════
   POST /api/admin-panel/reports/action

   Body: { kind, groupId, action, note }
   action: ignore | warn | remove_content | hide_content | suspend_user

   Acts on the WHOLE GROUP — all reports for that target get
   the same resolution in one shot.
   ═══════════════════════════════════════════════════════════ */
const takeAction = asyncHandler(async (req, res) => {
  const { kind, groupId, action, note = "" } = req.body;

  const VALID_KINDS = Object.values(KIND);
  const VALID_ACTIONS = [
    "ignore",
    "warn",
    "remove_content",
    "hide_content",
    "suspend_user",
  ];

  if (!VALID_KINDS.includes(kind))
    return errorResponse(res, "Invalid report type", 400);
  if (!VALID_ACTIONS.includes(action))
    return errorResponse(res, "Invalid action", 400);
  if (!groupId) return errorResponse(res, "Missing target id", 400);

  const Model = modelFor(kind);

  // Which field identifies the group in this model
  const groupField =
    kind === KIND.POST
      ? "postId"
      : kind === KIND.ACCOUNT
      ? "reportedUser"
      : kind === KIND.STORY
      ? "storyId"
      : "commentId";

  const filter = { [groupField]: groupId };
  if (kind === KIND.POST) filter.reportType = "A specific post";
  if (kind === KIND.ACCOUNT) filter.reportType = "Something about this account";

  const reportCount = await Model.countDocuments(filter);
  if (!reportCount) return errorResponse(res, "No reports found for this item", 404);

  /* ── Perform the actual moderation ── */
  let actionTaken = "ignored";
  let newStatus = "Rejected"; // "ignore" means the reports were not valid
  let sideEffect = "";

  if (action === "ignore") {
    actionTaken = "ignored";
    newStatus = "Rejected";
    sideEffect = "No change to the content";
  }

  if (action === "warn") {
    actionTaken = "warned";
    newStatus = "Resolved";
    sideEffect = "Content left up, owner warned";
    // TODO: send a notification to the content owner
  }

  if (action === "hide_content") {
    actionTaken = "content_hidden";
    newStatus = "Resolved";

    if (kind === KIND.POST) {
      const post = await Post.findById(groupId).setOptions({
        includeScheduled: true,
      });
      if (!post) return errorResponse(res, "Post not found", 404);
      post.isHidden = true;
      post.hiddenBy = req.admin._id;
      post.hiddenAt = new Date();
      post.hideReason = note || "Hidden after user reports";
      await post.save();
      sideEffect = "Post hidden";
    } else if (kind === KIND.COMMENT) {
      const cr = await CommentReport.findOne({ commentId: groupId }).lean();
      const post = await Post.findById(cr?.postId).setOptions({
        includeScheduled: true,
      });
      const comment = post?.comments?.id(groupId);
      if (!comment) return errorResponse(res, "Comment not found", 404);
      comment.isHidden = true;
      await post.save();
      sideEffect = "Comment hidden";
    } else {
      return errorResponse(res, "Hiding is not supported for this type", 400);
    }
  }

  if (action === "remove_content") {
    actionTaken = "content_removed";
    newStatus = "Resolved";

    if (kind === KIND.POST) {
      const post = await Post.findById(groupId).setOptions({
        includeScheduled: true,
      });
      if (!post) return errorResponse(res, "Post not found", 404);
      post.isDeleted = true;
      post.isHidden = true;
      post.deletedBy = req.admin._id;
      post.deletedAt = new Date();
      post.deleteReason = note || "Removed after user reports";
      await post.save();
      sideEffect = "Post removed";
    } else if (kind === KIND.STORY) {
      const story = await Story.findById(groupId);
      if (!story) return errorResponse(res, "Story not found", 404);
      story.isDeleted = true;
      story.deletedBy = req.admin._id;
      story.deletedAt = new Date();
      story.deleteReason = note || "Removed after user reports";
      await story.save();
      sideEffect = "Story removed";
    } else if (kind === KIND.COMMENT) {
      const cr = await CommentReport.findOne({ commentId: groupId }).lean();
      const post = await Post.findById(cr?.postId).setOptions({
        includeScheduled: true,
      });
      const comment = post?.comments?.id(groupId);
      if (!comment) return errorResponse(res, "Comment not found", 404);
      comment.deleteOne();
      await post.save();
      sideEffect = "Comment removed";
    } else {
      return errorResponse(
        res,
        "Use 'suspend user' for account reports, not 'remove content'",
        400,
      );
    }
  }

  if (action === "suspend_user") {
    actionTaken = "user_suspended";
    newStatus = "Resolved";

    // Work out whose account to suspend
    let ownerId = null;
    if (kind === KIND.ACCOUNT) {
      ownerId = groupId;
    } else if (kind === KIND.POST) {
      const p = await Post.findById(groupId)
        .setOptions({ includeScheduled: true })
        .select("user")
        .lean();
      ownerId = p?.user;
    } else if (kind === KIND.STORY) {
      const s = await Story.findById(groupId).select("userId").lean();
      ownerId = s?.userId;
    }

    if (!ownerId) return errorResponse(res, "Could not identify the user", 404);

    const user = await User.findById(ownerId);
    if (!user) return errorResponse(res, "User not found", 404);

    user.accountStatus = "deactivated";
    await user.save({ validateBeforeSave: false });
    sideEffect = "User account deactivated";

    await logAction(req, {
      action: "user.suspend",
      targetType: "User",
      targetId: user._id,
      description: `Suspended a user account after reports${note ? ` — ${note}` : ""}`,
      meta: { note, viaReport: kind },
    });
  }

  /* ── Mark every report in the group as handled ── */
  await Model.updateMany(filter, {
    $set: {
      status: newStatus,
      reviewedBy: req.admin._id,
      reviewedAt: new Date(),
      actionTaken,
      adminNote: note,
    },
  });

  await logAction(req, {
    action: "report.action",
    targetType: kind === KIND.ACCOUNT ? "User" : kind === KIND.STORY ? "Story" : "Post",
    targetId: mongoose.Types.ObjectId.isValid(groupId) ? groupId : null,
    description: `Resolved ${reportCount} ${kind} report(s) — action: ${action}. ${sideEffect}`,
    meta: { kind, action, note, reportCount },
  });

  return successResponse(
    res,
    { resolved: reportCount, actionTaken, status: newStatus },
    `${reportCount} report${reportCount > 1 ? "s" : ""} resolved. ${sideEffect}.`,
  );
});

/* ═══════════════════════════════════════════════════════════
   PATCH /api/admin-panel/reports/assign
   Body: { kind, groupId, adminId }
   ═══════════════════════════════════════════════════════════ */
const assignReport = asyncHandler(async (req, res) => {
  const { kind, groupId, adminId } = req.body;

  if (!Object.values(KIND).includes(kind))
    return errorResponse(res, "Invalid report type", 400);

  const AdminUser = require("../model/adminUserModel");
  if (adminId) {
    const target = await AdminUser.findById(adminId);
    if (!target) return errorResponse(res, "Admin member not found", 404);
  }

  const Model = modelFor(kind);
  const groupField =
    kind === KIND.POST
      ? "postId"
      : kind === KIND.ACCOUNT
      ? "reportedUser"
      : kind === KIND.STORY
      ? "storyId"
      : "commentId";

  const filter = { [groupField]: groupId, status: "Pending" };
  if (kind === KIND.POST) filter.reportType = "A specific post";
  if (kind === KIND.ACCOUNT) filter.reportType = "Something about this account";

  const r = await Model.updateMany(filter, {
    $set: { assignedTo: adminId || null },
  });

  await logAction(req, {
    action: "report.assign",
    targetType: "Report",
    targetId: mongoose.Types.ObjectId.isValid(groupId) ? groupId : null,
    description: adminId
      ? `Assigned ${r.modifiedCount} report(s) to an admin member`
      : `Unassigned ${r.modifiedCount} report(s)`,
    meta: { kind, adminId },
  });

  return successResponse(res, { updated: r.modifiedCount }, "Assignment updated");
});

module.exports = {
  getReportStats,
  listReports,
  takeAction,
  assignReport,
};