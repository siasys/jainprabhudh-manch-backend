// controllers/messageController.js
const {
  Message,
  encrypt,
  decrypt,
} = require("../../model/SocialMediaModels/messageModel");
const User = require("../../model/UserRegistrationModels/userModel");
const Conversation = require("../../model/SocialMediaModels/conversationModel");
const HierarchicalSangh = require("../../model/SanghModels/hierarchicalSanghModel");
const Post = require("../../model/SocialMediaModels/postModel");
const mongoose = require("mongoose");
const { getIo, getUserStatus } = require("../../websocket/socket");
const { s3Client, DeleteObjectCommand } = require("../../config/s3Config");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { getOrSetCache, invalidateCache } = require("../../utils/cache");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
const expressAsyncHandler = require("express-async-handler");
const { containsBadWords } = require("../../utils/filterBadWords");
const { sendPushToUsers } = require("../../config/firebaseAdmin");

exports.sharePost = async (req, res) => {
  try {
    const sender = req.body.sender?.toString();
    const receiver = req.body.receiver?.toString();
    const postId = req.body.postId;
    const optionalText = req.body.optionalText || "";

    if (!postId) {
      return res.status(400).json({ message: "postId is required" });
    }
    if (!sender || !receiver) {
      return res
        .status(400)
        .json({ message: "sender and receiver are required" });
    }

    // ✅ Authorization check
    if (sender !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Sender ID must match authenticated user",
      });
    }

    const receiverUser = await User.findById(receiver);
    if (!receiverUser) {
      return res.status(404).json({ message: "Receiver User not found" });
    }

    //  Block check
    if (receiverUser?.blockedUsers?.includes(sender)) {
      return res.status(403).json({
        success: false,
        message: "You are blocked by this user. Cannot share post.",
      });
    }

    // Find Post
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // ✅ Prepare attachments (based on postType)
    const attachments = [];

    if (
      post.postType === "media" &&
      Array.isArray(post.media) &&
      post.media.length > 0
    ) {
      // Image / Video posts
      post.media.forEach((m) => {
        if (m.url) {
          attachments.push({
            type: m.type === "video" ? "video" : "image",
            url: m.url,
            thumbnail: m.thumbnail || "",
            name: `shared_${m.type}.${m.type === "video" ? "mp4" : "jpg"}`,
            size: 0,
          });
        }
      });
    } else if (post.postType === "text") {
      // Text post as attachment
      attachments.push({
        type: "text",
        content: post.caption || post.text || "",
      });
    } else if (post.postType === "poll") {
      // Poll type post
      attachments.push({
        type: "poll",
        question: post.poll?.question || "",
        options: post.poll?.options || [],
      });
    }

    // ✅ Create new message
    const messageData = {
      sender,
      receiver,
      messageType: "post",
      post: post._id,
      message: optionalText, // optional caption text
      attachments,
      createdAt: new Date(),
    };

    const newMessage = new Message(messageData);
    await newMessage.save();

    // ✅ Emit socket to receiver
    const io = getIo();
    io.to(receiver.toString()).emit("newMessage", {
      message: newMessage.toObject(),
    });

    return res.status(201).json({
      success: true,
      message: newMessage,
    });
  } catch (error) {
    console.error("Error sharing post:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error sharing post" });
  }
};

exports.createMessage = async (req, res) => {
  try {
    const sender = req.body.sender.trim();
    const receiver = req.body.receiver.trim();
    const message = req.body.message;
    const senderType = req.body.senderType || req.user.type;
    const receiverType = req.body.receiverType || "user";
    // ✅ reply (optional) — kis message ka jawaab hai
    const replyToId =
      req.body.replyTo && mongoose.Types.ObjectId.isValid(req.body.replyTo)
        ? req.body.replyTo
        : null;
    // 1. Validate message
    if (!message || message.trim() === "") {
      return res.status(400).json({ message: "Message cannot be empty" });
    }
    if (containsBadWords(message)) {
      return res.status(400).json({
        success: false,
        message:
          "Your message contains inappropriate or unsafe words. Please modify it.",
      });
    }
    // ⚡ Sender aur receiver dono ek saath fetch (pehle ek ke baad ek hote the)
    const [senderDoc, receiverDoc] = await Promise.all([
      senderType === "sangh"
        ? HierarchicalSangh.findById(sender)
            .select("name sanghName sanghImage officeBearers")
            .lean()
        : User.findById(sender)
            .select("firstName lastName profilePicture blockedUsers")
            .lean(),
      receiverType === "sangh"
        ? HierarchicalSangh.findById(receiver).select("_id").lean()
        : User.findById(receiver).select("_id blockedUsers").lean(),
    ]);

    let senderInfo = {};
    const messageData = {
      sender,
      receiver,
      senderType,
      message: message,
      attachments: [],
      createdAt: new Date(),
    };

    if (senderType === "sangh") {
      if (!senderDoc) {
        return res.status(404).json({ message: "Sangh not found" });
      }
      const isOfficeBearer = (senderDoc.officeBearers || []).some(
        (ob) => ob.userId?.toString() === req.user._id.toString(),
      );
      if (!isOfficeBearer) {
        return res.status(403).json({
          success: false,
          message: "User not authorized to send on behalf of Sangh",
        });
      }
      messageData.sanghId = senderDoc._id;
      senderInfo = {
        _id: senderDoc._id,
        fullName: senderDoc.name || senderDoc.sanghName,
        profilePicture: senderDoc.sanghImage || null,
        type: "sangh",
      };
    } else {
      if (sender !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: "Sender ID must match authenticated user",
        });
      }
      if (!senderDoc) {
        return errorResponse(res, "Sender user not found", 404);
      }
      senderInfo = {
        _id: senderDoc._id,
        fullName: `${senderDoc.firstName} ${senderDoc.lastName}`,
        profilePicture: senderDoc.profilePicture,
        type: "user",
      };
    }

    if (!receiverDoc) {
      return errorResponse(
        res,
        receiverType === "sangh"
          ? "Receiver Sangh not found"
          : "Receiver User not found",
        400,
      );
    }

    // Receiver ne sender ko block kiya hai?
    if (
      receiverType !== "sangh" &&
      (receiverDoc.blockedUsers || []).some((id) => id.toString() === sender)
    ) {
      return res.status(403).json({
        success: false,
        message: "You are blocked by this user. Message cannot be sent.",
      });
    }

    // Sender ne receiver ko block kiya hai?
    const isBlocked =
      senderType !== "sangh" &&
      (senderDoc.blockedUsers || []).some((id) => id.toString() === receiver);

    if (req.file) {
      messageData.attachments.push({
        type: "image",
        url: convertS3UrlToCDN(req.file.location),
        name: req.file.originalname,
        size: req.file.size,
      });
    } else if (req.body.imageUrl) {
      messageData.attachments.push({
        type: "image",
        url: req.body.imageUrl,
        name: "forwarded_image.jpg",
        size: 0,
      });
    }
    const attachments = messageData.attachments;
    if (replyToId) messageData.replyTo = replyToId;

    // ⚡ Message save + reply preview + conversation update — teeno ek saath
    const newMessage = new Message(messageData);
    const upsertConversation = async () => {
      const existing = await Conversation.findOneAndUpdate(
        { participants: { $all: [sender, receiver] } },
        { $set: { lastMessage: newMessage._id } },
        { new: true, projection: { _id: 1 } },
      ).lean();
      if (existing) return existing;
      return Conversation.create({
        participants: [sender, receiver],
        lastMessage: newMessage._id,
      });
    };

    const [, rt, conversation] = await Promise.all([
      newMessage.save(),
      replyToId
        ? Message.findById(replyToId)
            .select("message sender attachments")
            .populate("sender", "firstName lastName fullName")
            .lean()
            .catch(() => null)
        : Promise.resolve(null),
      upsertConversation().catch((e) => {
        console.error("Conversation update failed:", e.message);
        return { _id: "" };
      }),
    ]);

    const replyPreview = rt
      ? {
          _id: rt._id,
          message: rt.message,
          sender: rt.sender,
          attachments: rt.attachments || [],
        }
      : null;

    // 🔊 Emit socket message
    const decryptedMessage = newMessage.decryptedMessage;
    const io = getIo();
    const responsePayload = {
      ...newMessage.toObject(),
      message: decryptedMessage,
    };
    if (replyPreview) responsePayload.replyTo = replyPreview;

    if (!isBlocked) {
      io.to(receiver.toString()).emit("newMessage", {
        message: responsePayload,
        sender: senderInfo,
      });
      // 🔔 Push notification
      const pushBody =
        decryptedMessage && decryptedMessage.trim()
          ? decryptedMessage
          : attachments.length
            ? "📷 Photo"
            : "New message";
      sendPushToUsers([receiver], {
        title: senderInfo.fullName || "New message",
        body: pushBody,
        data: {
          type: "chat",
          senderId: String(senderInfo._id || sender),
          senderName: senderInfo.fullName || "",
          conversationId: String(conversation._id || ""),
        },
      });
    }

    return successResponse(
      res,
      responsePayload,
      "Message sent successfully",
      201,
    );
  } catch (error) {
    if (req.file) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: req.file.key,
          }),
        );
      } catch (deleteError) {
        console.error("Error deleting file:", deleteError);
      }
    }
    console.error("Message creation error:", error);
    return errorResponse(res, "Error sending message", 500, error.message);
  }
};

exports.clearAllMessagesBetweenUsers = async (req, res) => {
  try {
    const userId = req.user._id;
    const receiverId = req.params.receiverId;
    const { type } = req.body; // 'me' or 'everyone'

    if (!receiverId || !["me", "everyone"].includes(type)) {
      return res
        .status(400)
        .json({ message: "receiverId and valid type (me/everyone) required" });
    }

    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (type === "me") {
      // ✅ Mark as deleted only for this user and set future deleteAt
      await Message.updateMany(
        {
          $or: [
            { sender: userId, receiver: receiverId },
            { sender: receiverId, receiver: userId },
          ],
          deletedBy: { $ne: userId },
        },
        {
          $addToSet: { deletedBy: userId },
          $set: { deleteAt: thirtyDaysFromNow },
        },
      );
    } else if (type === "everyone") {
      // ✅ Fetch messages
      const messages = await Message.find({
        $or: [
          { sender: userId, receiver: receiverId },
          { sender: receiverId, receiver: userId },
        ],
      });

      // ✅ Delete S3 attachments (but not delete messages from DB)
      for (const msg of messages) {
        for (const att of msg.attachments || []) {
          if (att.url?.includes(".com/")) {
            const key = att.url.split(".com/")[1];
            try {
              await s3Client.send(
                new DeleteObjectCommand({
                  Bucket: process.env.AWS_BUCKET_NAME,
                  Key: key,
                }),
              );
            } catch (err) {
              console.warn("S3 delete error:", key, err.message);
            }
          }
        }
      }

      // ✅ Mark as deleted for both users + set future deleteAt
      await Message.updateMany(
        {
          _id: { $in: messages.map((m) => m._id) },
        },
        {
          $addToSet: { deletedBy: { $each: [userId, receiverId] } },
          $set: { deleteAt: thirtyDaysFromNow },
        },
      );

      // Notify receiver via socket
      const io = getIo();
      io.to(receiverId.toString()).emit("allMessagesCleared", {
        senderId: userId,
      });
    }

    return res.status(200).json({ message: "Messages cleared successfully" });
  } catch (err) {
    console.error("Clear message error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PATCH /messages/block-unblock
exports.blockUnblockUser = async (req, res) => {
  try {
    const userId = req.user._id; // logged in user
    const { targetUserId, action } = req.body;

    if (!targetUserId || !["block", "unblock"].includes(action)) {
      return res
        .status(400)
        .json({
          message:
            "targetUserId and valid action (block/unblock) are required.",
        });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Block logic
    if (action === "block") {
      // Add targetUserId to blockedUsers
      if (!user.blockedUsers.includes(targetUserId)) {
        user.blockedUsers.push(targetUserId);
        await user.save();
      }

      // Update message flags
      await Message.updateMany(
        { sender: userId, receiver: targetUserId },
        { $set: { isBlockedBySender: true } },
      );
      await Message.updateMany(
        { sender: targetUserId, receiver: userId },
        { $set: { isBlockedByReceiver: true } },
      );
    } else if (action === "unblock") {
      // Remove targetUserId from blockedUsers
      user.blockedUsers = user.blockedUsers.filter(
        (id) => id.toString() !== targetUserId.toString(),
      );
      await user.save();

      // Reset flags
      await Message.updateMany(
        { sender: userId, receiver: targetUserId },
        { $set: { isBlockedBySender: false } },
      );
      await Message.updateMany(
        { sender: targetUserId, receiver: userId },
        { $set: { isBlockedByReceiver: false } },
      );
    }

    return res.status(200).json({ message: `${action} successful.` });
  } catch (error) {
    console.error("Block/Unblock error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
// GET /messages/block-status/:userId/:targetUserId
// GET /messages/block-status/:userId/:targetUserId
exports.getBlockStatus = async (req, res) => {
  try {
    const { userId, targetUserId } = req.params;

    if (!userId || !targetUserId) {
      return res
        .status(400)
        .json({ message: "Both userId and targetUserId are required" });
    }

    // Fetch user to check blockedUsers array
    const user = await User.findById(userId).select("blockedUsers");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user has blocked the targetUser
    const isBlockedByList = user.blockedUsers.includes(targetUserId);

    // Check latest message flag (optional support)
    const lastMessage = await Message.findOne({
      $or: [
        { sender: userId, receiver: targetUserId },
        { sender: targetUserId, receiver: userId },
      ],
    }).sort({ createdAt: -1 });

    const isBlockedByMessage =
      (lastMessage?.sender?.toString() === userId &&
        lastMessage?.isBlockedBySender) ||
      (lastMessage?.receiver?.toString() === userId &&
        lastMessage?.isBlockedByReceiver);

    // Final result
    const isBlocked = isBlockedByList || isBlockedByMessage;

    return res.status(200).json({ isBlocked });
  } catch (err) {
    console.error("❌ Error checking block status:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get messages between sender and receiver
// exports.getMessages = async (req, res) => {
//   try {
//     const { sender, receiver, limit = 20, cursor } = req.query;

//     if (!sender || !receiver) {
//       return errorResponse(res, 'Sender and receiver are required', 400);
//     }

//     const cacheKey = cursor
//       ? `messages:${sender}:${receiver}:cursor:${cursor}:limit:${limit}`
//       : `messages:${sender}:${receiver}:recent:limit:${limit}`;

//     const result = await getOrSetCache(cacheKey, async () => {
//       // Base query condition
//       const queryCondition = {
//         $or: [
//           { sender, receiver },
//           { sender: receiver, receiver: sender },
//         ]
//       };

//       // Add cursor condition if provided
//       if (cursor) {
//         queryCondition.createdAt = { $lt: new Date(cursor) };
//       }

//       const messages = await Message.find(queryCondition)
//         .sort({ createdAt: -1 })
//         .limit(parseInt(limit))
//         .populate('sender', 'fullName profilePicture')
//         .populate('receiver', 'fullName profilePicture');

//       // Mark messages as read (only for recent messages)
//       if (!cursor) {
//         await Message.updateMany(
//           { sender: receiver, receiver: sender, isRead: false },
//           { isRead: true }
//         );
//       }

//       // Get the oldest timestamp for next cursor
//       const nextCursor = messages.length > 0
//         ? messages[messages.length - 1].createdAt.toISOString()
//         : null;

//       return {
//         messages: messages.reverse(), // chronological order
//         pagination: {
//           nextCursor,
//           hasMore: messages.length === parseInt(limit)
//         }
//       };
//     }, 180); // TTL 3 mins

//     // Emit read receipt
//     const io = getIo();
//     io.to(receiver.toString()).emit('messagesRead', { sender, receiver });

//     const senderStatus = getUserStatus(sender);
//     const receiverStatus = getUserStatus(receiver);

//     result.participants = {
//       [sender]: senderStatus,
//       [receiver]: receiverStatus
//     };
//     await invalidateCache(`unreadCount:${sender}`);

//     return successResponse(res, result, 'Messages retrieved successfully', 200);
//   } catch (error) {
//     return errorResponse(res, 'Error retrieving messages', 500, error);
//   }
// };
// // Get messages between sender and receiver
// exports.getMessages = async (req, res) => {
//   try {
//     const { sender, receiver, limit = 20, cursor } = req.query;

//     if (!sender || !receiver) {
//       return errorResponse(res, 'Sender and receiver are required', 400);
//     }

//     const cacheKey = cursor
//       ? `messages:${sender}:${receiver}:cursor:${cursor}:limit:${limit}`
//       : `messages:${sender}:${receiver}:recent:limit:${limit}`;

//     const result = await getOrSetCache(cacheKey, async () => {
//       // Base query condition
//       const queryCondition = {
//         $or: [
//           { sender, receiver },
//           { sender: receiver, receiver: sender },
//         ]
//       };

//       // Add cursor condition if provided
//       if (cursor) {
//         queryCondition.createdAt = { $lt: new Date(cursor) };
//       }

//       const messages = await Message.find(queryCondition)
//         .sort({ createdAt: -1 })
//         .limit(parseInt(limit))
//         .populate('sender', 'fullName profilePicture')
//         .populate('receiver', 'fullName profilePicture');

//       // Mark messages as read (only for recent messages)
//       if (!cursor) {
//         await Message.updateMany(
//           { sender: receiver, receiver: sender, isRead: false },
//           { isRead: true }
//         );
//       }

//       // Get the oldest timestamp for next cursor
//       const nextCursor = messages.length > 0
//         ? messages[messages.length - 1].createdAt.toISOString()
//         : null;

//       return {
//         messages: messages.reverse(), // chronological order
//         pagination: {
//           nextCursor,
//           hasMore: messages.length === parseInt(limit)
//         }
//       };
//     }, 180); // TTL 3 mins

//     // Emit read receipt
//     const io = getIo();
//     io.to(receiver.toString()).emit('messagesRead', { sender, receiver });

//     const senderStatus = getUserStatus(sender);
//     const receiverStatus = getUserStatus(receiver);

//     result.participants = {
//       [sender]: senderStatus,
//       [receiver]: receiverStatus
//     };
//     await invalidateCache(`unreadCount:${sender}`);

//     return successResponse(res, result, 'Messages retrieved successfully', 200);
//   } catch (error) {
//     return errorResponse(res, 'Error retrieving messages', 500, error);
//   }
// };

// new get mesage

// new get mesage
// new get message (optimized: optional limit + lean)
exports.getMessages = async (req, res) => {
  try {
    const { sender, receiver, limit, before } = req.query;

    if (!sender || !receiver) {
      return res
        .status(400)
        .json({ message: "Sender and receiver are required" });
    }

    const query = {
      $or: [
        { sender, receiver },
        { sender: receiver, receiver: sender },
      ],
    };

    // scroll-up ke liye optional cursor (isse purane messages mangwa sakte ho)
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    // ⚡ limit aaye to utne hi LATEST messages (warna sab — purana behavior)
    const pageSize = limit ? Math.min(parseInt(limit, 10) || 30, 100) : 0;

    let q = Message.find(query)
      .sort({ createdAt: -1 }) // newest first (latest messages pehle)
      .populate("sender", "firstName lastName fullName profilePicture")
      .populate("receiver", "firstName lastName fullName profilePicture")
      .populate({
        path: "replyTo",
        select: "message sender attachments",
        populate: { path: "sender", select: "firstName lastName fullName" },
      })
      .lean(); // ⚡ lean = plain objects, bahut tez (no mongoose hydration/toObject)

    if (pageSize) q = q.limit(pageSize);

    const messages = await q;

    // Mark messages as read (same as before)
    Message.updateMany(
      { sender: receiver, receiver: sender, isRead: false },
      { isRead: true, status: "read" },
    ).catch((e) => console.error("mark read failed:", e.message));

    // CDN + reply decrypt (lean objects -> .toObject() ki zaroorat nahi)
    const updatedMessages = messages.map((msg) => {
      const updatedAttachments = (msg.attachments || []).map((att) => ({
        ...att,
        url: convertS3UrlToCDN(att.url),
      }));

      const obj = { ...msg, attachments: updatedAttachments };

      if (
        obj.replyTo &&
        typeof obj.replyTo.message === "string" &&
        obj.replyTo.message.includes(":")
      ) {
        obj.replyTo.message = decrypt(obj.replyTo.message);
      }

      return obj;
    });

    // Emit read receipt
    const io = getIo();
    io.to(receiver.toString()).emit("messagesRead", { sender, receiver });

    // Online status
    const senderStatus = getUserStatus(sender);
    const receiverStatus = getUserStatus(receiver);

    // messages abhi newest-first hain — purana response bhi newest-first tha,
    // is liye reverse ki zaroorat NAHI (frontend pehle jaisa hi chalega)
    return successResponse(
      res,
      {
        messages: updatedMessages,
        participants: {
          [sender]: senderStatus,
          [receiver]: receiverStatus,
        },
        hasMore: pageSize ? messages.length === pageSize : false,
      },
      "Messages retrieved successfully",
      200,
    );
  } catch (error) {
    return errorResponse(res, "Error retrieving messages", 500, error);
  }
};
// Get all messages for a user
exports.getAllMessages = async (req, res) => {
  try {
    const userId = req.params.userId;
    const cacheKey = `messages:${userId}`;
    const messages = await getOrSetCache(
      cacheKey,
      async () => {
        return await Message.find({
          $or: [{ sender: userId }, { receiver: userId }],
        })
          .populate(
            "sender",
            "firstName lastName profilePicture accountType businessName sadhuName tirthName",
          )
          .populate(
            "receiver",
            "firstName lastName profilePicture accountType businessName sadhuName tirthName",
          )
          .sort({ createdAt: -1 })
          .lean();
      },
      60,
    );

    // ✅ 404 hatao — empty array bhi valid response hai
    if (!messages || messages.length === 0) {
      return res.status(200).json({ messages: [], unreadCount: 0 });
      //                  ^^^  200 karo, 404 nahi
    }

    const unreadCount = messages.filter(
      (msg) =>
        msg.isRead === false &&
        msg.receiver &&
        msg.receiver._id.toString() === userId,
    ).length;

    res.status(200).json({ messages, unreadCount });
  } catch (error) {
    res.status(500).json({ message: "Error fetching messages", error });
  }
};
exports.getConversation = async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return errorResponse(res, "Invalid user ID", 400);
    }
    const uid = new mongoose.Types.ObjectId(userId);
    const now = new Date();

    const rows = await Message.aggregate([
      {
        $match: {
          $and: [
            { $or: [{ sender: uid }, { receiver: uid }] },
            { deletedBy: { $ne: uid } },
            { $or: [{ deleteAt: null }, { deleteAt: { $gt: now } }] },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $cond: [{ $eq: ["$sender", uid] }, "$receiver", "$sender"] },
          last: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiver", uid] },
                    { $eq: ["$isRead", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { "last.createdAt": -1 } },
      {
        $project: {
          unreadCount: 1,
          "last._id": 1,
          "last.sender": 1,
          "last.receiver": 1,
          "last.message": 1,
          "last.createdAt": 1,
        },
      },
    ]).allowDiskUse(true);

    // Saare users ek hi query me
    const userIds = new Set();
    rows.forEach((r) => {
      userIds.add(r.last.sender.toString());
      userIds.add(r.last.receiver.toString());
    });
    const users = await User.find({ _id: { $in: [...userIds] } })
      .select(
        "fullName profilePicture accountType businessName sadhuName tirthName",
      )
      .lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const recentChats = [];
    for (const r of rows) {
      const senderUser = userMap.get(r.last.sender.toString());
      const receiverUser = userMap.get(r.last.receiver.toString());
      if (!senderUser || !receiverUser) continue;
      recentChats.push({
        _id: r.last._id,
        sender: senderUser,
        receiver: receiverUser,
        message: decrypt(r.last.message || ""),
        createdAt: r.last.createdAt,
        unreadCount: r.unreadCount,
      });
    }

    return successResponse(res, recentChats, "Recent chats fetched", 200);
  } catch (err) {
    return errorResponse(res, "Failed to fetch recent chats", 500, err);
  }
};

exports.getConversations = async (req, res) => {
  try {
    const userId = req.params.userId;
    const cacheKey = `conversations:${userId}`;

    const conversations = await getOrSetCache(
      cacheKey,
      async () => {
        return await Conversation.find({
          participants: userId,
        })
          .populate("participants", "fullName profilePicture")
          .populate({
            path: "lastMessage",
            select: "text createdAt sender", // or other required fields
          })
          .sort({ updatedAt: -1 });
      },
      60,
    ); // Cache for 1 minute
    if (!conversations || conversations.length === 0) {
      return errorResponse(res, "No conversations found", 404);
    }

    return successResponse(res, conversations, "Conversations retrieved", 200);
  } catch (error) {
    return errorResponse(res, "Error fetching conversations", 500, error);
  }
};
// Get messages by ID (either sender or receiver)
exports.getMessageById = async (req, res) => {
  try {
    const { messageId } = req.params;
    // Find message by ID
    const message = await Message.findById(messageId)
      .populate("sender", "firstName lastName profilePicture")
      .populate("receiver", "firstName lastName profilePicture");
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }
    res.status(200).json({ message });
  } catch (error) {
    res.status(500).json({ message: "Error fetching message", error });
  }
};

exports.deleteMessageById = async (req, res) => {
  try {
    const userId = req.user._id;

    // ✅ SUPPORT BOTH
    let messageIds = [];

    if (req.body.messageIds && Array.isArray(req.body.messageIds)) {
      messageIds = req.body.messageIds;
    } else if (req.params.id) {
      messageIds = [req.params.id];
    }

    if (!messageIds.length) {
      return res.status(400).json({ message: "messageIds or id required" });
    }

    const messages = await Message.find({ _id: { $in: messageIds } });

    if (!messages.length) {
      return res.status(404).json({ message: "Messages not found" });
    }

    const deletableMessages = messages.filter(
      (msg) => msg.sender.toString() === userId.toString(),
    );

    if (!deletableMessages.length) {
      return res.status(403).json({
        message: "You can only delete your own messages",
      });
    }

    // ✅ Delete attachments
    for (const message of deletableMessages) {
      if (message.attachments?.length) {
        for (const attachment of message.attachments) {
          if (attachment.url?.includes(".com/")) {
            const key = attachment.url.split(".com/")[1];
            if (key) {
              try {
                await s3Client.send(
                  new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                  }),
                );
              } catch (err) {
                console.warn("S3 delete failed:", key);
              }
            }
          }
        }
      }
    }

    await Message.deleteMany({
      _id: { $in: deletableMessages.map((m) => m._id) },
    });

    const io = getIo();
    deletableMessages.forEach((msg) => {
      io.to(msg.receiver.toString()).emit("messageDeleted", {
        messageId: msg._id,
      });
    });

    res.status(200).json({
      message: "Message(s) deleted successfully",
      deletedCount: deletableMessages.length,
    });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteMessageOnlyForMe = async (req, res) => {
  try {
    const userId = req.user._id;

    let messageIds = [];

    if (req.body.messageIds && Array.isArray(req.body.messageIds)) {
      messageIds = req.body.messageIds;
    } else if (req.params.id) {
      messageIds = [req.params.id];
    }

    if (!messageIds.length) {
      return res.status(400).json({ message: "messageIds or id required" });
    }

    const messages = await Message.find({ _id: { $in: messageIds } });

    if (!messages.length) {
      return res.status(404).json({ message: "Messages not found" });
    }

    let updatedCount = 0;

    for (const message of messages) {
      if (!message.deletedBy) message.deletedBy = [];

      if (!message.deletedBy.includes(userId.toString())) {
        message.deletedBy.push(userId.toString());
        await message.save();
        updatedCount++;
      }
    }

    res.status(200).json({
      message: "Message(s) deleted for current user",
      updatedCount,
    });
  } catch (error) {
    console.error("Delete for me error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
// Update messages by senderId
exports.updateMessageById = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { newMessage } = req.body;
    const userId = req.user._id;
    const newImage = req.file?.location;
    if (!newMessage) {
      return res
        .status(400)
        .json({ message: "New message content is required" });
    }
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }
    if (message.sender.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({
          message: "Unauthorized: You can only update your own messages",
        });
    }
    // Pehle existing message ko decrypt
    let decryptedOldMessage = decrypt(message.message);
    // Agar naye message me koi change hai to update
    if (newMessage && newMessage !== decryptedOldMessage) {
      message.message = encrypt(newMessage);
    }
    // if new image , delete old images
    if (newImage) {
      if (message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          if (attachment.url) {
            const key = attachment.url.split(".com/")[1]; // 🔹 Extracting S3 Key
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: key,
              }),
            );
          }
        }
      }
      // Update attachments with new image
      message.attachments = [
        {
          type: "image",
          url: newImage,
          name: req.file.originalname,
          size: req.file.size,
        },
      ];
    }
    // Save updated message
    await message.save();
    // Response me decrypted message bhejna hai taaki UI me text dikhe
    res.status(200).json({
      message: "Message updated successfully",
      data: { ...message.toObject(), message: decrypt(message.message) },
    });
  } catch (error) {
    console.error("Error updating message:", error);
    res.status(500).json({ message: "Error updating message", error });
  }
};

// Get unread messages count
exports.getUnreadMessagesCount = async (req, res) => {
  try {
    const { userId } = req.params;

    const count = await Message.countDocuments({
      receiver: new mongoose.Types.ObjectId(userId),
      isRead: false,
    });

    res.status(200).json({ unreadCount: count });
  } catch (error) {
    res.status(500).json({ message: "Error getting unread count", error });
  }
};

// Send image message
// Send image message
exports.sendImageMessage = async (req, res) => {
  try {
    const { sender, receiver } = req.body;
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }
    // ✅ reply (optional)
    const replyToId =
      req.body.replyTo && mongoose.Types.ObjectId.isValid(req.body.replyTo)
        ? req.body.replyTo
        : null;
    const senderUser = await User.findById(sender);
    const receiverUser = await User.findById(receiver);
    if (!senderUser || !receiverUser) {
      return res.status(400).json({ message: "Sender or receiver not found" });
    }
    const cdnUrl = convertS3UrlToCDN(req.file.location);
    const newMessage = new Message({
      sender,
      receiver,
      message: "Image",
      attachments: [
        {
          type: "image",
          url: cdnUrl,
          name: req.file.originalname,
          size: req.file.size,
        },
      ],
      ...(replyToId && { replyTo: replyToId }), // ✅ additive
      createdAt: new Date(),
    });
    await newMessage.save();

    // ✅ reply preview
    let imgReplyPreview = null;
    if (newMessage.replyTo) {
      try {
        const rt = await Message.findById(newMessage.replyTo)
          .select("message sender attachments")
          .populate("sender", "firstName lastName fullName");
        if (rt) {
          imgReplyPreview = {
            _id: rt._id,
            message: rt.message,
            sender: rt.sender,
            attachments: rt.attachments || [],
          };
        }
      } catch (e) {}
    }
    // Emit real-time message event
    const io = getIo();
    const imgPayload = newMessage.toObject();
    if (imgReplyPreview) imgPayload.replyTo = imgReplyPreview;

    io.to(receiver.toString()).emit("newMessage", {
      message: imgPayload,
      sender: {
        _id: senderUser._id,
        fullName: senderUser.fullName,
        profilePicture: senderUser.profilePicture,
      },
    });
    res.status(201).json({
      message: "Image sent successfully",
      data: imgPayload,
    });
  } catch (error) {
    console.error("Error sending image:", error);
    res.status(500).json({
      message: "Error sending image",
      error: error.message,
    });
  }
};
exports.broadcastMessage = async (req, res) => {
  const { senderId, users, message, media } = req.body;

  try {
    // Ensure users is an array of user objects or IDs
    const userList = Array.isArray(users) ? users : [];

    const messages = userList
      .filter((u) =>
        typeof u === "string" ? u !== senderId : u._id !== senderId,
      )
      .map((user) => {
        const receiverId = typeof user === "string" ? user : user._id;
        return {
          sender: senderId,
          receiver: receiverId,
          message,
          media,
          createdAt: new Date(),
        };
      });

    await Message.insertMany(messages);

    res
      .status(200)
      .json({ success: true, message: "Broadcasted to all users" });
  } catch (error) {
    console.error("Broadcast Error:", error);
    res.status(500).json({ success: false, message: "Failed to broadcast" });
  }
};
