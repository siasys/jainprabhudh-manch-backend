const Story = require('../../model/SocialMediaModels/storyModel');
const User = require('../../model/UserRegistrationModels/userModel');
const asyncHandler = require("express-async-handler");
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const StoryReport = require('../../model/SocialMediaModels/StoryReport')
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const Friendship = require('../../model/SocialMediaModels/friendshipModel')

const createStory = asyncHandler(async (req, res) => {
  try {
    let { type, sanghId, isSanghStory, mentionUsers, text, textStyle } = req.body;
    const userId = req.user._id;
    const userType = req.user.type;

    // 🧩 Parse JSON strings
    const safeParse = (data) => {
      if (typeof data === 'string') {
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

    // 🖼️ Convert S3 to CDN URLs
    const mediaFiles = req.files
      ? req.files.map((file) => convertS3UrlToCDN(file.location))
      : [];

    if (mediaFiles.length === 0 && !text?.length) {
      return res.status(400).json({
        success: false,
        message: 'Either media or text is required for story',
      });
    }

    // 🎞️ Build media array
    const mediaArray = mediaFiles.map((fileUrl, index) => ({
      url: fileUrl,
      type: type || 'image',
      text: Array.isArray(text) ? text[index] || '' : text || '',
      textStyle: Array.isArray(textStyle) ? textStyle[index] || {} : textStyle || {},
      mentionUsers: Array.isArray(mentionUsers)
        ? mentionUsers
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id))
        : [],
    }));

    // ✏️ Handle text-only story (no media)
    if (mediaArray.length === 0 && text?.length > 0) {
      mediaArray.push({
        url: '',
        type: 'text',
        text: text || '',
        textStyle: textStyle || {},
        mentionUsers: Array.isArray(mentionUsers)
          ? mentionUsers
              .filter((id) => mongoose.Types.ObjectId.isValid(id))
              .map((id) => new mongoose.Types.ObjectId(id))
          : [],
      });
    }

    // 🕒 Find if story already exists (within 24 hours)
    const existingStory = await Story.findOne({
      userId,
      isSanghStory: isSanghStory === 'true',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    let savedStory;
    if (existingStory) {
      // 🟢 Append new media to existing story
      existingStory.media.push(...mediaArray);
      savedStory = await existingStory.save();
    } else {
      // 🆕 Create new story
      const newStory = new Story({
        userId,
        sanghId: isSanghStory ? sanghId : null,
        isSanghStory: isSanghStory === 'true',
        media: mediaArray,
      });
      savedStory = await newStory.save();
    }

    // 👥 Update references
    if (userType === 'user') {
      await User.findByIdAndUpdate(userId, { story: savedStory._id });
    } else if (userType === 'sangh' && sanghId) {
      await HierarchicalSangh.findByIdAndUpdate(sanghId, {
        $addToSet: { stories: savedStory._id },
      });
    }

    // ✅ Populate mentionUsers for response
    const populatedStory = await Story.findById(savedStory._id)
      .populate('userId', 'fullName profilePicture')
      .populate('media.mentionUsers', 'fullName profilePicture');

    res.status(201).json({
      success: true,
      message: existingStory
        ? 'New media added to existing story'
        : 'New story created successfully',
      data: populatedStory,
    });
  } catch (error) {
    console.error('❌ Error creating/updating story:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating or updating story',
      error: error.message,
    });
  }
});
// Get All Stories
const getAllStories = asyncHandler(async (req, res) => {
  try {
    const userId = req.query.userId || req.user.id;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1️⃣ Users jise "main" follow karta hoon
    const followingList = await Friendship.find({
      follower: userId,
      followStatus: "following",
    }).select("following");

    // 2️⃣ Users jinhone "mujhe" follow kiya hai
    const followerList = await Friendship.find({
      following: userId,
      followStatus: "following",
    }).select("follower");

    const followingIds = followingList.map(f => f.following.toString());
    const followerIds = followerList.map(f => f.follower.toString());

    // ✅ Unique userIds collect karo (Set se duplicates hatao)
    const storyUserIds = new Set([...followingIds, ...followerIds, userId]);

    // 🔍 Ab in users ki stories fetch karo
    const stories = await Story.find({
      createdAt: { $gte: twentyFourHoursAgo },
      userId: { $in: Array.from(storyUserIds) },
    })
      .populate("userId", "profilePicture firstName lastName fullName")
      .populate("sanghId", "name sanghImage");

    res.status(200).json({
      success: true,
      count: stories.length,
      data: stories,
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




// Get Stories by User
const getStoriesByUser = asyncHandler(async (req, res) => {
    try {
        const { userId } = req.params;
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const stories = await Story.find({
            userId,
            createdAt: { $gte: twentyFourHoursAgo }
        }).populate("userId", "profilePicture firstName lastName fullName")
          .populate("sanghId", "name sanghImage");

        if (!stories.length) {
            return errorResponse(res, 'No active stories found for this user', 404);
        }
        const cdnStories = stories.map(story => ({
            ...story.toObject(),
            media: story.media.map(url => convertS3UrlToCDN(url))
          }));
          
        return successResponse(res, cdnStories, "Stories fetched successfully", 200);
    } catch (error) {
        console.error('Error fetching user stories:', error);
        return errorResponse(res, 'Error fetching user stories', 500, error.message);
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
// delete story on media
const deleteStoryMedia = asyncHandler(async (req, res) => {
  try {
    const { storyId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    const { mediaUrl } = req.body;

    const normalizedMediaUrl = decodeURIComponent(mediaUrl).trim();

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

    const updatedMedia = story.media.filter(url => url.trim() !== normalizedMediaUrl);

    if (updatedMedia.length === 0) {
      // Delete entire story
      await Story.findByIdAndDelete(storyId);

      // Remove story reference from User
      await User.findByIdAndUpdate(story.userId, {
        $pull: { story: storyId }
      });

      // Delete related story reports
      await StoryReport.deleteMany({ storyId: storyId });

      return res.json({
        success: true,
        message: "Story and related reports deleted successfully"
      });
    }

    story.media = updatedMedia;
    story.markModified('media');
    await story.save();

    res.json({
      success: true,
      message: "Media deleted successfully",
      data: story
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


module.exports = {
    createStory,
    getAllStories,
    getStoriesByUser,
    deleteStory,
    deleteStoryMedia
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
