// ✅ NEW (Share module): Public share page + link preview (OG meta) APIs
// postController.js ko touch nahi kiya — share ka saara logic yahan hai.
//
// APIs:
//   GET /api/share/post/:postId  → shared post page (guest = preview, logged in = full)
//   GET /api/share/meta/:postId  → WhatsApp/Facebook link preview ke liye title/description/image
//
// Share count ke liye existing API hi use hoti hai: POST /api/posts/:postId/share

const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const Post = require("../../model/SocialMediaModels/postModel");

const WEB_APP_URL = (process.env.WEB_APP_URL || "https://jaintva.com").replace(
  /\/+$/,
  "",
);
const DEFAULT_SHARE_IMAGE =
  process.env.SHARE_DEFAULT_IMAGE || `${WEB_APP_URL}/og-default.png`;

// Guest (bina login) ko kitne comments dikhane hain
const GUEST_COMMENT_LIMIT = 3;

// isPrivate: agar userModel me private account ka field hai to use hoga,
// nahi hai to undefined rahega aur koi asar nahi padega.
const USER_FIELDS =
  "firstName lastName fullName profilePicture accountType accountStatus businessName sadhuName tirthName isPrivate";
const COMMENT_USER_FIELDS =
  "firstName lastName fullName profilePicture accountType businessName sadhuName tirthName";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const getDisplayName = (u) => {
  if (!u) return "User";
  if (u.accountType === "business")
    return u.businessName || u.fullName || "User";
  if (u.accountType === "sadhu") return u.sadhuName || u.fullName || "User";
  if (u.accountType === "tirth") return u.tirthName || u.fullName || "User";
  return u.fullName || "User";
};

const isReel = (post) => post?.media?.[0]?.type === "video";

// Web + app pehle se /post/:id use karte hain (PostDetails route, "App me Kholo" intent link)
const buildShareUrl = (post) => `${WEB_APP_URL}/post/${post._id}`;

// Sangh / Panch post ho to Sangh ka naam-photo, warna user ka
const buildAuthor = (post) => {
  const isSanghPost = post.type === "sangh" || post.type === "panch";
  const sangh = post.sanghId?.name
    ? post.sanghId
    : post.panchId?.name
      ? post.panchId
      : null;

  if (isSanghPost && sangh) {
    return {
      _id: sangh._id,
      name: sangh.name,
      profilePicture: sangh.sanghImage || null,
      accountType: post.type,
      isSangh: true,
    };
  }

  return {
    _id: post.user?._id,
    name: getDisplayName(post.user),
    profilePicture: post.user?.profilePicture || null,
    accountType: post.user?.accountType || "user",
    isSangh: false,
  };
};

// Poll: sirf counts bhejo, kisne vote kiya (user IDs) public nahi
const buildPoll = (post) => {
  if (post.postType !== "poll") return null;

  const votes = post.pollVotes || {};
  const counts = (post.pollOptions || []).map((_, i) => {
    const arr = votes[i] ?? votes[String(i)];
    return Array.isArray(arr) ? arr.length : 0;
  });
  const totalVotes = counts.reduce((sum, n) => sum + n, 0);

  return {
    question: post.pollQuestion || "",
    duration: post.pollDuration || null,
    totalVotes,
    options: (post.pollOptions || []).map((option, i) => ({
      option,
      votes: counts[i],
      percentage:
        totalVotes > 0 ? Math.round((counts[i] / totalVotes) * 100) : 0,
    })),
  };
};

const cleanText = (str = "", max = 160) => {
  const s = String(str).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// Post load + visibility checks
// status: "ok" | "private" | "not_found"
const loadShareablePost = async (postId, { withComments = false } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(postId)) return { status: "not_found" };

  let query = Post.findById(postId)
    .populate("user", USER_FIELDS)
    .populate("sanghId", "name sanghImage")
    .populate("panchId", "name sanghImage");

  if (withComments) {
    query = query.populate("comments.user", COMMENT_USER_FIELDS);
  } else {
    query = query.select("-comments -likes -votedUsers");
  }

  // Note: scheduled (future) posts postModel ke pre-find hook se already hide ho jaati hain
  const post = await query.lean();

  if (!post || !post.user) return { status: "not_found" };
  if (post.isHidden === true) return { status: "not_found" };
  if (post.user.accountStatus === "deactivated") return { status: "not_found" };
  if (post.user.isPrivate === true) return { status: "private", post };

  return { status: "ok", post };
};

// ─────────────────────────────────────────────
// GET /api/share/post/:postId   (optionalAuth)
// ─────────────────────────────────────────────
const getPublicPost = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const viewer = req.viewer || null;
  const isLoggedIn = !!viewer;

  const { status, post } = await loadShareablePost(postId, {
    withComments: true,
  });

  if (status === "not_found") {
    return res.status(404).json({
      success: false,
      status: "not_found",
      message: "Post not found or no longer available",
    });
  }

  if (status === "private") {
    const author = buildAuthor(post);
    return res.status(200).json({
      success: true,
      data: {
        status: "private",
        shareUrl: buildShareUrl(post),
        viewer: { isLoggedIn },
        author: { name: author.name, profilePicture: author.profilePicture },
      },
    });
  }

  // Visible comments only (admin ne hide/delete kiye wale nahi)
  const visibleComments = (post.comments || [])
    .filter((c) => !c.isHidden && !c.isDeleted)
    .sort((a, b) => {
      if (!!b.isPinned !== !!a.isPinned) return b.isPinned ? 1 : -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

  const commentsToSend = isLoggedIn
    ? visibleComments
    : visibleComments.slice(0, GUEST_COMMENT_LIMIT);

  const viewerId = viewer?._id?.toString();

  const isLiked = viewerId
    ? (post.likes || []).some((id) => id.toString() === viewerId)
    : false;

  const isSaved = viewerId
    ? (viewer.activity?.saved || []).some(
        (s) => s.postId?.toString() === postId.toString(),
      )
    : false;

  return res.status(200).json({
    success: true,
    data: {
      status: "ok",
      access: isLoggedIn ? "full" : "preview",
      shareUrl: buildShareUrl(post),
      viewer: { isLoggedIn, isLiked, isSaved },
      post: {
        _id: post._id,
        contentType: isReel(post) ? "reel" : "post",
        postType: post.postType,
        type: post.type || null,
        caption: post.caption || "",
        media: (post.media || []).map((m) => ({
          url: m.url,
          type: m.type,
          thumbnail: m.thumbnail || null,
        })),
        hashtags: post.hashtags || [],
        postLocation: post.postLocation?.name ? post.postLocation : null,
        poll: buildPoll(post),
        author: buildAuthor(post),
        likeCount: (post.likes || []).length,
        commentCount: visibleComments.length,
        shareCount: post.shareCount || 0,
        createdAt: post.createdAt,
        comments: commentsToSend.map((c) => ({
          _id: c._id,
          text: c.text,
          createdAt: c.createdAt,
          isPinned: !!c.isPinned,
          likeCount: (c.likes || []).length,
          replyCount: (c.replies || []).length,
          user: {
            _id: c.user?._id || null,
            name: getDisplayName(c.user),
            profilePicture: c.user?.profilePicture || null,
          },
        })),
        hasMoreComments: commentsToSend.length < visibleComments.length,
      },
    },
  });
});

// ─────────────────────────────────────────────
// GET /api/share/meta/:postId   (public, lightweight)
// Netlify Edge Function isko call karke OG tags banata hai
// ─────────────────────────────────────────────
const getShareMeta = asyncHandler(async (req, res) => {
  const { status, post } = await loadShareablePost(req.params.postId);

  // 5 min CDN/edge cache — har WhatsApp preview pe DB hit na ho
  res.set("Cache-Control", "public, max-age=300");

  if (status !== "ok") {
    return res.status(200).json({
      success: true,
      data: {
        restricted: true,
        title: "Jaintva",
        description: "Jaintva — the social platform for the Jain community.",
        image: DEFAULT_SHARE_IMAGE,
        url: WEB_APP_URL,
        type: "website",
        video: null,
      },
    });
  }

  const author = buildAuthor(post);
  const reel = isReel(post);
  const firstImage = (post.media || []).find((m) => m.type === "image")?.url;
  const videoThumb = (post.media || []).find(
    (m) => m.type === "video" && m.thumbnail,
  )?.thumbnail;

  let description = "";
  if (post.postType === "poll" && post.pollQuestion) {
    description = `📊 ${cleanText(post.pollQuestion, 150)}`;
  } else if (post.caption) {
    description = cleanText(post.caption, 160);
  } else {
    description = "See this post on Jaintva.";
  }

  return res.status(200).json({
    success: true,
    data: {
      restricted: false,
      title: reel
        ? `Reel by ${author.name} • Jaintva`
        : `${author.name} on Jaintva`,
      description,
      image:
        (reel ? videoThumb || firstImage : firstImage || videoThumb) ||
        author.profilePicture ||
        DEFAULT_SHARE_IMAGE,
      url: buildShareUrl(post),
      type: reel ? "video.other" : "article",
      video: reel ? post.media[0].url : null,
    },
  });
});

module.exports = {
  getPublicPost,
  getShareMeta,
};
