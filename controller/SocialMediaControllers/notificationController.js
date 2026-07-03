const expressAsyncHandler = require("express-async-handler");
const Notification = require("../../model/SocialMediaModels/notificationModel");
const { getIo } = require("../../websocket/socket");
const Block = require("../../model/Block User/Block");
const Story = require("../../model/SocialMediaModels/storyModel");
const Post = require("../../model/SocialMediaModels/postModel");
// Notification Send Karna
exports.sendNotification = async (req, res) => {
  try {
    const { senderId, receiverId, type, message, postId } = req.body;

    if (!senderId || !receiverId || !type || !message) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
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
    io.to(receiverId.toString()).emit("newNotification", notification);

    res
      .status(201)
      .json({
        success: true,
        message: "Notification sent successfully",
        notification,
      });
  } catch (error) {
    console.error("Error sending notification:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to send notification" });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    const blockRelations = await Block.find({
      $or: [{ blocker: userId }, { blocked: userId }],
    }).lean();

    const blockedUsers = blockRelations.map((rel) =>
      rel.blocker.toString() === userId.toString()
        ? rel.blocked.toString()
        : rel.blocker.toString(),
    );

    let notifications = await Notification.find({ receiverId: userId })
      .sort({ createdAt: -1 })
      .populate({
        path: "senderId",
        select:
          "firstName lastName fullName profilePicture privacy accountType businessName sadhuName tirthName",
      })
      .lean();

    notifications = notifications.filter((n) => {
      if (!n.senderId) return false;
      const senderId = n.senderId._id.toString();
      return !blockedUsers.includes(senderId);
    });

    // ✅ like/comment/mention ke liye storyId ya postId se data fetch karo
    notifications = await Promise.all(
      notifications.map(async (notif) => {
        // ✅ STORY notification (like, comment, mention) - storyId field use karo
        if (notif.storyId) {
          try {
            const story = await Story.findById(notif.storyId)
              .select("media")
              .lean();

            if (story) {
              // ✅ Agar mediaId hai to sirf wahi media bhejo
              if (notif.mediaId) {
                const specificMedia = story.media.find(
                  (m) => m._id.toString() === notif.mediaId.toString(),
                );
                notif.storyData = {
                  _id: story._id,
                  media: specificMedia ? [specificMedia] : story.media,
                };
              } else {
                notif.storyData = story;
              }
            }
          } catch (e) {
            console.error("Story fetch error:", e);
          }
        }

        // ✅ POST notification (like, comment) - postId field use karo
        else if (notif.postId) {
          try {
            const post = await Post.findById(notif.postId)
              .select("media")
              .lean();
            if (post) {
              notif.postData = post;
            }
          } catch (e) {
            console.error("Post fetch error:", e);
          }
        }

        // ✅ NEW: Collaborator invite ke liye current user ka status resolve karo
        // (frontend ko pata chale ki pehle se accept/reject ho chuka hai ya nahi)
        if (notif.type === "collaborator_invite" && notif.postId) {
          try {
            const collabPost = await Post.findById(notif.postId)
              .select("collaborators")
              .lean();
            if (collabPost && Array.isArray(collabPost.collaborators)) {
              const myEntry = collabPost.collaborators.find(
                (c) =>
                  c.user && c.user.toString() === notif.receiverId.toString(),
              );
              if (myEntry) {
                // "pending" | "accepted" | "rejected"
                notif._collabStatus = myEntry.status;
              } else {
                // Post exists but user removed from collab list
                notif._collabStatus = "removed";
              }
            }
          } catch (e) {
            console.error("Collab status fetch error:", e);
          }
        }

        return notif;
      }),
    );

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
      { $set: { isRead: true } },
    );

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to mark notifications as read",
      });
  }
};
// Notification Delete Karna (By Notification ID)
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    if (!notificationId) {
      return res
        .status(400)
        .json({ success: false, message: "Notification ID is required" });
    }

    const deletedNotification =
      await Notification.findByIdAndDelete(notificationId);

    if (!deletedNotification) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
      deletedNotification,
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete notification" });
  }
};
// ✅ NEW: Collaborator invite ka Accept / Reject handler
// Frontend se { notificationId, action: "accept" | "reject" } POST hoga
exports.respondToCollaboratorInvite = async (req, res) => {
  try {
    const { notificationId, action } = req.body;
    const currentUserId = req.user?.id || req.user?._id || req.body.userId;

    if (!notificationId || !action) {
      return res.status(400).json({
        success: false,
        message: "notificationId aur action required hai",
      });
    }
    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "action sirf 'accept' ya 'reject' ho sakti hai",
      });
    }

    const notif = await Notification.findById(notificationId);
    if (!notif) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }
    if (notif.type !== "collaborator_invite") {
      return res.status(400).json({
        success: false,
        message: "Ye notification collaborator invite nahi hai",
      });
    }

    // Sirf receiver hi accept/reject kar sakta hai
    if (
      currentUserId &&
      notif.receiverId.toString() !== currentUserId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Aap ye invite respond nahi kar sakte",
      });
    }

    // Post me collaborator entry update karo
    const post = await Post.findById(notif.postId);
    if (!post) {
      return res
        .status(404)
        .json({ success: false, message: "Post not found (deleted?)" });
    }

    const collabEntry = post.collaborators.find(
      (c) => c.user && c.user.toString() === notif.receiverId.toString(),
    );
    if (!collabEntry) {
      return res
        .status(404)
        .json({ success: false, message: "Collab entry not found on post" });
    }

    if (collabEntry.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Aapne already ${collabEntry.status} kiya hai`,
      });
    }

    collabEntry.status = action === "accept" ? "accepted" : "rejected";
    collabEntry.respondedAt = new Date();
    await post.save();

    // Original poster ko reply notification bhejo (FCM auto via hook)
    try {
      await Notification.create({
        senderId: notif.receiverId, // jisne response diya
        receiverId: notif.senderId, // original poster
        type:
          action === "accept"
            ? "collaborator_accepted"
            : "collaborator_rejected",
        postId: notif.postId,
        message:
          action === "accept"
            ? "accepted your collaboration invite"
            : "declined your collaboration invite",
      });
    } catch (e) {
      console.log("⚠️ reply notification failed:", e.message);
    }

    // Ye invite notification ab actionable nahi rahi — read mark kar do
    notif.isRead = true;
    await notif.save();

    return res.status(200).json({
      success: true,
      message: `Invite ${action}ed successfully`,
      status: collabEntry.status,
    });
  } catch (error) {
    console.error("respondToCollaboratorInvite error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to respond to collaborator invite",
    });
  }
};
