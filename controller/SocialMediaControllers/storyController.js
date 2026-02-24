const Story = require('../../model/SocialMediaModels/storyModel');
const User = require('../../model/UserRegistrationModels/userModel');
const asyncHandler = require("express-async-handler");
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const StoryReport = require('../../model/SocialMediaModels/StoryReport');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const Friendship = require('../../model/SocialMediaModels/friendshipModel');
const { containsBadWords } = require("../../utils/filterBadWords");

const { moderateImage, moderateVideo } = require('../../utils/moderation');

const createStory = asyncHandler(async (req, res) => {
  try {
    let { type, sanghId, isSanghStory, mentionUsers, text, textStyle } =
      req.body;
    const userId = req.user._id;
    const userType = req.user.type;

    // Parse JSON safely
    const safeParse = (data) => {
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {
          return [];
        }
      }
      return data || [];
    };

    mentionUsers = safeParse(mentionUsers);
    text = safeParse(text);
    textStyle = safeParse(textStyle);

    // Convert uploaded files
    const mediaFiles = req.files
      ? req.files.map((file) => ({
          location: file.location,
          type: type || "image",
        }))
      : [];

    if (mediaFiles.length === 0 && !text?.length) {
      return res.status(400).json({
        success: false,
        message: "Either media or text is required for story",
      });
    }

    const mediaArray = [];

    // ✅ No moderation — directly process media
    for (const [index, file] of mediaFiles.entries()) {
      const cdnUrl = convertS3UrlToCDN(file.location);

      const mediaText = Array.isArray(text) ? text[index] || "" : text || "";

      mediaArray.push({
        url: cdnUrl,
        type: file.type,
        text: mediaText,
        textStyle: Array.isArray(textStyle)
          ? textStyle[index] || {}
          : textStyle || {},
        mentionUsers: Array.isArray(mentionUsers)
          ? mentionUsers
              .filter((id) => mongoose.Types.ObjectId.isValid(id))
              .map((id) => new mongoose.Types.ObjectId(id))
          : [],
      });
    }

    // ✅ Handle text-only story
    if (mediaArray.length === 0 && text?.length > 0) {
      mediaArray.push({
        url: "",
        type: "text",
        text: Array.isArray(text) ? text[0] || "" : text || "",
        textStyle: Array.isArray(textStyle)
          ? textStyle[0] || {}
          : textStyle || {},
        mentionUsers: Array.isArray(mentionUsers)
          ? mentionUsers
              .filter((id) => mongoose.Types.ObjectId.isValid(id))
              .map((id) => new mongoose.Types.ObjectId(id))
          : [],
      });
    }

    // 🔎 Check existing story within 24 hours
    const existingStory = await Story.findOne({
      userId,
      isSanghStory: isSanghStory === "true",
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    let savedStory;

    if (existingStory) {
      existingStory.media.push(...mediaArray);
      savedStory = await existingStory.save();
    } else {
      const newStory = new Story({
        userId,
        sanghId: isSanghStory === "true" ? sanghId : null,
        isSanghStory: isSanghStory === "true",
        media: mediaArray,
      });

      savedStory = await newStory.save();
    }

    // 🔄 Update references
    if (userType === "user") {
      await User.findByIdAndUpdate(userId, { story: savedStory._id });
    } else if (userType === "sangh" && sanghId) {
      await HierarchicalSangh.findByIdAndUpdate(sanghId, {
        $addToSet: { stories: savedStory._id },
      });
    }

    // 📌 Populate for response
    const populatedStory = await Story.findById(savedStory._id)
      .populate("userId", "fullName profilePicture")
      .populate(
        "media.mentionUsers",
        "fullName profilePicture accountType accountStatus sadhuName tirthName",
      );

    res.status(201).json({
      success: true,
      message: existingStory
        ? "New media added to existing story"
        : "New story created successfully",
      data: populatedStory,
    });
  } catch (error) {
    console.error("❌ Error creating/updating story:", error);
    res.status(500).json({
      success: false,
      message: "Error creating or updating story",
      error: error.message,
    });
  }
});

// Get All Stories
const getAllStories = asyncHandler(async (req, res) => {
  try {
    const userId = req.query.userId || req.user.id;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Reported stories
    const reportedStories = await StoryReport.find({
      reportedBy: userId,
    }).select("storyId");
    const hideStoryIds = reportedStories.map((r) => r.storyId.toString());

    // Muted users fetch karo
    const currentUser = await User.findById(userId).select("mutedStoryUsers");
    const mutedUserIds =
      currentUser?.mutedStoryUsers?.map((id) => id.toString()) || [];

    const followingList = await Friendship.find({
      follower: userId,
      followStatus: "following",
    }).select("following");

    const followerList = await Friendship.find({
      following: userId,
      followStatus: "following",
    }).select("follower");

    const followingIds = followingList.map((f) => f.following.toString());
    const followerIds = followerList.map((f) => f.follower.toString());

    const storyUserIds = new Set([...followingIds, ...followerIds, userId]);

    const stories = await Story.find({
      createdAt: { $gte: twentyFourHoursAgo },
      userId: { $in: Array.from(storyUserIds) }, // ✅ $nin hataya
      _id: { $nin: hideStoryIds },
    })
      .populate(
        "userId",
        "profilePicture firstName lastName fullName accountType accountStatus sadhuName tirthName",
      )
      .populate("sanghId", "name sanghImage");

    // ✅ Har story mein isMuted flag add karo
    const storiesWithMuteStatus = stories.map((story) => ({
      ...story.toObject(),
      isMuted: mutedUserIds.includes(story.userId?._id?.toString()),
    }));

    res.status(200).json({
      success: true,
      count: storiesWithMuteStatus.length,
      data: storiesWithMuteStatus,
    });
  } catch (error) {
    console.error("Error fetching stories:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching stories",
      error: error.message,
    });
  }
});

const getStoriesByUser = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { userId: targetUserId } = req.params;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Reported stories
    const reportedStories = await StoryReport.find({
      reportedBy: userId,
    }).select("storyId");
    const hideStoryIds = reportedStories.map((r) => r.storyId.toString());

    // ✅ Check karo target user muted hai ya nahi
    const currentUser = await User.findById(userId).select("mutedStoryUsers");
    const isMuted = currentUser?.mutedStoryUsers?.some(
      (id) => id.toString() === targetUserId.toString(),
    );

    // ✅ Agar muted hai to empty return karo
    if (isMuted) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        isMuted: true,
        message: "Is user ki stories muted hain",
      });
    }

    const stories = await Story.find({
      userId: targetUserId,
      createdAt: { $gte: twentyFourHoursAgo },
      _id: { $nin: hideStoryIds },
    })
      .populate(
        "userId",
        "profilePicture firstName lastName fullName accountType accountStatus sadhuName tirthName businessName",
      )
      .populate("sanghId", "name sanghImage");

    if (!stories.length) {
      return errorResponse(res, "No active stories found for this user", 404);
    }

    const cdnStories = stories.map((story) => ({
      ...story.toObject(),
      media: story.media.map((mediaItem) => ({
        ...(mediaItem.toObject ? mediaItem.toObject() : mediaItem),
        url: convertS3UrlToCDN(mediaItem.url),
      })),
    }));

    return successResponse(
      res,
      cdnStories,
      "Stories fetched successfully",
      200,
    );
  } catch (error) {
    console.error("Error fetching user stories:", error);
    return errorResponse(
      res,
      "Error fetching user stories",
      500,
      error.message,
    );
  }
});
// Delete Story
const deleteStory = asyncHandler(async (req, res) => {
    try {
        const { userId, storyId } = req.params;
        // Verify story ownership
        const story = await Story.findOne({
            _id: storyId,
            userId: req.user._id // Ensure the authenticated user owns the story
        });

        if (!story) {
            return res.status(404).json({
                success: false,
                message: "Story not found or unauthorized"
            });
        }

        // Delete the story
        await Story.findByIdAndDelete(storyId);

        // Remove story reference from User
        await User.findByIdAndUpdate(userId, {
            $pull: { story: storyId }
        });

        res.json({
            success: true,
            message: "Story deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting story:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting story",
            error: error.message
        });
    }
});
// delete story media by mediaId
const deleteStoryMedia = asyncHandler(async (req, res) => {
  try {
    const { storyId, mediaId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({
        success: false,
        message: "Story not found"
      });
    }

    if (!story.userId.equals(userId) && userRole !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this story"
      });
    }

    // ✅ Find media by _id
    const mediaExists = story.media.id(mediaId);
    if (!mediaExists) {
      return res.status(404).json({
        success: false,
        message: "Media not found in this story"
      });
    }

    // ✅ Remove specific media by _id
    story.media.pull(mediaId);

    // If no media left, delete entire story
    if (story.media.length === 0) {
      await Story.findByIdAndDelete(storyId);

      // Remove story reference from User
      await User.findByIdAndUpdate(story.userId, {
        $pull: { story: storyId }
      });

      // Delete related story reports
      await StoryReport.deleteMany({ storyId: storyId });

      return res.json({
        success: true,
        message: "Story and related reports deleted successfully",
        storyDeleted: true
      });
    }

    // Save updated story
    await story.save();

    res.json({
      success: true,
      message: "Media deleted successfully",
      data: story,
      storyDeleted: false
    });

  } catch (error) {
    console.error("Error deleting story media:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting story media",
      error: error.message
    });
  }
});
const adminDeleteStory = asyncHandler(async (req, res) => {
  try {
    const { storyId } = req.params;
    const userRole = req.user.role;

    if (userRole !== "superadmin") {
      return res.status(403).json({ 
        success: false, 
        message: "Only superadmin can delete stories." 
      });
    }

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({
        success: false,
        message: "Story not found"
      });
    }

    // Delete story
    await Story.findByIdAndDelete(storyId);

    // Remove from user
    await User.findByIdAndUpdate(story.userId, {
      $pull: { story: storyId }
    });

    // Delete reports
    await StoryReport.deleteMany({ storyId });

    return res.json({
      success: true,
      message: "Story deleted by superadmin"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error deleting story",
      error: error.message
    });
  }
});

// ✅ View specific media in a story
const viewStory = asyncHandler(async (req, res) => {
  const { storyId } = req.params;
  const { mediaId } = req.body; // 👈 mediaId body se aayegi
  const viewerId = req.user._id;

  const story = await Story.findById(storyId);
  if (!story) {
    return res.status(404).json({
      success: false,
      message: "Story not found",
    });
  }

  // ❌ apni khud ki story view count me mat jodo
  if (story.userId.toString() === viewerId.toString()) {
    return res.json({ success: true });
  }

  // 🔍 Find the specific media
  const media = story.media.id(mediaId);
  if (!media) {
    return res.status(404).json({
      success: false,
      message: "Media not found in story",
    });
  }

  // ❌ already viewed hai to dubara mat add karo
  const alreadyViewed = media.views?.some(
    v => v.userId.toString() === viewerId.toString()
  );

  if (!alreadyViewed) {
    media.views.push({
      userId: viewerId,
      viewedAt: new Date(),
    });
    await story.save();
  }

  res.json({
    success: true,
    totalViews: media.views.length,
  });
});

// ✅ Get views for specific media
const getStoryViews = asyncHandler(async (req, res) => {
  const { storyId, mediaId } = req.params; // 👈 mediaId param se aayegi
  const userId = req.user._id;

  const story = await Story.findById(storyId);

  if (!story) {
    return res.status(404).json({
      success: false,
      message: "Story not found",
    });
  }

  // 🔒 sirf story owner hi viewers dekh sakta hai
  if (story.userId.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to view story insights",
    });
  }

  // 🔍 Find the specific media
  const media = story.media.id(mediaId);
  if (!media) {
    return res.status(404).json({
      success: false,
      message: "Media not found in story",
    });
  }

  // Populate user details
  await story.populate({
    path: 'media.views.userId',
    select: 'fullName profilePicture accountType accountStatus sadhuName tirthName businessName'
  });

  // Get the populated media again
  const populatedMedia = story.media.id(mediaId);

  res.json({
    success: true,
    totalViews: populatedMedia.views.length,
    viewers: populatedMedia.views.map(v => {
      let displayName = 'User';
      
      if (v.userId.accountType === 'business' && v.userId.businessName) {
        displayName = v.userId.businessName;
      } else if (v.userId.accountType === 'sadhu' && v.userId.sadhuName) {
        displayName = v.userId.sadhuName;
      } else if (v.userId.accountType === 'tirth' && v.userId.tirthName) {
        displayName = v.userId.tirthName;
      } else if (v.userId.fullName) {
        displayName = v.userId.fullName;
      }

      return {
        _id: v.userId._id,
        name: displayName,
        accountType: v.userId.accountType,
        profilePicture: v.userId.profilePicture,
        viewedAt: v.viewedAt,
      };
    }),
  });
});
// Like / Unlike specific story media
const toggleStoryMediaLike = asyncHandler(async (req, res) => {
  const { storyId, mediaId } = req.params;
  const userId = req.user._id;

  const story = await Story.findById(storyId);
  if (!story) {
    return res.status(404).json({
      success: false,
      message: "Story not found",
    });
  }

  const media = story.media.id(mediaId);
  if (!media) {
    return res.status(404).json({
      success: false,
      message: "Media not found in story",
    });
  }

  const alreadyLikedIndex = media.likes.findIndex(
    like => like.userId.toString() === userId.toString()
  );

  let isLiked;

  if (alreadyLikedIndex !== -1) {
    // ❌ UNLIKE
    media.likes.splice(alreadyLikedIndex, 1);
    isLiked = false;
  } else {
    // ❤️ LIKE
    media.likes.push({ userId });
    isLiked = true;
  }

  await story.save();

  res.json({
    success: true,
    isLiked,
    totalLikes: media.likes.length,
  });
});
const getStoryMediaLikes = asyncHandler(async (req, res) => {
  const { storyId, mediaId } = req.params;

  const story = await Story.findById(storyId).populate({
    path: 'media.likes.userId',
    select: 'fullName profilePicture accountType businessName sadhuName tirthName',
  });

  if (!story) {
    return res.status(404).json({
      success: false,
      message: "Story not found",
    });
  }

  const media = story.media.id(mediaId);
  if (!media) {
    return res.status(404).json({
      success: false,
      message: "Media not found",
    });
  }

  res.json({
    success: true,
    totalLikes: media.likes.length,
    likes: media.likes.map(like => {
      const u = like.userId;
      return {
        _id: u._id,
        name:
          u.accountType === 'business'
            ? u.businessName
            : u.accountType === 'sadhu'
            ? u.sadhuName
            : u.accountType === 'tirth'
            ? u.tirthName
            : u.fullName,
        profilePicture: u.profilePicture,
        likedAt: like.likedAt,
      };
    }),
  });
});
// Add Comment on specific story media
const addStoryMediaComment = asyncHandler(async (req, res) => {
  const { storyId, mediaId } = req.params;
  const { text } = req.body;
  const userId = req.user._id;

  if (!text || !text.trim()) {
    return res.status(400).json({
      success: false,
      message: "Comment text is required",
    });
  }

  const story = await Story.findById(storyId);
  if (!story) {
    return res.status(404).json({
      success: false,
      message: "Story not found",
    });
  }

  const media = story.media.id(mediaId);
  if (!media) {
    return res.status(404).json({
      success: false,
      message: "Media not found",
    });
  }

  media.comments.push({
    userId,
    text: text.trim(),
  });

  await story.save();

  res.status(201).json({
    success: true,
    message: "Comment added successfully",
    totalComments: media.comments.length,
  });
});

// Delete comment from story media
const deleteStoryMediaComment = asyncHandler(async (req, res) => {
  const { storyId, mediaId, commentId } = req.params;
  const userId = req.user._id;

  const story = await Story.findById(storyId);
  if (!story) {
    return res.status(404).json({
      success: false,
      message: "Story not found",
    });
  }

  const media = story.media.id(mediaId);
  if (!media) {
    return res.status(404).json({
      success: false,
      message: "Media not found",
    });
  }

  const comment = media.comments.id(commentId);
  if (!comment) {
    return res.status(404).json({
      success: false,
      message: "Comment not found",
    });
  }

  // 🔒 Only comment owner or story owner can delete
  if (
    comment.userId.toString() !== userId.toString() &&
    story.userId.toString() !== userId.toString()
  ) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to delete this comment",
    });
  }

  comment.remove();

  await story.save();

  res.json({
    success: true,
    message: "Comment deleted successfully",
    totalComments: media.comments.length,
  });
});

const getStoryMediaComments = asyncHandler(async (req, res) => {
  const { storyId, mediaId } = req.params;

  const story = await Story.findById(storyId).populate({
    path: "media.comments.userId",
    select:
      "fullName profilePicture accountType businessName sadhuName tirthName",
  });

  if (!story) {
    return res.status(404).json({
      success: false,
      message: "Story not found",
    });
  }

  const media = story.media.id(mediaId);
  if (!media) {
    return res.status(404).json({
      success: false,
      message: "Media not found",
    });
  }

  res.json({
    success: true,
    totalComments: media.comments.length,
    comments: media.comments.map((c) => {
      const u = c.userId;
      return {
        _id: c._id,
        userId: u._id,
        name:
          u.accountType === "business"
            ? u.businessName
            : u.accountType === "sadhu"
              ? u.sadhuName
              : u.accountType === "tirth"
                ? u.tirthName
                : u.fullName,
        profilePicture: u.profilePicture,
        text: c.text,
        createdAt: c.createdAt,
      };
    }),
  });
});
// ✅ Mute a user's stories
const muteStoryUser = asyncHandler(async (req, res) => {
  const { userId } = req.params; // jis user ko mute karna hai
  const currentUserId = req.user._id;

  if (String(userId) === String(currentUserId)) {
    return res.status(400).json({
      success: false,
      message: "Aap apni khud ki story mute nahi kar sakte",
    });
  }

  const user = await User.findById(currentUserId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // Check karo already muted hai ya nahi
  const alreadyMuted = user.mutedStoryUsers.some(
    (id) => String(id) === String(userId)
  );

  if (alreadyMuted) {
    return res.status(400).json({
      success: false,
      message: "Ye user already muted hai",
    });
  }

  user.mutedStoryUsers.push(userId);
  await user.save();

  res.status(200).json({
    success: true,
    message: "User ki stories mute kar di gayi hain",
    mutedUserId: userId,
  });
});

// ✅ Unmute a user's stories
const unmuteStoryUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const currentUserId = req.user._id;

  const user = await User.findById(currentUserId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // ✅ isMuted check hatao, directly filter karo
  user.mutedStoryUsers = user.mutedStoryUsers.filter(
    (id) => String(id) !== String(userId),
  );
  await user.save();

  res.status(200).json({
    success: true,
    message: "User stories unmuted successfully",
    unmutedUserId: userId,
  });
});

// ✅ Get all muted users list
const getMutedStoryUsers = asyncHandler(async (req, res) => {
  const currentUserId = req.user._id;

  const user = await User.findById(currentUserId).populate({
    path: "mutedStoryUsers",
    select:
      "fullName profilePicture accountType businessName sadhuName tirthName",
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const mutedList = user.mutedStoryUsers.map((u) => ({
    _id: u._id,
    name:
      u.accountType === "business"
        ? u.businessName
        : u.accountType === "sadhu"
        ? u.sadhuName
        : u.accountType === "tirth"
        ? u.tirthName
        : u.fullName,
    profilePicture: u.profilePicture,
  }));

  res.status(200).json({
    success: true,
    totalMuted: mutedList.length,
    mutedUsers: mutedList,
  });
});

// ✅ Check karo koi specific user muted hai ya nahi
const checkMuteStatus = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const currentUserId = req.user._id;

  const user = await User.findById(currentUserId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const isMuted = user.mutedStoryUsers.some(
    (id) => String(id) === String(userId)
  );

  res.status(200).json({
    success: true,
    isMuted,
    userId,
  });
});
module.exports = {
  createStory,
  getAllStories,
  getStoriesByUser,
  deleteStory,
  deleteStoryMedia,
  adminDeleteStory,
  viewStory,
  getStoryViews,
  toggleStoryMediaLike,
  getStoryMediaLikes,
  addStoryMediaComment,
  deleteStoryMediaComment,
  getStoryMediaComments,
  muteStoryUser,
  unmuteStoryUser,
  getMutedStoryUsers,
  checkMuteStatus,
};

// exports.createStory = async (req, res) => {
//     try {
//         console.log("Request Body:", req.body);
//         console.log("Uploaded File(s):", req.files);
//         const { userId, type } = req.body;
//         const mediaFiles = req.files ? req.files.map(file => file.filename) : [];
//         if (!userId || !type) {
//             return res.status(400).json({ message: "User ID and Type are required" });
//         }
//         if (mediaFiles.length === 0) {
//             return res.status(400).json({ message: "At least one file is required" });
//         }
//         const newStory = new Story({ userId, media: mediaFiles, type });
//         await newStory.save();
//         res.status(201).json({ message: "Story uploaded successfully", story: newStory });
//     } catch (error) {
//         console.error("Error creating story:", error); // Log the error
//         res.status(500).json({ message: "Internal Server Error", error: error.message });
//     }
// };
// exports.getAllStories = async (req, res) => {
//     try {
//         const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
//         // Fetch only stories from the last 24 hours
//         const stories = await Story.find({ createdAt: { $gte: twentyFourHoursAgo } })
//             .populate("userId", "profilePicture firstName lastName");
//         res.status(200).json(stories);
//     } catch (error) {
//         console.error("Error fetching stories:", error);
//         res.status(500).json({ message: "Internal Server Error" });
//     }
// };


// exports.getStoriesByUser = async (req, res) => {
//     try {
//         const { userId } = req.params;
//         const stories = await Story.find({ userId });
//         if (!stories.length) {
//             return res.status(404).json({ message: 'No stories found for this user' });
//         }
//         res.json(stories);
//     } catch (error) {
//         console.error('Error fetching user stories:', error);
//         res.status(500).json({ message: 'Internal Server Error' });
//     }
// };

// exports.deleteStory = async (req, res) => {
//     try {
//         const { userId, storyId } = req.params;
//         // console.log("Attempting to delete story...");
//         // console.log(" Story ID:", storyId);
//         // console.log(" User ID:", userId);
//     const story = await Story.findOne({ _id: storyId, userId });
//         if (!story) {
//             console.log("Story not found or unauthorized!");
//             return res.status(404).json({ message: "Story not found or unauthorized" });
//         }
//         //  Delete the story
//         await Story.findByIdAndDelete(storyId);
//         console.log(" Story deleted successfully from DB");
//         //  Remove story reference from User
//         await User.findByIdAndUpdate(userId, { $pull: { story: storyId } });
//         console.log("Story removed from user's list");
//         return res.json({ message: "Story deleted successfully" });
//     } catch (error) {
//         console.error(" Error deleting story:", error);
//         return res.status(500).json({ message: "Internal Server Error", error: error.message });
//     }
// };
