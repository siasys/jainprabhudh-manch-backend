const expressAsyncHandler = require('express-async-handler');
const Notification = require('../../model/SocialMediaModels/notificationModel');
const {getIo}  = require('../../websocket/socket');
const Block = require('../../model/Block User/Block');

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

    // ⭐ Blocked Users List (Two-way block)
    const blockRelations = await Block.find({
      $or: [{ blocker: userId }, { blocked: userId }]
    }).lean();

    const blockedUsers = blockRelations.map(rel =>
      rel.blocker.toString() === userId.toString()
        ? rel.blocked.toString()
        : rel.blocker.toString()
    );

    // ⭐ Fetch all notifications
    let notifications = await Notification.find({ receiverId: userId })
      .sort({ createdAt: -1 })
      .populate({
        path: "senderId",
        select:
          "firstName lastName fullName profilePicture privacy accountType businessName sadhuName tirthName",
      })
      .populate({
        path: "postId",
        select: "media",
      })
      .lean();

    // ⭐ Filter notifications where sender is blocked or has blocked you
    notifications = notifications.filter(n => {
      if (!n.senderId) return false; // handle deleted user

      const senderId = n.senderId._id.toString();
      return !blockedUsers.includes(senderId);
    });

    res.status(200).json({
      success: true,
      count: notifications.length,
      notifications,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
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
// 🔹 Notification Delete Karna (By Notification ID)
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    if (!notificationId) {
      return res.status(400).json({ success: false, message: "Notification ID is required" });
    }

    const deletedNotification = await Notification.findByIdAndDelete(notificationId);

    if (!deletedNotification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
      deletedNotification,
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
};