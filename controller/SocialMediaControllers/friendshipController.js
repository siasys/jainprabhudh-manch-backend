const Friendship = require('../../model/SocialMediaModels/friendshipModel');
const asyncHandler = require('express-async-handler');
const Notification = require('../../model/SocialMediaModels/notificationModel');
const User = require('../../model/UserRegistrationModels/userModel');
const expressAsyncHandler = require('express-async-handler');

// Follow a user (Modified with User Model Friends Array)
const followUser = asyncHandler(async (req, res) => {
    const { followerId, followingId, followStatus } = req.body;
    // Check if the friendship already exists
    const existingFriendship = await Friendship.findOne({ follower: followerId, following: followingId });
    if (existingFriendship) {
        return res.status(400).json({ message: 'Already following this user' });
    }
    // Create new friendship
    const newFriendship = await Friendship.create({
        follower: followerId,
        following: followingId,
       followStatus: followStatus || 'following'
    });
    // Add following user to follower's friends list
    await User.findByIdAndUpdate(followerId, {
        $addToSet: { friends: followingId } // Prevents duplicate entries
    });
    await User.findByIdAndUpdate(followingId, {
        $addToSet: { friends: followerId }
    });

    res.status(201).json({ message: 'User followed successfully', friendship: newFriendship });
});

const getFollowRequests = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const requests = await Friendship.find({ following: userId, followStatus: 'following' })
        .populate('follower', 'firstName lastName fullName profilePicture accountType businessName');
    res.json({ success: true, requests });
});

// Get Follow Status Between Two Users
const getFollowStatus = asyncHandler(async (req, res) => {
    const { followerId, followingId } = req.params;
    const friendship = await Friendship.findOne({ follower: followerId, following: followingId });
    if (!friendship) {
        return res.json({ followStatus: 'none' });
    }
    res.json({ followStatus: friendship.followStatus });
});

// Unfollow a user
const unfollowUser = asyncHandler(async (req, res) => {
    const { followerId, followingId } = req.body;
    console.log("Unfollow Request Received:", followerId, followingId);
    const friendship = await Friendship.findOneAndDelete({ follower: followerId, following: followingId });
    if (!friendship) {
        return res.status(404).json({ message: "Follow relationship not found" });
    }
    try {
        // Remove from follower's friends list
        await User.findByIdAndUpdate(followerId, {
            $pull: { friends: followingId }
        });
        // Optionally, remove from following user's friends list
        await User.findByIdAndUpdate(followingId, {
            $pull: { friends: followerId }
        });
        // Follow notification delete
        const notificationToDelete = await Notification.findOne({
            senderId: followerId,
            receiverId: followingId,
            type: "follow",
        });
        if (notificationToDelete) {
            await Notification.deleteOne({ _id: notificationToDelete._id });
            return res.status(200).json({
                message: "User unfollowed successfully, follow notification removed",
                followStatus: "unfollow",
                notificationDeleted: true,
            });
        } else {
            return res.status(200).json({
                message: "User unfollowed successfully, but no follow notification found",
                followStatus: "unfollow",
            });
        }
    } catch (error) {
        console.error("Error deleting notification or updating friends list:", error);
        return res.status(500).json({ message: "Error deleting notification or updating friends list" });
    }
});

const getFollowers = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  try {
    const followers = await Friendship.find({ following: userId })
      .populate('follower', 'firstName lastName fullName profilePicture accountType businessName');

    res.status(200).json({
      success: true,
      count: followers.length,
      followers: followers.map(f => {
        const follower = f.follower;
        return {
          id: follower._id,
          firstName: follower.firstName,
          lastName: follower.lastName,
          fullName: follower.fullName,
          profilePicture: follower.profilePicture,
          followStatus: f.followStatus,
          accountType: follower.accountType,
          businessName: follower.businessName,
          displayName: follower.accountType === "business"
            ? follower.businessName
            : follower.fullName,
        };
      })
    });
  } catch (error) {
    console.error("Error fetching followers:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

const getFollowing = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  try {
    const following = await Friendship.find({ follower: userId })
      .populate('following', 'firstName lastName fullName profilePicture accountType businessName');

    // 🔐 Filter out any broken references (null following)
    const validFollowing = following.filter(f => f.following);

    res.status(200).json({
      success: true,
      count: validFollowing.length,
      following: validFollowing.map(f => {
        const user = f.following;
        return {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          profilePicture: user.profilePicture,
          followStatus: f.followStatus,
          accountType: user.accountType,
          businessName: user.businessName,
          displayName: user.accountType === "business"
            ? user.businessName
            : user.fullName,
        };
      })
    });
  } catch (error) {
    console.error("Error fetching following:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Check if a user is following another user
const checkFollowStatus = asyncHandler(async (req, res) => {
    const { followerId, followingId } = req.body;
    const existingFriendship = await Friendship.findOne({ follower: followerId, following: followingId });
    if (existingFriendship) {
        return res.status(200).json({ status: existingFriendship.status });
    }
    return res.status(200).json({ status: 'not-following' });
});

// Accept a follow request
const acceptFollowRequest = asyncHandler(async (req, res) => {
    const { followerId, followingId } = req.body;

    const updatedFriendship = await Friendship.findOneAndUpdate(
        { follower: followerId, following: followingId, followStatus: 'pending' },
        { followStatus: 'following' },
        { new: true }
    );
    if (!updatedFriendship) {
        return res.status(404).json({ message: 'Follow request not found or already accepted' });
    }
    await User.findByIdAndUpdate(followerId, {
        $addToSet: { friends: followingId }
    });
    await User.findByIdAndUpdate(followingId, {
        $addToSet: { friends: followerId }
    });
    res.status(200).json({ message: 'Follow request accepted', friendship: updatedFriendship });
});
const rejectFollowRequest = expressAsyncHandler(async (req, res) => {
  const { followerId, followingId } = req.body;

  // Find the existing request with 'pending' status
  const existingRequest = await Friendship.findOne({
    follower: followerId,
    following: followingId,
    followStatus: 'pending',
  });

  if (!existingRequest) {
    return res.status(404).json({
      success: false,
      message: 'No pending follow request found.',
    });
  }

  // Convert followStatus to 'following'
  existingRequest.followStatus = 'following';
  await existingRequest.save();

  res.status(200).json({
    success: true,
    message: 'Follow request rejected, now marked as following.',
  });
});
module.exports = {
    followUser,
    getFollowRequests,
    unfollowUser,
    getFollowers,
    getFollowing,
    checkFollowStatus,
    acceptFollowRequest,
    getFollowStatus,
    rejectFollowRequest
};
