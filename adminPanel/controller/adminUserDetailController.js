const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const User = require("../../model/UserRegistrationModels/userModel");
const Post = require("../../model/SocialMediaModels/postModel");
const Story = require("../../model/SocialMediaModels/storyModel");
const Report = require("../../model/SocialMediaModels/Report");
const JainAadhar = require("../../model/UserRegistrationModels/jainAadharModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");

const DAY_MS = 24 * 60 * 60 * 1000;

/* Load the Block model only if it exists — the folder name has a space in it */
let Block = null;
try {
  Block = require("../../model/Block User/blockModel");
} catch (e) {
  // Not fatal: block counts simply won't show
}

/* ═══════════════════════════════════════════════════
   GET /api/admin-panel/users/:id
   Everything about one user, in a single call
   ═══════════════════════════════════════════════════ */
const getUserDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return errorResponse(res, "Invalid user id", 400);

  const user = await User.findById(id).select("-password -__v").lean();
  if (!user) return errorResponse(res, "User not found", 404);

  const since24h = new Date(Date.now() - DAY_MS);

  const [
    postCount,
    hiddenPostCount,
    deletedPostCount,
    activeStoryCount,
    reportsAgainst,
    pendingReportsAgainst,
    reportsFiledByThem,
    blockedByCount,
    aadharApplication,
  ] = await Promise.all([
    Post.countDocuments({ user: id, isDeleted: { $ne: true } }).setOptions({
      includeScheduled: true,
    }),
    Post.countDocuments({ user: id, isHidden: true, isDeleted: { $ne: true } }).setOptions({
      includeScheduled: true,
    }),
    Post.countDocuments({ user: id, isDeleted: true }).setOptions({
      includeScheduled: true,
    }),
    Story.countDocuments({
      userId: id,
      createdAt: { $gte: since24h },
      isDeleted: { $ne: true },
    }),
    // Reports naming this user directly, plus reports on their posts
    Report.countDocuments({ reportedUser: id }),
    Report.countDocuments({ reportedUser: id, status: "Pending" }),
    Report.countDocuments({ reportedBy: id }),
    Block ? Block.countDocuments({ blockedUser: id }) : Promise.resolve(0),
    JainAadhar.findOne({ userId: id })
      .select("status jainAadharNumber createdAt name")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  // How many reports sit on this user's posts (a different signal from
  // reports about the account itself)
  const theirPostIds = await Post.find({ user: id })
    .setOptions({ includeScheduled: true })
    .select("_id")
    .lean();

  const reportsOnTheirPosts = theirPostIds.length
    ? await Report.countDocuments({
        postId: { $in: theirPostIds.map((p) => p._id) },
      })
    : 0;

  // Recent posts for a quick look
  const recentPosts = await Post.find({ user: id })
    .setOptions({ includeScheduled: true })
    .select("caption text media postType isHidden isDeleted createdAt likes comments")
    .sort({ createdAt: -1 })
    .limit(6)
    .lean();

  const posts = recentPosts.map((p) => ({
    _id: p._id,
    caption: p.caption || p.text || "",
    media: p.media || [],
    postType: p.postType,
    isHidden: p.isHidden,
    isDeleted: p.isDeleted,
    createdAt: p.createdAt,
    likeCount: p.likes?.length || 0,
    commentCount: p.comments?.length || 0,
  }));

  // The actual reports filed against this account
  const accountReports = await Report.find({ reportedUser: id })
    .populate(
      "reportedBy",
      "firstName lastName fullName businessName tirthName sadhuName accountType profilePicture",
    )
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  return successResponse(
    res,
    {
      user,
      stats: {
        posts: postCount,
        hiddenPosts: hiddenPostCount,
        deletedPosts: deletedPostCount,
        activeStories: activeStoryCount,
        reportsAgainst,
        pendingReportsAgainst,
        reportsOnTheirPosts,
        reportsFiledByThem,
        blockedBy: blockedByCount,
        followers: user.followers?.length || 0,
        following: user.following?.length || 0,
      },
      aadharApplication,
      recentPosts: posts,
      accountReports,
    },
    "OK",
  );
});

/* ═══════════════════════════════════════════════════
   PATCH /api/admin-panel/users/:id/remove-media
   Body: { field: "profilePicture" | "coverPicture" | "bio", reason }

   Admins can REMOVE offending content, never replace it.
   The user then puts up something appropriate themselves.
   ═══════════════════════════════════════════════════ */
const removeUserMedia = asyncHandler(async (req, res) => {
  const { field, reason = "" } = req.body;

  const ALLOWED = {
    profilePicture: "profile photo",
    coverPicture: "cover photo",
    bio: "bio",
  };

  if (!ALLOWED[field])
    return errorResponse(res, "That field cannot be removed", 400);

  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, "User not found", 404);

  const previous = user[field];
  if (!previous)
    return errorResponse(res, `This user has no ${ALLOWED[field]} set`, 400);

  user[field] = "";
  await user.save({ validateBeforeSave: false });

  await logAction(req, {
    action: "user.remove_media",
    targetType: "User",
    targetId: user._id,
    description: `Removed the ${ALLOWED[field]} of a user${reason ? ` — ${reason}` : ""}`,
    meta: { field, reason, previous: String(previous).slice(0, 200) },
  });

  // TODO: notify the user so they know what was removed and why

  return successResponse(res, null, `${ALLOWED[field]} removed`);
});

/* ═══════════════════════════════════════════════════
   PATCH /api/admin-panel/users/:id/suspend
   Body: { action: "suspend" | "reactivate", reason }
   ═══════════════════════════════════════════════════ */
const toggleSuspend = asyncHandler(async (req, res) => {
  const { action, reason = "" } = req.body;

  if (!["suspend", "reactivate"].includes(action))
    return errorResponse(res, "Action must be 'suspend' or 'reactivate'", 400);
  if (action === "suspend" && !reason.trim())
    return errorResponse(res, "Please give a reason for suspending", 400);

  const user = await User.findById(req.params.id);
  if (!user) return errorResponse(res, "User not found", 404);

  if (action === "suspend" && user.accountStatus === "deactivated")
    return errorResponse(res, "This account is already suspended", 400);
  if (action === "reactivate" && user.accountStatus === "active")
    return errorResponse(res, "This account is already active", 400);

  user.accountStatus = action === "suspend" ? "deactivated" : "active";
  await user.save({ validateBeforeSave: false });

  await logAction(req, {
    action: action === "suspend" ? "user.suspend" : "user.reactivate",
    targetType: "User",
    targetId: user._id,
    description: `${action === "suspend" ? "Suspended" : "Reactivated"} a user account${
      reason ? ` — ${reason}` : ""
    }`,
    meta: { reason },
  });

  return successResponse(
    res,
    { accountStatus: user.accountStatus },
    action === "suspend" ? "Account suspended" : "Account reactivated",
  );
});

module.exports = { getUserDetail, removeUserMedia, toggleSuspend };