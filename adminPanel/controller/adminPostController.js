const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Post = require("../../model/SocialMediaModels/postModel");
const Report = require("../../model/SocialMediaModels/Report");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");

/**
 * Fields needed to build a user's display name and location.
 * The frontend uses the same logic — keep both in sync.
 */
const USER_FIELDS =
  "firstName lastName fullName businessName tirthName sadhuName accountType profilePicture jainAadharStatus location city state";

/* ───────────── GET /api/admin-panel/posts ─────────────
   Query: page, limit, search, status, postType, userId, sortBy */
const listPosts = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const { search = "", status = "", postType = "", userId = "", sortBy = "recent" } =
    req.query;

  const query = {};

  // Status filter
  if (status === "hidden") {
    query.isHidden = true;
    query.isDeleted = { $ne: true };
  } else if (status === "deleted") {
    query.isDeleted = true;
  } else if (status === "pinned") {
    query.isPinned = true;
    query.isDeleted = { $ne: true };
  } else if (status === "visible") {
    query.isHidden = { $ne: true };
    query.isDeleted = { $ne: true };
  } else {
    // Default — everything except deleted posts
    query.isDeleted = { $ne: true };
  }

  if (postType) query.postType = postType;
  if (userId && mongoose.Types.ObjectId.isValid(userId)) query.user = userId;

  if (search.trim()) {
    const rx = new RegExp(search.trim(), "i");
    query.$or = [{ caption: rx }, { text: rx }, { hashtags: rx }];
  }

  let sort = { createdAt: -1 };
  if (sortBy === "oldest") sort = { createdAt: 1 };

  const [posts, total] = await Promise.all([
    Post.find(query)
      .setOptions({ includeScheduled: true }) // admins should see scheduled posts too
      .populate("user", USER_FIELDS)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Post.countDocuments(query).setOptions({ includeScheduled: true }),
  ]);

  // Report counts for all posts on this page — a single query
  const postIds = posts.map((p) => p._id);
  const reportCounts = await Report.aggregate([
    { $match: { postId: { $in: postIds } } },
    {
      $group: {
        _id: "$postId",
        total: { $sum: 1 },
        pending: {
          $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] },
        },
      },
    },
  ]);

  const countMap = {};
  reportCounts.forEach((r) => {
    countMap[String(r._id)] = { total: r.total, pending: r.pending };
  });

  const data = posts.map((p) => ({
    ...p,
    likeCount: p.likes?.length || 0,
    commentCount: p.comments?.length || 0,
    likes: undefined, // the full arrays aren't needed in a list view
    comments: undefined,
    reportCount: countMap[String(p._id)]?.total || 0,
    pendingReportCount: countMap[String(p._id)]?.pending || 0,
  }));

  return successResponse(
    res,
    { posts: data, total, page, pages: Math.ceil(total / limit) },
    "OK",
  );
});

/* ───────────── GET /api/admin-panel/posts/stats ───────────── */
const getPostStats = asyncHandler(async (req, res) => {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [total, hidden, deleted, last24, reported] = await Promise.all([
    Post.countDocuments({ isDeleted: { $ne: true } }).setOptions({
      includeScheduled: true,
    }),
    Post.countDocuments({ isHidden: true, isDeleted: { $ne: true } }).setOptions({
      includeScheduled: true,
    }),
    Post.countDocuments({ isDeleted: true }).setOptions({ includeScheduled: true }),
    Post.countDocuments({
      createdAt: { $gte: last24h },
      isDeleted: { $ne: true },
    }).setOptions({ includeScheduled: true }),
    Report.countDocuments({ status: "Pending", postId: { $ne: null } }),
  ]);

  return successResponse(
    res,
    { total, hidden, deleted, last24Hours: last24, pendingReports: reported },
    "OK",
  );
});

/* ───────────── GET /api/admin-panel/posts/:id ─────────────
   Full post — comments, likes, and every report filed against it */
const getPostDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return errorResponse(res, "Invalid post id", 400);

  const post = await Post.findById(id)
    .setOptions({ includeScheduled: true })
    .populate("user", USER_FIELDS)
    .populate("likes", USER_FIELDS)
    .populate("comments.user", USER_FIELDS)
    .populate("comments.replies.user", USER_FIELDS)
    .populate("hiddenBy", "name role")
    .populate("deletedBy", "name role")
    .lean();

  if (!post) return errorResponse(res, "Post not found", 404);

  const reports = await Report.find({ postId: id })
    .populate("reportedBy", USER_FIELDS)
    .sort({ createdAt: -1 })
    .lean();

  return successResponse(res, { post, reports }, "OK");
});

/* ───────────── PATCH /api/admin-panel/posts/:id/hide ─────────────
   Toggle: unhide if already hidden, otherwise hide */
const toggleHide = asyncHandler(async (req, res) => {
  const { reason = "" } = req.body;

  const post = await Post.findById(req.params.id).setOptions({
    includeScheduled: true,
  });
  if (!post) return errorResponse(res, "Post not found", 404);
  if (post.isDeleted)
    return errorResponse(res, "A deleted post cannot be hidden or unhidden", 400);

  const nowHidden = !post.isHidden;

  post.isHidden = nowHidden;
  post.hiddenBy = nowHidden ? req.admin._id : null;
  post.hiddenAt = nowHidden ? new Date() : null;
  post.hideReason = nowHidden ? reason : "";
  await post.save();

  await logAction(req, {
    action: nowHidden ? "post.hide" : "post.unhide",
    targetType: "Post",
    targetId: post._id,
    description: nowHidden
      ? `Hid a post${reason ? ` — ${reason}` : ""}`
      : "Unhid a post",
    meta: { reason },
  });

  return successResponse(
    res,
    { isHidden: nowHidden },
    nowHidden ? "Post hidden" : "Post is visible again",
  );
});

/* ───────────── DELETE /api/admin-panel/posts/:id ─────────────
   Soft delete — stays in the database, shows under the "Deleted" filter */
const deletePost = asyncHandler(async (req, res) => {
  const { reason = "" } = req.body;

  const post = await Post.findById(req.params.id).setOptions({
    includeScheduled: true,
  });
  if (!post) return errorResponse(res, "Post not found", 404);
  if (post.isDeleted) return errorResponse(res, "This post is already deleted", 400);

  post.isDeleted = true;
  post.deletedBy = req.admin._id;
  post.deletedAt = new Date();
  post.deleteReason = reason;
  post.isHidden = true; // a deleted post should not surface anywhere
  await post.save();

  await logAction(req, {
    action: "post.delete",
    targetType: "Post",
    targetId: post._id,
    description: `Deleted a post${reason ? ` — ${reason}` : ""}`,
    meta: { reason, caption: post.caption?.slice(0, 100) },
  });

  return successResponse(res, null, "Post deleted");
});

/* ───────────── PATCH /api/admin-panel/posts/:id/restore ───────────── */
const restorePost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id).setOptions({
    includeScheduled: true,
  });
  if (!post) return errorResponse(res, "Post not found", 404);
  if (!post.isDeleted) return errorResponse(res, "This post is not deleted", 400);

  post.isDeleted = false;
  post.deletedBy = null;
  post.deletedAt = null;
  post.deleteReason = "";
  post.isHidden = false;
  post.hiddenBy = null;
  post.hiddenAt = null;
  post.hideReason = "";
  await post.save();

  await logAction(req, {
    action: "post.restore",
    targetType: "Post",
    targetId: post._id,
    description: "Restored a deleted post",
  });

  return successResponse(res, null, "Post restored");
});

/* ───────────── PATCH /api/admin-panel/posts/:id/pin ───────────── */
const togglePin = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id).setOptions({
    includeScheduled: true,
  });
  if (!post) return errorResponse(res, "Post not found", 404);
  if (post.isDeleted || post.isHidden)
    return errorResponse(res, "A hidden or deleted post cannot be pinned", 400);

  post.isPinned = !post.isPinned;
  await post.save();

  await logAction(req, {
    action: post.isPinned ? "post.pin" : "post.unpin",
    targetType: "Post",
    targetId: post._id,
    description: post.isPinned ? "Pinned a post" : "Unpinned a post",
  });

  return successResponse(
    res,
    { isPinned: post.isPinned },
    post.isPinned ? "Post pinned" : "Post unpinned",
  );
});

/* ───────────── DELETE /api/admin-panel/posts/:id/comments/:commentId ───────────── */
const deleteComment = asyncHandler(async (req, res) => {
  const { id, commentId } = req.params;

  const post = await Post.findById(id).setOptions({ includeScheduled: true });
  if (!post) return errorResponse(res, "Post not found", 404);

  const comment = post.comments.id(commentId);
  if (!comment) return errorResponse(res, "Comment not found", 404);

  const text = comment.text?.slice(0, 80);
  comment.deleteOne();
  await post.save();

  await logAction(req, {
    action: "comment.delete",
    targetType: "Post",
    targetId: post._id,
    description: `Deleted a comment: "${text}"`,
    meta: { commentId },
  });

  return successResponse(res, null, "Comment deleted");
});

module.exports = {
  listPosts,
  getPostStats,
  getPostDetail,
  toggleHide,
  deletePost,
  restorePost,
  togglePin,
  deleteComment,
};