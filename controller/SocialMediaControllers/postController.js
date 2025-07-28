const Post = require('../../model/SocialMediaModels/postModel');
const User = require('../../model/UserRegistrationModels/userModel');
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
const redisClient = require('../../config/redisClient')
const Report = require('../../model/SocialMediaModels/Report');
const Hashtag = require('../../model/SocialMediaModels/Hashtag');
const Sangh = require('../../model/SanghModels/hierarchicalSanghModel'); // ✅ correct relative path use karein

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

    const { caption, userId, hashtags,type, refId } = req.body;
    const parsedHashtags = hashtags ? JSON.parse(hashtags) : [];

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const media = [];
    if (req.files?.image) {
      req.files.image.forEach(file => {
        media.push({ url: convertS3UrlToCDN(file.location), type: 'image' });
      });
    }
    if (req.files?.video) {
      req.files.video.forEach(file => {
        media.push({ url: convertS3UrlToCDN(file.location), type: 'video' });
      });
    }

    // Save or update hashtags
    for (const tag of parsedHashtags) {
      await Hashtag.findOneAndUpdate(
        { name: tag.toLowerCase() },
        { $inc: { count: 1 } },
        { upsert: true, new: true }
      );
    }
    const postType = media.length > 0 ? 'media' : 'text';
     const postData = {
      user: userId,
      caption,
      media,
      postType,
      hashtags: parsedHashtags,
      type
    };

    // Add refId to corresponding field
    if (type === 'sangh') postData.sanghId = refId;
    else if (type === 'panch') postData.panchId = refId;
    else if (type === 'sadhu') postData.sadhuId = refId;
    else if (type === 'vyapar') postData.vyaparId = refId;

    const post = await Post.create(postData);
    if (!type) {
      user.posts.push(post._id);
      await user.save();
    } else {
        if (type === 'sangh') {
    await Sangh.findByIdAndUpdate(refId, {
      $push: { posts: post._id },
    });
    }
  }
    await invalidateCache('combinedFeed:*');
    await invalidateCache('combinedFeed:firstPage:limit:10');

    res.status(201).json(post);
  })
];

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
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  const posts = await getOrSetCache(cacheKey, async () => {
    return await Post.find({ user: userId })
      .populate('user', 'firstName lastName fullName profilePicture')
      .populate('sanghId', 'name sanghImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  }, 1800);
  if (!posts || posts.length === 0) {
    return errorResponse(res, 'No posts found for this user', 404);
  }
  const postData = posts.map(post => ({
    postType: post.postType,
    caption: post.caption,
    image: post.image,
    likes: post.likes.length,
    comments: post.comments.length,
    userName: post.user.userName,
    profilePicture: post.user.profilePicture,
    createdAt: post.createdAt
  }));
  res.json(postData);
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
      .populate('user', 'firstName lastName fullName profilePicture')
      .populate({
        path: 'comments.user',
        select: 'firstName lastName fullName profilePicture',
      })
      .populate({
        path: 'comments.replies.user',
        model: 'User',
        select: 'firstName lastName fullName profilePicture',
      });

    // 🔁 Type-wise populate
    query = query
      .populate('sanghId', 'name sanghImage')
      // .populate('panchId', 'name image')
      // .populate('sadhuId', 'fullName profilePicture')
      // .populate('vyaparId', 'businessName logo');

    return await query;
  }, 3600);

  if (!post) {
    return res.status(404).json({ error: 'Post not found' });
  }
  res.json({
    id: post._id,
    caption: post.caption,
    postType: post.postType,
    image: post.media?.[0]?.url,
    likes: post.likes.map((like) => like.toString()),
    comments: post.comments.map((comment) => ({
      id: comment._id,
      text: comment.text,
      user: {
        id: comment.user?._id,
        name: comment.user?.fullName,
        avatar: comment.user?.profilePicture,
      },
      createdAt: comment.createdAt,
      replies: comment.replies.map((reply) => ({
        id: reply._id,
        text: reply.text,
        user: {
          id: reply.user?._id,
          name: reply.user?.fullName,
          avatar: reply.user?.profilePicture,
        },
        createdAt: reply.createdAt,
      })),
    })),
    userId: post.user?._id,
    userName: post.user?.fullName,
    profilePicture: post.user?.profilePicture,
    type: post.type || null,
    sanghId: post.sanghId || null,
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

// Get all posts (Modified)
const getAllPosts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const cursor = req.query.cursor;
    const userId = req.query.userId;

    const user = await User.findById(userId);
    if (!user) {
      return successResponse(res, {
        posts: [],
        pagination: { nextCursor: null, hasMore: false }
      }, 'User not found');
    }

    const timeCondition = cursor ? { createdAt: { $lt: new Date(cursor) } } : {};

    const postsRaw = await Post.find({
      ...timeCondition
    })
      .populate('user', 'firstName lastName fullName profilePicture friends accountStatus')
      .populate('sanghId', 'name sanghImage')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const posts = postsRaw.filter(post => post.user?.accountStatus !== 'deactivated');

    const nextCursor = posts.length > 0
      ? posts[posts.length - 1].createdAt.toISOString()
      : null;

    // Ensure default empty friends array
    posts.forEach(post => {
      if (post.user && !post.user.friends) {
        post.user.friends = [];
      }
    });

    return successResponse(res, {
      posts,
      pagination: {
        nextCursor,
        hasMore: posts.length === limit
      }
    }, 'All posts fetched successfully');

  } catch (error) {
    console.error("Error in getAllPosts:", error);
    return errorResponse(res, 'Failed to fetch posts', 500, error.message);
  }
};


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
      post.likes = post.likes.filter((id) => id.toString() !== userId);
      // Notification delete karein
      await Notification.findOneAndDelete({
        senderId: userId,
        receiverId: post.user._id,
        type: 'like',
        postId: postId, 
      });
    } else {
      // Like add karein
      post.likes.push(userId);
      // Notification create aur save karein
      const notification = new Notification({
        senderId: userId,
        receiverId: post.user._id, // Fix: user ka _id lena zaroori hai
        type: 'like',
       message:"liked your post.",
         postId: postId,
      });
      await notification.save();
      // Socket notification send karein
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
const getLikedUsers = asyncHandler(async (req, res) => {
  const { postId } = req.params;

  const post = await Post.findById(postId).populate({
    path: 'likes',
    select: 'fullName profilePicture', // only needed fields
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

  // ✅ Clear cache (optional if used)
  await invalidateCache(`post:${postId}`);
  await invalidateCache('combinedFeed:*');

  res.json({ message: 'Post and related reports deleted successfully' });
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
    const user = await User.findById(userId);
    if(!user){
      return res.status(404).json({ message: 'User not found'})
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
    await invalidateCache(`post:${postId}`);
    await invalidateCache(`postComments:${postId}`);
    await post.populate('comments.user', 'firstName lastName fullName profilePicture');
    // Send a comment notification
    const notification = new Notification({
      senderId: userId,
      receiverId: post.user,
      type: 'comment',
     message: "commented on your post.",
       postId: postId,
    });
    await notification.save();
    // Emit the notification event to the receiver
    const io = getIo();
    io.to(post.user.toString()).emit('newNotification', notification);
    res.status(200).json({ message: 'Comment added successfully', post });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error adding comment', error: error.message });
  }
};

const addReply = async (req, res) => {
  const { commentId, userId, replyText } = req.body;
  try {
    const post = await Post.findOne({ 'comments._id': commentId });
    if (!post) {
      return res.status(404).json({ message: 'Post or comment not found' });
    }
    const user = await User.findById(userId);
    if(!user){
      return res.status(404).json({ message: 'User not found'})
    }
    const comment = post.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    const newReply = {
      user: userId,
      text: replyText,
      createdAt: new Date(),
    };
    comment.replies.push(newReply);
    await post.save();
    await post.populate('comments.replies.user', 'firstName lastName fullName profilePicture');
     // Send a reply notification
     const notification = new Notification({
      senderId: userId,
      receiverId: comment.user,
      type: 'reply',
      message: "replied to your comment."
      
    });
    await notification.save();
    // Emit the notification event to the receiver
    const io = getIo();
    io.to(comment.user.toString()).emit('newNotification', notification);
 
    res.status(201).json({
      message: 'Reply added successfully',
      reply: newReply,
    });
  } catch (error) {
    console.error('Error adding reply:', error);
    res.status(500).json({ message: 'Server error' });
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
    await post.populate('comments.replies.user', 'firstName lastName fullName profilePicture');
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
  likeComment
};
