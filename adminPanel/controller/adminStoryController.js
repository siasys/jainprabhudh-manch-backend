const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Story = require("../../model/SocialMediaModels/storyModel");
const StoryReport = require("../../model/SocialMediaModels/StoryReport");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");

const USER_FIELDS =
  "firstName lastName fullName businessName tirthName sadhuName accountType profilePicture jainAadharStatus location city state";

const DAY_MS = 24 * 60 * 60 * 1000;

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/stories/stats
   ═══════════════════════════════════════════════════ */
const getStoryStats = asyncHandler(async (req, res) => {
  const since24h = new Date(Date.now() - DAY_MS);

  const [active, expired, deleted, pendingReports] = await Promise.all([
    Story.countDocuments({
      createdAt: { $gte: since24h },
      isDeleted: { $ne: true },
    }),
    Story.countDocuments({
      createdAt: { $lt: since24h },
      isDeleted: { $ne: true },
    }),
    Story.countDocuments({ isDeleted: true }),
    StoryReport.countDocuments({ status: "Pending" }),
  ]);

  // Total slides currently live
  const slideAgg = await Story.aggregate([
    { $match: { createdAt: { $gte: since24h }, isDeleted: { $ne: true } } },
    { $unwind: "$media" },
    { $match: { "media.isDeleted": { $ne: true } } },
    { $count: "n" },
  ]);

  return successResponse(
    res,
    {
      active,
      expired,
      deleted,
      pendingReports,
      activeSlides: slideAgg[0]?.n || 0,
    },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/stories
   Query: page, limit, status (active|expired|deleted|all), userId
   ═══════════════════════════════════════════════════ */
const listStories = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const { status = "active", userId = "" } = req.query;

  const since24h = new Date(Date.now() - DAY_MS);
  const query = {};

  if (status === "active") {
    query.createdAt = { $gte: since24h };
    query.isDeleted = { $ne: true };
  } else if (status === "expired") {
    query.createdAt = { $lt: since24h };
    query.isDeleted = { $ne: true };
  } else if (status === "deleted") {
    query.isDeleted = true;
  } else {
    query.isDeleted = { $ne: true };
  }

  if (userId && mongoose.Types.ObjectId.isValid(userId)) query.userId = userId;

  const [stories, total] = await Promise.all([
    Story.find(query)
      .populate("userId", USER_FIELDS)
      .populate("deletedBy", "name role")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Story.countDocuments(query),
  ]);

  // Report counts per story, in one query
  const ids = stories.map((s) => s._id);
  const counts = await StoryReport.aggregate([
    { $match: { storyId: { $in: ids } } },
    {
      $group: {
        _id: "$storyId",
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
      },
    },
  ]);
  const countMap = {};
  counts.forEach((c) => {
    countMap[String(c._id)] = { total: c.total, pending: c.pending };
  });

  const data = stories.map((s) => {
    const slides = s.media || [];
    const liveSlides = slides.filter((m) => !m.isDeleted);

    return {
      _id: s._id,
      owner: s.userId || null,
      isSanghStory: s.isSanghStory,
      createdAt: s.createdAt,
      isDeleted: s.isDeleted,
      deletedBy: s.deletedBy,
      deletedAt: s.deletedAt,
      deleteReason: s.deleteReason,
      expiresAt: new Date(new Date(s.createdAt).getTime() + DAY_MS),
      isExpired: new Date(s.createdAt) < since24h,
      slideCount: liveSlides.length,
      removedSlideCount: slides.length - liveSlides.length,
      // Light slide info for the list — full detail comes from the detail route
      slides: liveSlides.slice(0, 5).map((m) => ({
        _id: m._id,
        type: m.type,
        url: m.url,
        text: m.text,
        viewCount: m.views?.length || 0,
        likeCount: m.likes?.length || 0,
        commentCount: m.comments?.length || 0,
      })),
      totalViews: liveSlides.reduce((n, m) => n + (m.views?.length || 0), 0),
      totalLikes: liveSlides.reduce((n, m) => n + (m.likes?.length || 0), 0),
      reportCount: countMap[String(s._id)]?.total || 0,
      pendingReportCount: countMap[String(s._id)]?.pending || 0,
    };
  });

  return successResponse(
    res,
    { stories: data, total, page, pages: Math.ceil(total / limit) },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/stories/:id
   ═══════════════════════════════════════════════════ */
const getStoryDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return errorResponse(res, "Invalid story id", 400);

  const story = await Story.findById(id)
    .populate("userId", USER_FIELDS)
    .populate("deletedBy", "name role")
    .populate("media.views.userId", USER_FIELDS)
    .populate("media.likes.userId", USER_FIELDS)
    .populate("media.comments.userId", USER_FIELDS)
    .populate("media.mentionUsers", USER_FIELDS)
    .populate("media.deletedBy", "name role")
    .lean();

  if (!story) return errorResponse(res, "Story not found", 404);

  const reports = await StoryReport.find({ storyId: id })
    .populate("reportedBy", USER_FIELDS)
    .populate("reviewedBy", "name role")
    .sort({ createdAt: -1 })
    .lean();

  const createdMs = new Date(story.createdAt).getTime();

  return successResponse(
    res,
    {
      story: {
        ...story,
        expiresAt: new Date(createdMs + DAY_MS),
        isExpired: Date.now() - createdMs > DAY_MS,
      },
      reports,
    },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════
   DELETE /api/admin-panel/stories/:id
   Soft-deletes the WHOLE story (all slides)
   ═══════════════════════════════════════════════════ */
const deleteStory = asyncHandler(async (req, res) => {
  const { reason = "" } = req.body;

  const story = await Story.findById(req.params.id);
  if (!story) return errorResponse(res, "Story not found", 404);
  if (story.isDeleted) return errorResponse(res, "This story is already deleted", 400);

  story.isDeleted = true;
  story.deletedBy = req.admin._id;
  story.deletedAt = new Date();
  story.deleteReason = reason;
  await story.save();

  await logAction(req, {
    action: "story.delete",
    targetType: "Story",
    targetId: story._id,
    description: `Deleted an entire story (${story.media?.length || 0} slides)${
      reason ? ` — ${reason}` : ""
    }`,
    meta: { reason },
  });

  return successResponse(res, null, "Story deleted");
});

/* ═══════════════════════════════════════════════════
   DELETE /api/admin-panel/stories/:id/slides/:slideId
   Removes ONE slide, leaving the rest of the story intact
   ═══════════════════════════════════════════════════ */
const deleteSlide = asyncHandler(async (req, res) => {
  const { reason = "" } = req.body;
  const { id, slideId } = req.params;

  const story = await Story.findById(id);
  if (!story) return errorResponse(res, "Story not found", 404);

  const slide = story.media.id(slideId);
  if (!slide) return errorResponse(res, "Slide not found", 404);
  if (slide.isDeleted) return errorResponse(res, "This slide is already removed", 400);

  slide.isDeleted = true;
  slide.deletedBy = req.admin._id;
  slide.deletedAt = new Date();
  slide.deleteReason = reason;

  // If every slide is gone, mark the whole story deleted too
  const anyLeft = story.media.some((m) => !m.isDeleted);
  if (!anyLeft) {
    story.isDeleted = true;
    story.deletedBy = req.admin._id;
    story.deletedAt = new Date();
    story.deleteReason = reason || "All slides removed";
  }

  await story.save();

  await logAction(req, {
    action: "story.slide_delete",
    targetType: "Story",
    targetId: story._id,
    description: `Removed one slide from a story${reason ? ` — ${reason}` : ""}${
      !anyLeft ? " (story is now empty and marked deleted)" : ""
    }`,
    meta: { slideId, reason },
  });

  return successResponse(
    res,
    { storyDeleted: !anyLeft },
    anyLeft ? "Slide removed" : "Last slide removed — story is now deleted",
  );
});

/* ═══════════════════════════════════════════════════
   PATCH /api/admin-panel/stories/:id/restore
   ═══════════════════════════════════════════════════ */
const restoreStory = asyncHandler(async (req, res) => {
  const story = await Story.findById(req.params.id);
  if (!story) return errorResponse(res, "Story not found", 404);
  if (!story.isDeleted) return errorResponse(res, "This story is not deleted", 400);

  story.isDeleted = false;
  story.deletedBy = null;
  story.deletedAt = null;
  story.deleteReason = "";
  await story.save();

  await logAction(req, {
    action: "story.restore",
    targetType: "Story",
    targetId: story._id,
    description: "Restored a deleted story",
  });

  return successResponse(res, null, "Story restored");
});

/* ═══════════════════════════════════════════════════
   DELETE /api/admin-panel/stories/:id/slides/:slideId/comments/:commentId
   ═══════════════════════════════════════════════════ */
const deleteStoryComment = asyncHandler(async (req, res) => {
  const { id, slideId, commentId } = req.params;

  const story = await Story.findById(id);
  if (!story) return errorResponse(res, "Story not found", 404);

  const slide = story.media.id(slideId);
  if (!slide) return errorResponse(res, "Slide not found", 404);

  const comment = slide.comments.id(commentId);
  if (!comment) return errorResponse(res, "Comment not found", 404);

  const text = comment.text?.slice(0, 80);
  comment.deleteOne();
  await story.save();

  await logAction(req, {
    action: "comment.delete",
    targetType: "Story",
    targetId: story._id,
    description: `Deleted a story comment: "${text}"`,
    meta: { slideId, commentId },
  });

  return successResponse(res, null, "Comment deleted");
});

module.exports = {
  getStoryStats,
  listStories,
  getStoryDetail,
  deleteStory,
  deleteSlide,
  restoreStory,
  deleteStoryComment,
};