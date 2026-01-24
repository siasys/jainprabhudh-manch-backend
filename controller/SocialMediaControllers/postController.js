const Post = require('../../model/SocialMediaModels/postModel');
const User = require('../../model/UserRegistrationModels/userModel');
const UserInterest = require('../../model/SocialMediaModels/UserInterest');
const asyncHandler = require('express-async-handler');
const upload = require('../../middlewares/upload');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const { body, validationResult, param, query } = require('express-validator');
const Notification = require('../../model/SocialMediaModels/notificationModel')
const { getIo } = require('../../websocket/socket');
const SanghPost = require('../../model/SanghModels/sanghPostModel');
const PanchPost = require('../../model/SanghModels/panchPostModel');
const VyaparPost = require('../../model/VyaparModels/vyaparPostModel');
const TirthPost = require('../../model/TirthModels/tirthPostModel');
const SadhuPost = require('../../model/SadhuModels/sadhuPostModel');
const { getOrSetCache, invalidateCache } = require('../../utils/cache');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const { extractS3KeyFromUrl } = require('../../utils/s3Utils');
const { s3Client, DeleteObjectCommand } = require('../../config/s3Config');
const redisClient = require('../../config/redisClient');
const Report = require('../../model/SocialMediaModels/Report');
const Hashtag = require('../../model/SocialMediaModels/Hashtag');
const Sangh = require('../../model/SanghModels/hierarchicalSanghModel');
const { containsBadWords } = require("../../utils/filterBadWords");
const CommentReport = require('../../model/SocialMediaModels/CommentReport');
const Block = require('../../model/Block User/Block');
const { moderateImage } = require('../../utils/moderation');
const BoostPlan = require('../../model/BoostPlan/BoostPlan')
const mongoose = require("mongoose");

const createPost = [
  upload.postMediaUpload,
  body('userId').notEmpty().isMongoId(),
  body('hashtags')
    .optional()
    .custom(value => {
      try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) throw new Error();
        return true;
      } catch {
        throw new Error('Hashtags must be a JSON array');
      }
    }),

  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { caption, userId, hashtags, type, refId, postType: reqPostType, pollQuestion, pollOptions, pollDuration } = req.body;

    const parsedHashtags = hashtags
      ? JSON.parse(hashtags).map(tag => tag.toLowerCase())
      : [];

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // ✅ POST LIMIT CHECK (ONLY business / sadhu / tirth)
    const restrictedAccounts = ['business', 'sadhu', 'tirth'];
      if (
        restrictedAccounts.includes(user.accountType) &&
        user.postCount >= 3 &&
        !user.isBoostActive &&
        type !== 'sangh' &&
        type !== 'panch'
      ) {
        return res.status(403).json({
          error: 'BOOST_REQUIRED',
          message:
            'You have reached your free post limit. Please boost to continue posting.'
        });
      }


    const media = [];

    // -----------------------------
    // IMAGE MODERATION + S3 UPLOAD
    // -----------------------------

if (req.files?.image) {
  for (const file of req.files.image) {
    // Convert directly to CDN URL
    const cdnUrl = convertS3UrlToCDN(file.location);

    // Push directly without moderation
    media.push({ url: cdnUrl, type: 'image' });
  }
}

    // -----------------------------
    // VIDEO MODERATION (optional same logic)
    // -----------------------------
if (req.files?.video) {
  for (const file of req.files.video) {
    const cdnUrl = convertS3UrlToCDN(file.location);

    console.log("Skipping VIDEO moderation for:", cdnUrl);

    // ✅ Directly accept video (no moderation call)
    media.push({ url: cdnUrl, type: 'video' });
  }
}



    // -----------------------------
    // TEXT CHECK USING BAD-WORD FILTER
    // -----------------------------
    const textInputs = [
      caption || "",
      pollQuestion || "",
      ...(Array.isArray(pollOptions) ? pollOptions : [])
    ];

    for (const text of textInputs) {
      if (text && containsBadWords(text)) {
        return res.status(400).json({
          error: "Your post contains inappropriate or harmful words."
        });
      }
    }

    // -----------------------------
    // POLL PARSING
    // -----------------------------
    let parsedPollOptionsArray = [];
    try {
      if (reqPostType === 'poll') {
        parsedPollOptionsArray = Array.isArray(pollOptions)
          ? pollOptions
          : JSON.parse(pollOptions);
        if (!pollQuestion || parsedPollOptionsArray.length < 2 || !pollDuration) {
          return res.status(400).json({
            error: 'Poll requires question, minimum 2 options, and duration'
          });
        }
      }
    } catch (err) {
      return res.status(400).json({ error: "pollOptions must be valid JSON array" });
    }

    // -----------------------------
    // Save Hashtags
    // -----------------------------
    for (const tag of parsedHashtags) {
      await Hashtag.findOneAndUpdate(
        { name: tag.toLowerCase() },
        { $inc: { count: 1 } },
        { upsert: true, new: true }
      );
    }

    let postType = reqPostType || (media.length > 0 ? 'media' : 'text');

    const postData = {
      user: userId,
      caption,
      media,
      postType,
      hashtags: parsedHashtags,
      type
    };

    if (postType === 'poll') {
      postData.pollQuestion = pollQuestion;
      postData.pollOptions = parsedPollOptionsArray;
      postData.pollDuration = pollDuration;
      postData.pollVotes = parsedPollOptionsArray.reduce((acc, _, i) => {
        acc[i] = [];
        return acc;
      }, {});
      postData.votedUsers = [];
    }

    // RefId mapping
    if (type === 'sangh') postData.sanghId = refId;
    else if (type === 'panch') postData.sanghId = refId;
    else if (type === 'sadhu') postData.sadhuId = refId;
    else if (type === 'vyapar') postData.vyaparId = refId;


// ASSIGN ACTIVE BOOST TO POST
let activeBoostId = null;
if (user.activeBoosts && user.activeBoosts.length > 0) {
  // Find first boost which is active AND not already used
  const unusedBoost = await BoostPlan.findOne({
  _id: { $in: user.activeBoosts },
  $or: [
    { post: { $exists: false } },
    { post: null }
  ]
});
  if (!unusedBoost) {
    return res.status(403).json({
      error: "BOOST_ALREADY_USED",
      message: "All your active boosts are already used for posts. Please purchase a new boost to continue posting."
    });
  }

  activeBoostId = unusedBoost._id;
  postData.activeBoost = activeBoostId;
  postData.isBoosted = true;
}

    const post = await Post.create(postData);

// -------------------------
// LINK POST TO BOOST PLAN
// -------------------------
if (activeBoostId) {
  await BoostPlan.findByIdAndUpdate(activeBoostId, { post: post._id });
}

    // increment postCount ONLY after successful post creation
      await User.findByIdAndUpdate(
        userId,
        { $inc: { postCount: 1 } }
      );

    if (!type) {
      user.posts.push(post._id);
      await user.save();
    } else if (type === 'sangh' || type === 'panch') {
      await Sangh.findByIdAndUpdate(refId, { $push: { posts: post._id } });
    }
    // -------------------------
    // OPTIONAL: REMOVE EXPIRED BOOSTS
    // -------------------------
    const now = new Date();
    user.activeBoosts = user.activeBoosts.filter(async (boostId) => {
      const boost = await BoostPlan.findById(boostId);
      return boost && boost.endDate > now;
    });
    if (user.activeBoosts.length === 0) user.isBoostActive = false;
    await user.save();

    await invalidateCache('combinedFeed:*');
    await invalidateCache('combinedFeed:firstPage:limit:10');

    res.status(201).json(post);
  })
];

const voteOnPoll = async (req, res) => {
  try {
    const { postId } = req.params;
    const { optionIndex, userId } = req.body;

    if (optionIndex === undefined || !userId) {
      return res.status(400).json({ message: "optionIndex and userId are required" });
    }

    // Find post as a Mongoose document (no lean)
    const post = await Post.findById(postId).populate("sanghId", "_id name");
    if (!post) return res.status(404).json({ message: "Post not found" });
    if (post.postType !== "poll") {
      return res.status(400).json({ message: "This post is not a poll" });
    }

    // Determine voterId (string)
    const voterId =
      post.type === "sangh" || post.type === "panch"
        ? post.sanghId?._id?.toString()
        : userId.toString();
    if (!voterId) return res.status(400).json({ message: "Voter ID not found" });

    // Ensure pollVotes map is initialized
    if (!post.pollVotes) post.pollVotes = new Map();
    post.pollOptions.forEach((_, idx) => {
      const key = idx.toString();
      if (!post.pollVotes.has(key)) post.pollVotes.set(key, []);
    });

    // Ensure votedUsers array exists and compare as strings
   if (!post.votedUsers) post.votedUsers = [];

// Convert to string for safe comparison
const voterIdStr = voterId.toString();
const votedUsersStr = post.votedUsers.map(id => id.toString());

// Only prevent double voting for the **same voter type**
const alreadyVoted =
  (post.type === "sangh" || post.type === "panch")
    ? votedUsersStr.includes(voterIdStr) // sangh already voted
    : votedUsersStr.includes(voterIdStr); // normal user already voted

if (alreadyVoted) {
  return res.status(400).json({ message: "You have already voted" });
}

// Add vote
post.pollVotes.get(optionIndex.toString()).push(voterIdStr);
post.votedUsers.push(voterIdStr);

    // Save updated post
    await post.save();

    // Recalculate poll results
    const totalVotes = Object.values(post.pollVotes).reduce(
      (sum, arr) => sum + arr.length,
      0
    );

    const pollResults = post.pollOptions.map((option, idx) => {
      const votes = post.pollVotes[idx.toString()]?.length || 0;
      return {
        option,
        votes,
        percentage: totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0,
      };
    });

    res.status(200).json({
      success: true,
      message: "Vote submitted successfully",
      pollResults,
      totalVotes,
    });

  } catch (err) {
    console.error("Vote Error:", err);
    res.status(500).json({ message: "Error submitting vote", error: err.message });
  }
};


const searchHashtags = async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.trim() === '') {
      return res.status(400).json({ message: 'Query parameter `q` is required' });
    }

    const hashtags = await Hashtag.find({
      name: { $regex: `^${query.toLowerCase()}`, $options: 'i' }
    })
    .sort({ count: -1 }) // most popular first
    .limit(10); // limit to top 10 suggestions

    res.json(hashtags);
  } catch (err) {
    console.error('Hashtag search error:', err);
    res.status(500).json({ message: 'Server error while searching hashtags' });
  }
};

const getPostsByUser = asyncHandler(async (req, res) => {
  // ✅ FIX 1: userId URL params se lena hai, not query
  const { userId } = req.params; // Changed from req.query
  
  // ✅ FIX 2: Skip aur limit query params se lenge
  const limit = parseInt(req.query.limit) || 10;
  const skip = parseInt(req.query.skip) || 0;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  // ✅ Validate ObjectId
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: "Invalid User ID format" });
  }

  try {
    // Total count for pagination
    const totalPosts = await Post.countDocuments({ user: userId });

    // Get complete posts with all populated data
    const posts = await Post.find({ user: userId })
      .populate("user", "fullName profilePicture accountType accountStatus sadhuName tirthName businessName")
      .populate("sanghId", "name sanghImage")
      .populate({
        path: "comments.user",
        select: "fullName profilePicture accountType accountStatus sadhuName tirthName businessName"
      })
      .populate({
        path: "comments.replies.user", 
        select: "fullName profilePicture accountType accountStatus sadhuName tirthName businessName"
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(); // ✅ Performance improvement

    // ✅ Calculate current page from skip
    const currentPage = Math.floor(skip / limit) + 1;

    res.json({
      success: true,
      currentPage: currentPage,
      totalPosts: totalPosts,
      postsOnCurrentPage: posts.length,
      totalPages: Math.ceil(totalPosts / limit),
      hasMore: skip + limit < totalPosts, // ✅ Frontend ke liye useful
      data: {
        posts: posts
      }
    });

  } catch (error) {
    console.error('Error fetching user posts:', error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch posts",
      message: error.message 
    });
  }
});

const getPostById = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!postId) {
    return res.status(400).json({ error: 'Post ID is required' });
  }

  await redisClient.del(`post:${postId}`);

  const post = await getOrSetCache(`post:${postId}`, async () => {
    let query = Post.findById(postId)
      .populate('user', 'firstName lastName fullName profilePicture accountType businessName sadhuName tirthName')
      .populate({
        path: 'comments.user',
        select: 'firstName lastName fullName profilePicture accountType businessName sadhuName tirthName',
      })
      .populate({
        path: 'comments.replies.user',
        model: 'User',
        select: 'firstName lastName fullName profilePicture accountType businessName sadhuName tirthName',
      })
      .populate('sanghId', 'name sanghImage')
      .populate('panchId', 'name sanghImage');

    return await query;
  }, 3600);

  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  // ✅ function to get proper display name
  const getDisplayName = (u) => {
    if (!u) return 'User';
    if (u.accountType === 'business') return u.businessName || u.fullName || 'User';
    if (u.accountType === 'sadhu') return u.sadhuName || u.fullName || 'User';
    if (u.accountType === 'tirth') return u.tirthName || u.fullName || 'User';
    return u.fullName || 'User';
  };

  res.json({
    id: post._id,
    caption: post.caption,
    postType: post.postType,
    image: post.media?.[0]?.url,
    likes: post.likes.map((like) => like.toString()),
    likeCount: post.likes.length,
    comments: post.comments.map((comment) => ({
      id: comment._id,
      text: comment.text,
      user: {
        id: comment.user?._id,
        name: getDisplayName(comment.user),
        avatar: comment.user?.profilePicture,
      },
      createdAt: comment.createdAt,
      replies: comment.replies.map((reply) => ({
        id: reply._id,
        text: reply.text,
        user: {
          id: reply.user?._id,
          name: getDisplayName(reply.user),
          avatar: reply.user?.profilePicture,
        },
        createdAt: reply.createdAt,
      })),
    })),
    commentCount: post.comments.length,
    userId: post.user?._id,
    userName: getDisplayName(post.user),
    profilePicture: post.user?.profilePicture,
    type: post.type || null,
    sanghId: post.sanghId || null,
    panchId: post.panchId || null,
    pollQuestion: post.pollQuestion || null,
    pollOptions: post.pollOptions || [],
    pollVotes: post.pollVotes || {},
    votedUsers: post.votedUsers || [],
    pollDuration: post.pollDuration,
    createdAt: post.createdAt,
  });
});


// // Get all posts
// const getAllPosts = asyncHandler(async (req, res) => {
//     const userId = req.user.id;
//     const user = await User.findById(userId);

//     if (!user) {
//         return res.status(404).json({ error: 'User not found' });
//     }

//     let filter = {};

//     // ✅ Restrict posts if Jain Aadhar is not verified
//     if (user.jainAadharStatus === 'none' || user.jainAadharStatus === 'pending') {
//         if (!user.trialPeriodStart) {
//             return res.status(403).json({
//                 success: false,
//                 message: "Trial period not started. Please verify your Jain Aadhar."
//             });
//         }

//         // Trial period ke 2 din tak hi posts dikhane ka logic
//         const trialEnd = new Date(user.trialPeriodStart);
//         trialEnd.setDate(trialEnd.getDate() + 2); // Trial start ke 2 din baad tak

//         const currentDate = new Date();

//         if (currentDate > trialEnd) {
//             return res.status(403).json({
//                 success: false,
//                 message: "Trial period expired. Please verify your Jain Aadhar to access all posts."
//             });
//         }

//         // Sirf trial period ke dauraan bani posts hi show hongi
//         filter.createdAt = { $gte: user.trialPeriodStart, $lt: trialEnd };
//     }

//     // ✅ Agar Jain Aadhar verified hai to sari posts dikhao (koi filter nahi lagega)
//     const posts = await Post.find(filter)
//         .populate('user', 'firstName lastName profilePicture')
//         .sort({ createdAt: -1 });

//     const formattedPosts = posts.map(post => ({
//         ...post.toObject(),
//         userName: `${post.user?.firstName} ${post.user?.lastName}`,
//     }));

//     res.json(formattedPosts);
// });
// Optimized Get All Posts API for followers
// const getAllPosts = async (req, res) => {
//   try {
//     const limit = parseInt(req.query.limit) || 5;
//     const cursor = req.query.cursor;
//     const userId = req.query.userId;

//     const user = await User.findById(userId).select('friends');
//     if (!user) {
//       return successResponse(res, {
//         posts: [],
//         pagination: { nextCursor: null, hasMore: false }
//       }, 'User not found');
//     }

//     const followedUserIds = user.friends.map(f => f.toString());
//     const priorityUserIds = [...followedUserIds, userId];
//     const timeCondition = cursor ? { createdAt: { $lt: new Date(cursor) } } : {};

//     // Own posts
//     const ownPostsRaw = await Post.find({
//       user: userId,
//       ...timeCondition
//     })
//       .populate('user', 'firstName lastName fullName profilePicture friends accountStatus')
//       .populate('sanghId', 'name sanghImage')
//       .sort({ createdAt: -1 })
//       .limit(limit)
//       .lean();

//     //Filter out posts where user is deactivated
//     const ownPosts = ownPostsRaw.filter(post => post.user?.accountStatus !== 'deactivated');

//     const remainingLimitAfterOwn = limit - ownPosts.length;

//     let followedPosts = [];
//     if (remainingLimitAfterOwn > 0) {
//       const followedPostsRaw = await Post.find({
//         user: { $in: followedUserIds, $ne: userId },
//         ...timeCondition
//       })
//         .populate('user', 'firstName lastName fullName profilePicture friends accountStatus')
//         .populate('sanghId', 'name sanghImage')
//         .sort({ createdAt: -1 })
//         .limit(remainingLimitAfterOwn)
//         .lean();

//       followedPosts = followedPostsRaw.filter(post => post.user?.accountStatus !== 'deactivated');
//     }

//     const remainingLimitAfterFollowed = remainingLimitAfterOwn - followedPosts.length;

//     let otherPosts = [];
//     if (remainingLimitAfterFollowed > 0) {
//       const otherPostsRaw = await Post.find({
//         user: { $nin: priorityUserIds },
//         ...timeCondition
//       })
//         .populate('user', 'firstName lastName fullName profilePicture friends accountStatus')
//         .populate('sanghId', 'name sanghImage')
//         .sort({ createdAt: -1 })
//         .limit(remainingLimitAfterFollowed)
//         .lean();

//       otherPosts = otherPostsRaw.filter(post => post.user?.accountStatus !== 'deactivated');
//     }

//     const allPosts = [...ownPosts, ...followedPosts, ...otherPosts];

//     const nextCursor = allPosts.length > 0
//       ? allPosts[allPosts.length - 1].createdAt.toISOString()
//       : null;

//     // Add default empty friends if not exists
//     allPosts.forEach(post => {
//       if (post.user && !post.user.friends) {
//         post.user.friends = [];
//       }
//     });

//     return successResponse(res, {
//       posts: allPosts,
//       pagination: {
//         nextCursor,
//         hasMore: allPosts.length === limit
//       }
//     }, 'All user posts fetched');

//   } catch (error) {
//     console.error("Error in getAllPosts:", error);
//     return errorResponse(res, 'Failed to fetch posts', 500, error.message);
//   }
// };
const getAllPosts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cursor = req.query.cursor;
    const userId = req.query.userId;

    const user = await User.findById(userId).lean();
    if (!user)
      return successResponse(res, { posts: [], pagination: { nextCursor: null, hasMore: false } }, "User not found");

    // ------------------------------
    // BLOCKED USERS & REPORTED POSTS
    // ------------------------------
    const blockedUsers = (await Block.find({
      $or: [{ blocker: userId }, { blocked: userId }]
    }).lean()).map(rel =>
      rel.blocker.toString() === userId ? rel.blocked.toString() : rel.blocker.toString()
    );

    const reportedPostIds = (await Report.find({
      reportedBy: userId,
      postId: { $ne: null }
    }).select("postId").lean()).map(r => r.postId.toString());

    // ------------------------------
    // NORMAL POSTS (excluding boosted)
    // ------------------------------
    const normalQuery = {
      _id: { $nin: reportedPostIds },
      user: { $nin: blockedUsers },

      // ❗ Show ONLY posts which were never boosted OR expired boosts
      $or: [
        { isBoosted: { $exists: false } },
        { isBoosted: false, activeBoost: { $exists: false } }
      ],

      ...(cursor ? { createdAt: { $lt: new Date(cursor) } } : {})
    };

    let normalPosts = await Post.find(normalQuery)
      .populate("user", "firstName lastName fullName profilePicture accountStatus accountType businessName sadhuName tirthName")
      .populate("sanghId", "name sanghImage")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Remove deactivated users
    normalPosts = normalPosts.filter(p => p.user?.accountStatus !== "deactivated");

    // REMOVE EXPIRED POLLS
    const now = new Date();
    normalPosts = normalPosts.filter(p => {
      if (p.postType !== "poll") return true;
      if (p.pollDuration === "Always") return true;

      const createdAt = new Date(p.createdAt);
      const durations = { "1day": 1, "1week": 7, "1month": 30 };

      if (!durations[p.pollDuration]) return true;

      const expiry = new Date(
        createdAt.getTime() + durations[p.pollDuration] * 24 * 60 * 60 * 1000
      );
      return now <= expiry;
    });

    // ------------------------------
    // ACTIVE BOOST PLANS
    // ------------------------------
    const activeBoosts = await BoostPlan.find({
      status: "active",
      paymentStatus: "verified",
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() }
    }).populate({
      path: "post",
      populate: {
        path: "user",
        select: "firstName lastName fullName sadhuName tirthName accountType profilePicture accountStatus"
      }
    }).lean();

    const userState = user.location?.state;
    const userDistrict = user.location?.district;
    const userCity = user.location?.city;

    // ------------------------------
    // FILTER BOOSTS BY LOCATION + ACTIVE BOOST
    // ------------------------------
    let targetedBoosts = activeBoosts.filter(boost => {
      if (!boost.post) return false;

      // Post must still be boosted
      if (boost.post.isBoosted !== true) return false;
      if (!boost.post.activeBoost) return false;
      if (boost.post.activeBoost.toString() !== boost._id.toString()) return false;

      const t = boost.targeting;
      const isSelf = boost.post.user._id.toString() === userId.toString();

      const match =
        t?.states?.includes(userState) ||
        t?.districts?.includes(userDistrict) ||
        t?.cities?.includes(userCity);

      return isSelf || match;
    });

    // REMOVE duplicates
    const normalIds = new Set(normalPosts.map(p => p._id.toString()));
    targetedBoosts = targetedBoosts.filter(b => !normalIds.has(b.post._id.toString()));

    // ---------------------------------------
    // 🟩 SEPARATE BOOSTED POSTS:
    // 1. boostedPostsForSelf → creator sees immediately (normal feed)
    // 2. boostedPostsForOthers → others see after 4 posts
    // ---------------------------------------
   let boostedPostsForSelf = [];
let boostedPostsForOthers = [];

targetedBoosts.forEach(b => {
  const post = { ...b.post };
  if (post.user._id.toString() === userId.toString()) {
    boostedPostsForSelf.push(post); // normal feed me merge
  } else {
    boostedPostsForOthers.push({ ...post, isBoostSlot: true });
  }
});

// Merge creator's boosted posts into normal feed
normalPosts = [...boostedPostsForSelf, ...normalPosts];
normalPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

const boostedPosts = boostedPostsForOthers;

    // ------------------------------
    // INSERT BOOST AFTER EVERY 4 POSTS
    // ------------------------------
    let finalFeed = [];
    let normalCount = 0;
    let boostIndex = 0;

    for (let i = 0; i < normalPosts.length; i++) {
      finalFeed.push(normalPosts[i]);
      normalCount++;

      if (normalCount === 4 && boostIndex < boostedPosts.length) {
        finalFeed.push(boostedPosts[boostIndex]);
        boostIndex++;
        normalCount = 0;
      }
    }

    // Add remaining boosted posts at end
    while (boostIndex < boostedPosts.length) {
      finalFeed.push(boostedPosts[boostIndex]);
      boostIndex++;
    }

    // ------------------------------
    // HASHTAG SCORE
    // ------------------------------
    const userHashtags = user.hashtags || [];
    finalFeed = finalFeed.map(post => {
      let score = 0;
      if (post.hashtags?.length && userHashtags.length) {
        post.hashtags.forEach(tag => {
          const match = userHashtags.find(h => h.name === tag);
          if (match) score += match.score;
        });
      }
      return { ...post, _score: score };
    });

    // ------------------------------
    // PAGINATION
    // ------------------------------
    const nextCursor =
      normalPosts.length > 0
        ? normalPosts[normalPosts.length - 1].createdAt.toISOString()
        : null;

    return successResponse(
      res,
      {
        posts: finalFeed,
        pagination: { nextCursor, hasMore: normalPosts.length === limit }
      },
      "All posts fetched successfully"
    );

  } catch (err) {
    console.error("❌ Error:", err);
    return errorResponse(res, "Failed to fetch posts", 500, err.message);
  }
};

const getAllVideoPosts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cursor = req.query.cursor;
    const userId = req.query.userId;

    // 1️⃣ Find user
    const user = await User.findById(userId).lean();
    if (!user)
      return successResponse(res, { posts: [], pagination: { nextCursor: null, hasMore: false } }, "User not found");

    // 2️⃣ Blocked users
    const blockedUsers = (await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] }).lean())
      .map(rel => rel.blocker.toString() === userId ? rel.blocked.toString() : rel.blocker.toString());

    // 3️⃣ Reported posts
    const reportedPostIds = (await Report.find({ reportedBy: userId, postId: { $ne: null } }).select("postId").lean())
      .map(r => r.postId.toString());

    // 4️⃣ NORMAL VIDEO POSTS
    const normalQuery = {
      _id: { $nin: reportedPostIds },
      "media.type": "video",
      user: { $nin: blockedUsers },

      $or: [
        // Post was never boosted
        { isBoosted: { $exists: false } },

        // Post was boosted before but now expired (isBoosted false + activeBoost removed)
        { isBoosted: false, activeBoost: { $exists: false } }
      ],

      ...(cursor ? { createdAt: { $lt: new Date(cursor) } } : {})
    };

    let normalPosts = await Post.find(normalQuery)
      .populate("user", "firstName lastName fullName profilePicture accountStatus accountType businessName sadhuName tirthName")
      .populate("sanghId", "name sanghImage")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    normalPosts = normalPosts.filter(p => p.user?.accountStatus !== "deactivated");

    // 5️⃣ ACTIVE BOOSTED POSTS
    const activeBoosts = await BoostPlan.find({
      status: "active",
      paymentStatus: "verified",
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() },
    }).populate({
      path: "post",
      populate: { path: "user", select: "firstName lastName fullName sadhuName tirthName accountType profilePicture accountStatus" }
    }).lean();

    const userState = user.location?.state;
    const userDistrict = user.location?.district;
    const userCity = user.location?.city;

    // 6️⃣ Filter boosts by location + self-post
   let targetedBoosts = activeBoosts.filter(boost => {
  if (!boost.post) return false;

  //  Video only
  if (boost.post.media?.[0]?.type !== "video") return false;

  //  Strict boost checks (IMPORTANT)
  if (boost.post.isBoosted !== true) return false;
  if (!boost.post.activeBoost) return false;
  if (boost.post.activeBoost.toString() !== boost._id.toString()) return false;

  const isSelf = boost.post.user._id.toString() === userId.toString();
  const t = boost.targeting;

  const match =
    t?.states?.includes(userState) ||
    t?.districts?.includes(userDistrict) ||
    t?.cities?.includes(userCity);

  return isSelf || match;
});


    const normalIds = new Set(normalPosts.map(p => p._id.toString()));
    targetedBoosts = targetedBoosts.filter(b => !normalIds.has(b.post._id.toString()));

    const boostedPosts = targetedBoosts.map(b => ({ ...b.post, isBoostSlot: true }));

    // 7️⃣ Insert boosted after every 4 normal posts
    let finalFeed = [];
    let normalCount = 0;
    let boostIndex = 0;

    for (let i = 0; i < normalPosts.length; i++) {
      finalFeed.push(normalPosts[i]);
      normalCount++;
      if (normalCount === 4 && boostIndex < boostedPosts.length) {
        finalFeed.push(boostedPosts[boostIndex]);
        boostIndex++;
        normalCount = 0;
      }
    }

    while (boostIndex < boostedPosts.length) {
      finalFeed.push(boostedPosts[boostIndex]);
      boostIndex++;
    }

    // 8️⃣ Hashtag score
    const userHashtags = (await UserInterest.findOne({ user: userId }).lean())?.hashtags || [];
    finalFeed = finalFeed.map(post => {
      let score = 0;
      if (post.hashtags?.length) {
        post.hashtags.forEach(tag => {
          const match = userHashtags.find(h => h.name === tag);
          if (match) score += match.score;
        });
      }
      return { ...post, _score: score };
    });

    // 9️⃣ Pagination cursor
    const nextCursor = normalPosts.length > 0 ? normalPosts[normalPosts.length - 1].createdAt.toISOString() : null;

    return successResponse(res, {
      posts: finalFeed,
      pagination: { nextCursor, hasMore: normalPosts.length === limit },
    }, "Video posts fetched successfully");

  } catch (err) {
    console.error("❌ Error in getAllVideoPosts:", err);
    return errorResponse(res, "Failed to fetch video posts", 500, err.message);
  }
};



// Get all posts (Modified)

// const getAllPosts = async (req, res) => {
//   try {
//     const limit = parseInt(req.query.limit) || 5;
//     const cursor = req.query.cursor;
//     const userId = req.query.userId;

//     const user = await User.findById(userId);
//     if (!user) {
//       return successResponse(res, {
//         posts: [],
//         pagination: { nextCursor: null, hasMore: false }
//       }, 'User not found');
//     }

//     // Get user interests
//     const interestDoc = await UserInterest.findOne({ user: userId });
//     const userHashtags = interestDoc ? interestDoc.hashtags : [];

//     // Cursor for pagination
//     const timeCondition = cursor ? { createdAt: { $lt: new Date(cursor) } } : {};

//     // Fetch posts
//     const postsRaw = await Post.find({
//       ...timeCondition
//     })
//       .populate('user', 'firstName lastName fullName profilePicture friends accountStatus accountType businessName')
//       .populate('sanghId', 'name sanghImage')
//       .lean();

//     // Filter out deactivated accounts
//     let posts = postsRaw.filter(post => post.user?.accountStatus !== 'deactivated');

//     // Score calculation: match hashtags with user interests
//     posts = posts.map(post => {
//       let score = 0;
//       if (post.hashtags && post.hashtags.length) {
//         post.hashtags.forEach(tag => {
//           const match = userHashtags.find(h => h.name === tag);
//           if (match) score += match.score;
//         });
//       }
//       // Newer posts get small bonus
//       const ageHours = (Date.now() - new Date(post.createdAt)) / (1000 * 60 * 60);
//       score += Math.max(0, 48 - ageHours) * 0.1; // bonus for recency
//       return { ...post, _score: score };
//     });

//     // Sort by score first, then by date
//     posts.sort((a, b) => b._score - a._score || new Date(b.createdAt) - new Date(a.createdAt));

//     // Apply limit
//     posts = posts.slice(0, limit);

//     // Pagination cursor
//     const nextCursor = posts.length > 0
//       ? posts[posts.length - 1].createdAt.toISOString()
//       : null;

//     // Default empty friends array
//     posts.forEach(post => {
//       if (post.user && !post.user.friends) {
//         post.user.friends = [];
//       }
//     });

//     return successResponse(res, {
//       posts,
//       pagination: {
//         nextCursor,
//         hasMore: posts.length === limit
//       }
//     }, 'All posts fetched successfully');

//   } catch (error) {
//     console.error("Error in getAllPosts:", error);
//     return errorResponse(res, 'Failed to fetch posts', 500, error.message);
//   }
// };

// Function to toggle like on a post
const toggleLike = [
  asyncHandler(async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const post = await Post.findById(postId).populate('user');
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const isLiked = post.likes.includes(userId);

    if (isLiked) {
      // ---- Unlike ----
      post.likes = post.likes.filter((id) => id.toString() !== userId);

       user.activity.likes = user.activity.likes.filter(
        (like) => like.postId.toString() !== postId
      );
      await user.save();

      // UserInterest score reduce
      if (post.hashtags && post.hashtags.length) {
        let interestDoc = await UserInterest.findOne({ user: userId });
        if (interestDoc) {
          post.hashtags.forEach(tag => {
            const lowerTag = tag.toLowerCase();
            const existingTag = interestDoc.hashtags.find(h => h.name === lowerTag);
            if (existingTag) {
              existingTag.score += 1;
            } else {
              interestDoc.hashtags.push({ name: lowerTag, score: 1 });
            }
          });

          await interestDoc.save();
        }
      }

      // Notification delete karein
      await Notification.findOneAndDelete({
        senderId: userId,
        receiverId: post.user._id,
        type: 'like',
        postId: postId,
      });

    } else {
      // ---- Like ----
      post.likes.push(userId);

      if (!user.activity.likes.some(like => like.postId.toString() === postId)) {
        user.activity.likes.push({ postId });
        await user.save();
      }
      // UserInterest score increase
      if (post.hashtags && post.hashtags.length) {
        let interestDoc = await UserInterest.findOne({ user: userId });
        if (!interestDoc) {
          interestDoc = new UserInterest({ user: userId, hashtags: [] });
        }
        post.hashtags.forEach(tag => {
          const existingTag = interestDoc.hashtags.find(h => h.name === tag);
          if (existingTag) {
            existingTag.score += 1;
          } else {
            interestDoc.hashtags.push({ name: tag, score: 1 });
          }
        });
        await interestDoc.save();
      }

      // Notification create
      const notification = new Notification({
        senderId: userId,
        receiverId: post.user._id,
        type: 'like',
        message: "liked your post.",
        postId: postId,
      });
      await notification.save();

      // Socket notification send
      const io = getIo();
      io.to(post.user._id.toString()).emit('newNotification', notification);
    }

    await post.save();
    await invalidateCache(`post:${postId}`);
    await invalidateCache(`postLikes:${postId}`);

    res.status(200).json({
      message: isLiked ? 'Like removed' : 'Post liked',
      likesCount: post.likes.length,
      likes: post.likes,
    });
  }),
];
// Save post → add to activity.saved
const toggleSavePost = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  if (!postId) {
    return res.status(400).json({ message: "Post ID is required" });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const postExists = await Post.findById(postId);
  if (!postExists) {
    return res.status(404).json({ message: "Post not found" });
  }

  // Check if already saved in activity.saved
  const alreadySaved = user.activity?.saved?.some(
    (a) => a.postId.toString() === postId
  );

  if (alreadySaved) {
    // ❌ Unsave: remove from activity.saved
    user.activity.saved = (user.activity.saved || []).filter(
      (a) => a.postId.toString() !== postId
    );
  } else {
    // ✅ Save: push to activity.saved with timestamp
    if (!user.activity) user.activity = {};
    if (!user.activity.saved) user.activity.saved = [];
    user.activity.saved.push({ postId, createdAt: new Date() });
  }

  await user.save();

  res.json({
    success: true,
    message: alreadySaved ? "Post removed from saved" : "Post saved successfully",
    saved: !alreadySaved,
    savedCount: user.activity.saved.length,
  });
});

const getLikedUsers = asyncHandler(async (req, res) => {
  const { postId } = req.params;

  const post = await Post.findById(postId).populate({
    path: 'likes',
    select: 'fullName profilePicture businessName accountType sadhuName tirthName',
  });

  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }

  res.status(200).json({ users: post.likes });
});
// Unlike a post
const unlikePost = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const post = await Post.findById(postId);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }
  // Check if the post is already unliked
  if (!post.likes.includes(userId)) {
    return res.status(400).json({ error: 'Post has not been liked yet' });
  }
  // Remove userId from the likes array
  post.likes = post.likes.filter((id) => id.toString() !== userId);
  await post.save();
  // Remove the post from the user's likedPosts array (update user)
  await User.findByIdAndUpdate(
    userId,
    { $pull: { likedPosts: postId } },
    { new: true }
  );
  res.json({ message: 'Post unliked', post });
});

const deletePost = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const { userId } = req.query;

  const post = await Post.findById(postId);
  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const isOwner = post.user.toString() === userId.toString();
  const isSuperAdmin = user.role === 'superadmin';

  if (!isOwner && !isSuperAdmin) {
    return res.status(403).json({ error: 'Unauthorized to delete this post' });
  }

  // Delete media from S3 (if required)
  if (post.media && post.media.length > 0) {
    const deletePromises = post.media.map(async (mediaItem) => {
      try {
        const key = extractS3KeyFromUrl(mediaItem.url);
        if (key) {
          const deleteParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key
          };
          await s3Client.send(new DeleteObjectCommand(deleteParams));
        }
      } catch (err) {
        console.error('Error deleting from S3:', err);
      }
    });
    await Promise.all(deletePromises);
  }

  // ✅ Delete related reports
  await Report.deleteMany({ postId: postId });

  // ✅ Remove postId from user's posts list
  user.posts = user.posts.filter(id => id.toString() !== postId.toString());
  await user.save();
    if (post.type === 'sangh' && post.sanghId) {
    await Sangh.updateOne(
      { _id: post.sanghId },
      { $pull: { posts: post._id } }
    );
  }
  // ✅ Delete post
  await post.deleteOne();
  // ✅ Decrease user's post count safely
  await User.findByIdAndUpdate(
    post.user,
    { $inc: { postCount: -1 } }
  );

  // ✅ Clear cache (optional if used)
  await invalidateCache(`post:${postId}`);
  await invalidateCache('combinedFeed:*');

  res.json({ message: 'Post and related reports deleted successfully' });
});


const sharePost = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user._id;

  const post = await Post.findById(postId);
  if (!post) {
    return res.status(404).json({ error: "Post not found" });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Check if already shared
  const alreadyShared = user.activity.shares.some(
    (s) => s.postId.toString() === postId
  );

  if (alreadyShared) {
    return res.status(400).json({ error: "Post already shared by this user" });
  }

  // ✅ Add to user activity
  user.activity.shares.push({ postId, createdAt: new Date() });
  await user.save();

  // ✅ Increment share count on post
  post.shareCount = (post.shareCount || 0) + 1;
  await post.save();

  res.json({
    message: "Post shared successfully",
    shareCount: post.shareCount,
  });
});
const editPost = asyncHandler(async (req, res) => {
  const { userId, caption, image } = req.body;
  const { postId } = req.params;
  try {
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const postUserId = post.user.$oid ? post.user.$oid : post.user.toString();
    if (postUserId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    post.caption = caption;
    post.image = image;
     // If replaceMedia flag is set, delete existing media from S3 and replace with new ones
     if (req.body.replaceMedia === 'true' && post.media && post.media.length > 0) {
      // Delete existing media from S3
      const deletePromises = post.media.map(async (mediaItem) => {
        try {
          const key = extractS3KeyFromUrl(mediaItem.url);
          if (key) {
            const deleteParams = {
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: key
            };
            
            await s3Client.send(new DeleteObjectCommand(deleteParams));
            console.log(`Successfully deleted file from S3: ${key}`);
          }
        } catch (error) {
          console.error(`Error deleting file from S3: ${mediaItem.url}`, error);
        }
      });
      await Promise.all(deletePromises);
      
      // Clear existing media array
      post.media = [];
    }
    if (req.files) {
      if (req.files.image) {
        req.files.image.forEach(file => {
          post.media.push({
            url: convertS3UrlToCDN(file.location),
            type: 'image'
          });
        });
      }
      if (req.files.video) {
        req.files.video.forEach(file => {
          post.media.push({
            url: convertS3UrlToCDN(file.location),
            type: 'video'
          });
        });
      }
    }
    await post.save();
    res.status(200).json({ message: 'Post updated successfully', post });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add Comment to Post
const addComment = async (req, res) => {
  try {
    const { postId, commentText, userId } = req.body;
    if (!postId || !commentText || !userId) {
      return res.status(400).json({ message: 'postId, commentText, and userId are required' });
    }
    // Bad Word Check
    if (containsBadWords(commentText)) {
      return res.status(400).json({
        success: false,
        message: "Your comment contains inappropriate or unsafe words. Please modify it..",
      });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const comment = {
      user: userId,
      text: commentText,
    };

    post.comments.push(comment);
    await post.save();

    // 🔥 Yeh line naya comment nikal legi
    const newComment = post.comments[post.comments.length - 1];

    // User activity update
    if (!user.activity.comments.some(c => c.postId.toString() === postId)) {
      user.activity.comments.push({ postId });
      await user.save();
    }

    await invalidateCache(`post:${postId}`);
    await invalidateCache(`postComments:${postId}`);

    await post.populate('comments.user', 'firstName lastName fullName profilePicture accountType businessName sadhuName tirthName');

    // Send notification
    const notification = new Notification({
      senderId: userId,
      receiverId: post.user,
      type: 'comment',
      message: "commented on your post.",
      postId: postId,
    });
    await notification.save();

    const io = getIo();
    io.to(post.user.toString()).emit('newNotification', notification);

    res.status(200).json({
      message: 'Comment added successfully',
      commentId: newComment._id,
      comment: newComment,
      post
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error adding comment', error: error.message });
  }
};

// Delete Comment from Post
const deleteComment = async (req, res) => {
  try {
    const { postId, commentId, userId } = req.body;

    if (!postId || !commentId || !userId) {
      return res.status(400).json({ message: 'postId, commentId and userId are required' });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const comment = post.comments.find(c => c._id.toString() === commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // User fetch karo role check karne ke liye
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Condition: either user himself or superadmin
    if (comment.user.toString() !== userId && user.role !== "superadmin") {
      return res.status(403).json({ message: 'You can only delete your own comment or must be a superadmin' });
    }

    // Remove comment
    post.comments = post.comments.filter(c => c._id.toString() !== commentId);

    await post.save();
   await CommentReport.deleteMany({ commentId: commentId });
    // Cache clear
    await invalidateCache(`post:${postId}`);
    await invalidateCache(`postComments:${postId}`);

    res.status(200).json({ message: 'Comment deleted successfully', post });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ message: 'Error deleting comment', error: error.message });
  }
};

const addReply = async (req, res) => {
  const { commentId, userId, replyText } = req.body;
  try {
      // Bad Word Check
    if (containsBadWords(replyText)) {
      return res.status(400).json({
        success: false,
        message: "Your comment contains inappropriate or unsafe words. Please modify it.",
      });
    }
    const post = await Post.findOne({ 'comments._id': commentId });
    if (!post) return res.status(404).json({ message: 'Post or comment not found' });

    const user = await User.findById(userId);
    if(!user) return res.status(404).json({ message: 'User not found'} )

    const comment = post.comments.id(commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    const newReply = {
      user: userId,
      text: replyText,
      createdAt: new Date(),
    };

    comment.replies.push(newReply);
    await post.save();

    // Get the last added reply with _id populated by MongoDB
    const addedReply = comment.replies[comment.replies.length - 1];

    await post.populate('comments.replies.user', 'firstName lastName fullName profilePicture accountType businessName sadhuName');

    res.status(201).json({
      message: 'Reply added successfully',
      reply: {
        id: addedReply._id,
        text: addedReply.text,
        user: addedReply.user,
        createdAt: addedReply.createdAt,
      },
    });
  } catch (error) {
    console.error('Error adding reply:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete Reply from a Comment
const deleteReply = async (req, res) => {
  try {
    const { postId, commentId, replyId, userId } = req.body;

    if (!postId || !commentId || !replyId || !userId) {
      return res.status(400).json({ message: 'postId, commentId, replyId and userId are required' });
    }

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const comment = post.comments.id(commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    const reply = comment.replies.find(r => r._id.toString() === replyId);
    if (!reply) return res.status(404).json({ message: 'Reply not found' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Only author or superadmin can delete
    if (reply.user.toString() !== userId && user.role !== 'superadmin') {
      return res.status(403).json({ message: 'You can only delete your own reply or must be a superadmin' });
    }

    // Remove reply
    comment.replies = comment.replies.filter(r => r._id.toString() !== replyId);
    await post.save();

    await invalidateCache(`post:${postId}`);
    await invalidateCache(`postComments:${postId}`);

    res.status(200).json({ message: 'Reply deleted successfully', post });
  } catch (error) {
    console.error('Error deleting reply:', error);
    res.status(500).json({ message: 'Error deleting reply', error: error.message });
  }
};


const likeComment = async (req, res) => {
  try {
    const { postId, commentId, userId } = req.body;

    if (!postId || !commentId || !userId) {
      return res.status(400).json({ message: 'postId, commentId and userId are required' });
    }

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const comment = post.comments.id(commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    const index = comment.likes?.findIndex((id) => id.toString() === userId);

    if (index > -1) {
      // User already liked, so unlike
      comment.likes.splice(index, 1);
      await post.save();
      return res.status(200).json({ message: 'Comment unliked successfully' });
    } else {
      // Like the comment
      comment.likes.push(userId);
      await post.save();

      // Optional: send notification to comment owner (not self)
      if (comment.user.toString() !== userId) {
        const notification = new Notification({
          senderId: userId,
          receiverId: comment.user,
          type: 'like_comment',
          message: 'liked your comment',
          postId,
        });
        await notification.save();
        const io = getIo();
        io.to(comment.user.toString()).emit('newNotification', notification);
      }

      return res.status(200).json({ message: 'Comment liked successfully' });
    }
  } catch (error) {
    console.error('Error liking comment:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
const likeReply = async (req, res) => {
  try {
    const { postId, commentId, replyId, userId } = req.body;

    if (!postId || !commentId || !replyId || !userId) {
      return res.status(400).json({ message: 'postId, commentId, replyId and userId are required' });
    }

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const comment = post.comments.id(commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    const reply = comment.replies.id(replyId);
    if (!reply) return res.status(404).json({ message: 'Reply not found' });

    const index = reply.likes?.findIndex((id) => id.toString() === userId);

    if (index > -1) {
      reply.likes.splice(index, 1);
      await post.save();
      return res.status(200).json({ message: 'Reply unliked successfully' });
    } else {
      reply.likes = reply.likes || [];
      reply.likes.push(userId);
      await post.save();

      if (reply.user.toString() !== userId) {
        const notification = new Notification({
          senderId: userId,
          receiverId: reply.user,
          type: 'like_reply',
          message: 'liked your reply',
          postId,
        });
        await notification.save();
        const io = getIo();
        io.to(reply.user.toString()).emit('newNotification', notification);
      }

      return res.status(200).json({ message: 'Reply liked successfully' });
    }
  } catch (error) {
    console.error('Error liking reply:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get Replies for a Specific Comment
const getReplies = async (req, res) => {
  const { commentId } = req.params;
  try {
    const post = await Post.findOne({ 'comments._id': commentId });
    if (!post) {
      return res.status(404).json({ message: 'Post or comment not found' });
    }
    const comment = post.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    await post.populate('comments.replies.user', 'firstName lastName fullName profilePicture accountType businessName sadhuName tirthName');
      res.status(200).json({
      message: 'Replies fetched successfully',
      replies: comment.replies,
    });
  } catch (error) {
    console.error('Error fetching replies:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
// Delete a specific media item from a post
const deleteMediaItem = asyncHandler(async (req, res) => {
  const { postId, mediaId } = req.params;
  const { userId } = req.body;

  const post = await Post.findById(postId);
  if (!post) {
    return errorResponse(res, 'Post not found', 404);
  }

  if (post.user.toString() !== userId) {
    return errorResponse(res, 'Unauthorized to modify this post', 403);
  }

  // Find the media item in the post
  const mediaItem = post.media.id(mediaId);
  if (!mediaItem) {
    return errorResponse(res, 'Media item not found', 404);
  }

  // Delete from S3
  try {
    const key = extractS3KeyFromUrl(mediaItem.url);
    if (key) {
      const deleteParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key
      };
      
      await s3Client.send(new DeleteObjectCommand(deleteParams));
      console.log(`Successfully deleted file from S3: ${key}`);
    }
  } catch (error) {
    console.error(`Error deleting file from S3: ${mediaItem.url}`, error);
    return errorResponse(res, 'Error deleting media from storage', 500);
  }

  // Remove the media item from the post
  post.media.pull(mediaId);
  await post.save();

  return successResponse(res, post, 'Media item deleted successfully');
});

// Hide a post (make it invisible to others)
const hidePost = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user._id;

  const post = await Post.findById(postId);
  if (!post) {
    return errorResponse(res, 'Post not found', 404);
  }

  if (post.user.toString() !== userId.toString()) {
    return errorResponse(res, 'Unauthorized to modify this post', 403);
  }

  post.isHidden = true;
  await post.save();

  return successResponse(res, post, 'Post hidden successfully');
});

// Unhide a post (make it visible again)
const unhidePost = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user._id;

  const post = await Post.findById(postId);
  if (!post) {
    return errorResponse(res, 'Post not found', 404);
  }

  if (post.user.toString() !== userId.toString()) {
    return errorResponse(res, 'Unauthorized to modify this post', 403);
  }

  post.isHidden = false;
  await post.save();

  return successResponse(res, post, 'Post unhidden successfully');
});

// ✅ Updated getCombinedFeed with CDN support
const getCombinedFeed = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [userPosts, sanghPosts, panchPosts, vyaparPosts, tirthPosts, sadhuPosts] = await Promise.all([
      Post.find({ isHidden: false })
        .populate('user', 'firstName lastName profilePicture')
        .sort('-createdAt')
        .select('caption media user likes comments createdAt')
        .lean(),

      SanghPost.find({ isHidden: false })
        .populate('sanghId', 'name level location')
        .populate('postedByUserId', 'firstName lastName fullName profilePicture')
        .sort('-createdAt')
        .select('caption media sanghId postedByUserId postedByRole likes comments createdAt')
        .lean(),

      PanchPost.find({ isHidden: false })
        .populate('panchId', 'accessId')
        .populate('sanghId', 'name level location')
        .sort('-createdAt')
        .select('caption media panchId sanghId postedByMemberId postedByName likes comments createdAt')
        .lean(),

      VyaparPost.find({ isHidden: false })
        .populate('vyaparId', 'name businessType')
        .populate('postedByUserId', 'firstName lastName fullName profilePicture')
        .sort('-createdAt')
        .select('caption media vyaparId postedByUserId likes comments createdAt')
        .lean(),

      TirthPost.find({ isHidden: false })
        .populate('tirthId', 'name location')
        .populate('postedByUserId', 'firstName lastName fullName profilePicture')
        .sort('-createdAt')
        .select('caption media tirthId postedByUserId likes comments createdAt')
        .lean(),

      SadhuPost.find({ isHidden: false })
        .populate('sadhuId', 'sadhuName uploadImage')
        .populate('postedByUserId', 'firstName lastName fullName profilePicture')
        .sort('-createdAt')
        .select('caption media sadhuId postedByUserId likes comments createdAt')
        .lean()
    ]);

    const postsWithTypes = [
      ...applyCDNToPosts(userPosts, 'user'),
      ...applyCDNToPosts(sanghPosts, 'sangh'),
      ...applyCDNToPosts(panchPosts, 'panch'),
      ...applyCDNToPosts(vyaparPosts, 'vyapar'),
      ...applyCDNToPosts(tirthPosts, 'tirth'),
      ...applyCDNToPosts(sadhuPosts, 'sadhu')
    ];

    const sortedPosts = postsWithTypes.sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    const paginatedPosts = sortedPosts.slice(skip, skip + limit);
    const totalPosts = sortedPosts.length;

    return successResponse(res, {
      posts: paginatedPosts,
      pagination: {
        total: totalPosts,
        page,
        pages: Math.ceil(totalPosts / limit)
      }
    }, 'Combined feed retrieved successfully');
  } catch (error) {
    console.error('Error in getCombinedFeed:', error);
    return errorResponse(res, 'Error retrieving combined feed', 500, error.message);
  }
});


const getCombinedFeedOptimized = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const cursor = req.query.cursor;

  const cacheKey = cursor
    ? `combinedFeed:cursor:${cursor}:limit:${limit}`
    : `combinedFeed:firstPage:limit:${limit}`;

  const result = await getOrSetCache(cacheKey, async () => {
    const cursorQuery = cursor ? { createdAt: { $lt: new Date(cursor) } } : {};

    const [userPosts, sanghPosts, panchPosts, vyaparPosts, tirthPosts, sadhuPosts] = await Promise.all([
      Post.find({ ...cursorQuery, isHidden: false })
        .populate('user', 'firstName lastName profilePicture')
        .sort('-createdAt')
        .select('caption media user likes comments createdAt')
        .limit(limit)
        .lean(),
      SanghPost.find({ ...cursorQuery, isHidden: false })
        .populate('sanghId', 'name level location')
        .populate('postedByUserId', 'firstName lastName fullName profilePicture')
        .sort('-createdAt')
        .select('caption media sanghId postedByUserId postedByRole likes comments createdAt')
        .limit(limit)
        .lean(),
      PanchPost.find({ ...cursorQuery, isHidden: false })
        .populate('panchId', 'accessId')
        .populate('sanghId', 'name level location')
        .sort('-createdAt')
        .select('caption media panchId sanghId postedByMemberId postedByName likes comments createdAt')
        .limit(limit)
        .lean(),
      VyaparPost.find({ ...cursorQuery, isHidden: false })
        .populate('vyaparId', 'name businessType')
        .populate('postedByUserId', 'firstName lastName fullName profilePicture')
        .sort('-createdAt')
        .select('caption media vyaparId postedByUserId likes comments createdAt')
        .limit(limit)
        .lean(),
      TirthPost.find({ ...cursorQuery, isHidden: false })
        .populate('tirthId', 'name location')
        .populate('postedByUserId', 'firstName lastName fullName profilePicture')
        .sort('-createdAt')
        .select('caption media tirthId postedByUserId likes comments createdAt')
        .limit(limit)
        .lean(),
      SadhuPost.find({ ...cursorQuery, isHidden: false })
        .populate('sadhuId', 'sadhuName uploadImage')
        .populate('postedByUserId', 'firstName lastName fullName profilePicture')
        .sort('-createdAt')
        .select('caption media sadhuId postedByUserId likes comments createdAt')
        .limit(limit)
        .lean(),
    ]);

    const postsWithTypes = [
      ...applyCDNToPosts(userPosts, 'user'),
      ...applyCDNToPosts(sanghPosts, 'sangh'),
      ...applyCDNToPosts(panchPosts, 'panch'),
      ...applyCDNToPosts(vyaparPosts, 'vyapar'),
      ...applyCDNToPosts(tirthPosts, 'tirth'),
      ...applyCDNToPosts(sadhuPosts, 'sadhu')
    ];

    const sortedPosts = postsWithTypes
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    const nextCursor = sortedPosts.length > 0
      ? sortedPosts[sortedPosts.length - 1].createdAt.toISOString()
      : null;

    return {
      posts: sortedPosts,
      pagination: {
        nextCursor,
        hasMore: sortedPosts.length === limit
      }
    };
  }, 180);

  return successResponse(res, result, 'Combined feed retrieved successfully');
});

module.exports = {
  createPost,
  searchHashtags,
  getAllPosts,
  toggleLike,
  unlikePost,
  deletePost,
  editPost,
  getPostsByUser,
  getPostById,
  addComment,
  addReply,
  getReplies,
  deleteMediaItem,
  hidePost,
  unhidePost,
  getCombinedFeed,
  getCombinedFeedOptimized,
  getLikedUsers,
  likeReply,
  likeComment,
  sharePost,
  deleteComment,
  deleteReply,
  voteOnPoll,
  getAllVideoPosts,
  toggleSavePost
};
