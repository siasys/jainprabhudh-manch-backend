const expressAsyncHandler = require('express-async-handler');
const Notification = require('../../model/SocialMediaModels/notificationModel');
const {getIo}  = require('../../websocket/socket');

// Notification Send Karna
exports.sendNotification = async (req, res) => {
  try {
    const { senderId, receiverId, type, message, postId } = req.body;

    if (!senderId || !receiverId || !type || !message) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    const notification = new Notification({
      senderId,
      receiverId,
      type,
      message,
      postId: postId || null, // optional, only for like/comment
    });

    await notification.save();

    const io = getIo();
    io.to(receiverId.toString()).emit('newNotification', notification);

    res.status(201).json({ success: true, message: 'Notification sent successfully', notification });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ success: false, message: 'Failed to send notification' });
  }
};


//  Notification Fetch Karna (User ke liye)
exports.getNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const notifications = await Notification.find({ receiverId: userId })
      .sort({ createdAt: -1 })
      .populate({
        path: "senderId",
        select: "firstName lastName fullName profilePicture privacy",
      })
      .populate({
        path: "postId",
        select: "media",
      });

    res.status(200).json({ success: true, notifications });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

//  Notification Read Mark Karna
exports.markAllNotificationsRead = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await Notification.updateMany(
      { receiverId: userId, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
  }
};
exports.rejectFollowRequest = expressAsyncHandler(async (req, res) => {
  const { followerId, followingId } = req.body;

  const existingRequest = await Friendship.findOne({
    follower: followerId,
    following: followingId,
    followStatus: 'following',
  });

  if (!existingRequest) {
    return res.status(404).json({
      success: false,
      message: 'No pending follow request found.',
    });
  }

  // ✅ Convert to 'following'
  existingRequest.followStatus = 'following';
  await existingRequest.save();

  res.status(200).json({
    success: true,
    message: 'Follow request converted to following.',
  });
});