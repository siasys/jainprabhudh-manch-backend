// controllers/messageController.js
const { Message, encrypt, decrypt } = require('../../model/SocialMediaModels/messageModel');
const User = require('../../model/UserRegistrationModels/userModel');
const Conversation = require('../../model/SocialMediaModels/conversationModel');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const mongoose = require('mongoose');
const {getIo, getUserStatus}  = require('../../websocket/socket');
const { s3Client, DeleteObjectCommand } = require('../../config/s3Config');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const { getOrSetCache,invalidateCache } = require('../../utils/cache');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

// Create a new message
// controllers/messageController.js

exports.createMessage = async (req, res) => {
  try {
    const sender = req.body.sender.trim();
    const receiver = req.body.receiver.trim();
    const message = req.body.message;
    const senderType = req.body.senderType || req.user.type;
    const receiverType = req.body.receiverType || 'user';

    // 🛡️ 1. Validate message
    if (!message || message.trim() === "") {
      return res.status(400).json({ message: 'Message cannot be empty' });
    }

    // 🧠 2. Validate sender authorization
    if (senderType === 'sangh') {
      const sangh = await HierarchicalSangh.findById(sender);
      if (!sangh) {
        return res.status(404).json({ message: "Sangh not found" });
      }
      const isOfficeBearer = sangh.officeBearers.some(ob =>
        ob.userId.toString() === req.user._id.toString()
      );
      if (!isOfficeBearer) {
        return res.status(403).json({
          success: false,
          message: 'User not authorized to send on behalf of Sangh'
        });
      }
    } else {
      if (sender !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Sender ID must match authenticated user'
        });
      }
    }

    // 🎯 3. Fetch receiver (can be user or sangh)
    let receiverUser = null;
    let receiverSangh = null;
    if (receiverType === 'sangh') {
      receiverSangh = await HierarchicalSangh.findById(receiver);
      if (!receiverSangh) {
        return errorResponse(res, 'Receiver Sangh not found', 400);
      }
    } else {
      receiverUser = await User.findById(receiver);
      if (!receiverUser) {
        return errorResponse(res, 'Receiver User not found', 400);
      }
    }

    // 💬 4. Create/get conversation
    const conversationCacheKey = `conversation:${sender}:${receiver}`;
    let conversation = await getOrSetCache(conversationCacheKey, async () => {
      return await Conversation.findOne({
        participants: { $all: [sender, receiver] }
      });
    }, 300);
    if (!conversation) {
      conversation = new Conversation({
        participants: [sender, receiver]
      });
      await conversation.save();
    }
let attachments = [];

if (req.file) {
  attachments.push({
    type: 'image',
    url: convertS3UrlToCDN(req.file.location),
    name: req.file.originalname,
    size: req.file.size
  });
} else if (req.body.imageUrl) {
  attachments.push({
    type: 'image',
    url: req.body.imageUrl,
    name: 'forwarded_image.jpg',
    size: 0
  });
}
    // 📦 5. Prepare message data
    const messageData = {
      sender,
      receiver,
      senderType,
      message: message,
      attachments,
      createdAt: new Date()
    };

    let senderInfo = {};

    if (senderType === 'sangh') {
      const sangh = await HierarchicalSangh.findById(sender);
      if (!sangh) {
        return errorResponse(res, 'Sender Sangh not found', 404);
      }

      messageData.sanghId = sangh._id;

      senderInfo = {
        _id: sangh._id,
        fullName: sangh.name || sangh.sanghName,
        profilePicture: sangh.sanghImage || null,
        type: 'sangh'
      };
    } else {
      const senderUser = await User.findById(sender);
      if (!senderUser) {
        return errorResponse(res, 'Sender user not found', 404);
      }

      senderInfo = {
        _id: senderUser._id,
        fullName: `${senderUser.firstName} ${senderUser.lastName}`,
        profilePicture: senderUser.profilePicture,
        type: 'user'
      };
    }

    // ✅ 6. Save message
    const newMessage = new Message(messageData);
    await newMessage.save();

    // 🔁 7. Update conversation
    conversation.messages.push(newMessage._id);
    conversation.lastMessage = newMessage._id;
    await conversation.save();

    // 🚫 Invalidate cache
    await invalidateCache(`conversation:${sender}:${receiver}`);
    await invalidateCache(`conversation:${receiver}:${sender}`);

    // 🔊 8. Emit socket message
    const decryptedMessage = newMessage.decryptedMessage;
    const io = getIo();
    io.to(receiver.toString()).emit('newMessage', {
      message: {
        ...newMessage.toObject(),
        message: decryptedMessage
      },
      sender: senderInfo
    });

    // 🎉 9. Success response
    return successResponse(res, {
      ...newMessage.toObject(),
      message: decryptedMessage
    }, 'Message sent successfully', 201);

  } catch (error) {
    if (req.file) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: req.file.key
        }));
      } catch (deleteError) {
        console.error('Error deleting file:', deleteError);
      }
    }
    console.error('Message creation error:', error);
    return errorResponse(res, 'Error sending message', 500, error.message);
  }
};

// DELETE /messages/clear/:receiverId
exports.clearAllMessagesBetweenUsers = async (req, res) => {
  try {
    const senderId = req.user._id;
    const receiverId = req.params.receiverId;

    if (!receiverId) {
      return res.status(400).json({ message: 'Receiver ID is required' });
    }

    const messages = await Message.find({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId }
      ]
    });

    // Delete any attachments from S3
    for (const msg of messages) {
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (attachment.url) {
            const key = attachment.url.split('.com/')[1];
            await s3Client.send(new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: key
            }));
          }
        }
      }
    }

    // Delete the messages from database
    await Message.deleteMany({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId }
      ]
    });

    // Notify receiver via socket (optional)
    const io = getIo();
    io.to(receiverId.toString()).emit('allMessagesCleared', { senderId });

    res.status(200).json({ message: 'All messages between users cleared successfully' });
  } catch (error) {
    console.error('Error clearing messages:', error);
    res.status(500).json({ message: 'Error clearing messages', error: error.message });
  }
};
// PATCH /messages/block-unblock
exports.blockUnblockUser = async (req, res) => {
  try {
    const userId = req.user._id; // logged in user
    const { targetUserId, action } = req.body; // target user id and action = 'block' or 'unblock'

    if (!targetUserId || !['block', 'unblock'].includes(action)) {
      return res.status(400).json({ message: 'targetUserId and valid action (block/unblock) are required.' });
    }

    // Convert to ObjectId if needed
    const userObjId = userId;
    const targetObjId = targetUserId;

    if (action === 'block') {
      // Update messages where user is sender => set isBlockedBySender = true
      await Message.updateMany(
        { sender: userObjId, receiver: targetObjId },
        { $set: { isBlockedBySender: true } }
      );

      // Update messages where user is receiver => set isBlockedByReceiver = true
      await Message.updateMany(
        { sender: targetObjId, receiver: userObjId },
        { $set: { isBlockedByReceiver: true } }
      );

    } else if (action === 'unblock') {
      // Set blocked flags false
      await Message.updateMany(
        { sender: userObjId, receiver: targetObjId },
        { $set: { isBlockedBySender: false } }
      );

      await Message.updateMany(
        { sender: targetObjId, receiver: userObjId },
        { $set: { isBlockedByReceiver: false } }
      );
    }

    return res.status(200).json({ message: `${action} successful.` });
  } catch (error) {
    console.error('Block/Unblock error:', error);
    return res.status(500).json({ message: 'Internal server error' });
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
exports.getMessages = async (req, res) => {
  try {
    const { sender, receiver } = req.query;

    if (!sender || !receiver) {
      return res.status(400).json({ message: 'Sender and receiver are required' });
    }

    const messages = await Message.find({
      $or: [
        { sender, receiver },
        { sender: receiver, receiver: sender },
      ],
    }).sort({ createdAt: 1 })
    .populate('sender', 'firstName lastName fullName profilePicture')
    .populate('receiver', 'firstName lastName fullName profilePicture');

    // Mark messages as read
    await Message.updateMany(
      { sender: receiver, receiver: sender, isRead: false },
      { isRead: true, status: 'read' }
    );
    // Convert attachments to use CDN URLs
    const updatedMessages = messages.map(msg => {
      const updatedAttachments = msg.attachments?.map(att => ({
        ...att.toObject(),
        url: convertS3UrlToCDN(att.url)
      })) || [];

      return {
        ...msg.toObject(),
        attachments: updatedAttachments
      };
    });

    // Emit read receipt
    const io = getIo();
    io.to(receiver.toString()).emit('messagesRead', { sender, receiver });

    // Get participants' online status
    const senderStatus = getUserStatus(sender);
    const receiverStatus = getUserStatus(receiver);

    return successResponse(res, {
      messages: updatedMessages.reverse(),
      participants: {
        [sender]: senderStatus,
        [receiver]: receiverStatus
      }
    }, 'Messages retrieved successfully', 200);
  } catch (error) {
    return errorResponse(res, 'Error retrieving messages', 500, error);
  }
};
// Get all messages for a user
exports.getAllMessages = async (req, res) => {
  try {
    const userId = req.params.userId;
    const cacheKey = `messages:${userId}`;

    const messages = await getOrSetCache(cacheKey, async () => {
      return await Message.find({
        $or: [{ sender: userId }, { receiver: userId }],
      })
        .populate('sender', 'firstName lastName profilePicture')
        .populate('receiver', 'firstName lastName profilePicture')
        .sort({ createdAt: -1 });
    }, 60); // Cache for 1 minute

    if (!messages || messages.length === 0) {
      return res.status(404).json({ message: 'No messages found' });
    }

    const unreadCount = messages.filter(
      (msg) =>
        msg.isRead === false &&
        msg.receiver &&
        msg.receiver._id.toString() === userId
    ).length;
  
    res.status(200).json({ messages, unreadCount });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching messages', error });
  }
};
exports.getConversation = async (req, res) => {
  try {
    const userId = req.params.userId;

    // Get all messages involving the user
    const messages = await Message.find({
      $or: [{ sender: userId }, { receiver: userId }]
    })
      .sort({ createdAt: -1 })
      .populate('sender', 'fullName profilePicture')
      .populate('receiver', 'fullName profilePicture');

    const conversationMap = new Map();

    // Loop through messages to get latest per conversation and unread count
    messages.forEach((msg) => {
      const sender = msg.sender?._id?.toString();
      const receiver = msg.receiver?._id?.toString();

      if (!sender || !receiver) return;

      // Determine the other participant
      const otherUserId = sender === userId ? receiver : sender;

      if (!conversationMap.has(otherUserId)) {
        conversationMap.set(otherUserId, {
          lastMessage: msg,
          unreadCount: 0
        });
      }

      // Count unread messages sent *to* current user by that `otherUser`
      if (
        msg.receiver._id.toString() === userId && // current user is receiver
        msg.sender._id.toString() === otherUserId && // message came from otherUser
        msg.isRead === false
      ) {
        const entry = conversationMap.get(otherUserId);
        entry.unreadCount += 1;
      }
    });

    // Build final array
    const recentChats = Array.from(conversationMap.entries()).map(
      ([otherUserId, { lastMessage, unreadCount }]) => {
        return {
          _id: lastMessage._id,
          sender: lastMessage.sender,
          receiver: lastMessage.receiver,
          message: lastMessage.message,
          createdAt: lastMessage.createdAt,
          unreadCount
        };
      }
    );

    return successResponse(res, recentChats, 'Recent chats fetched', 200);
  } catch (err) {
    return errorResponse(res, 'Failed to fetch recent chats', 500, err);
  }
};

exports.getConversations = async (req, res) => {
  try {
    const userId = req.params.userId;
    const cacheKey = `conversations:${userId}`;
    
    const conversations = await getOrSetCache(cacheKey, async () => {
      return await Conversation.find({
        participants: userId
      })
      .populate('participants', 'fullName profilePicture')
      .populate({
        path: 'lastMessage',
        select: 'text createdAt sender' // or other required fields
      })
      .sort({ updatedAt: -1 });
    }, 60); // Cache for 1 minute
    if (!conversations || conversations.length === 0) {
      return errorResponse(res, 'No conversations found', 404);
    }
    
    return successResponse(res, conversations, 'Conversations retrieved', 200);
  } catch (error) {
    return errorResponse(res, 'Error fetching conversations', 500, error);
  }
};
// Get messages by ID (either sender or receiver)
exports.getMessageById = async (req, res) => {
  try {
    const { messageId } = req.params;
    // Find message by ID
    const message = await Message.findById(messageId)
      .populate('sender', 'firstName lastName profilePicture')
      .populate('receiver', 'firstName lastName profilePicture');
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    res.status(200).json({ message });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching message', error });
  }
};

exports.deleteMessageById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const message = await Message.findById(id);
    // Check if the message exists
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    // Verify message ownership
    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }
     // Delete image from S3 if exists
     if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.url) {
          const key = attachment.url.split('.com/')[1];
          await s3Client.send(new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key
          }));
        }
      }
    }
    await message.deleteOne(); // Delete message from database
    const sender = message.sender.toString();
    const receiver = message.receiver.toString();
    // Notify other user about message deletion
    const io = getIo();
    io.to(message.receiver.toString()).emit('messageDeleted', { messageId: id });
    res.status(200).json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ message: 'Error deleting message', error: error.message });
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
      return res.status(400).json({ message: 'New message content is required' });
    }
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Unauthorized: You can only update your own messages' });
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
            const key = attachment.url.split('.com/')[1]; // 🔹 Extracting S3 Key
            await s3Client.send(new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: key
            }));
          }
        }
      }
      // Update attachments with new image
      message.attachments = [{
        type: "image",
        url: newImage,
        name: req.file.originalname,
        size: req.file.size,
      }];
    }
    // Save updated message
    await message.save();
    // Response me decrypted message bhejna hai taaki UI me text dikhe
    res.status(200).json({ 
      message: 'Message updated successfully', 
      data: { ...message.toObject(), message: decrypt(message.message) } 
    });
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ message: 'Error updating message', error });
  }
};

// Get unread messages count
exports.getUnreadMessagesCount = async (req, res) => {
  try {
    const { userId } = req.params;

    const count = await Message.countDocuments({
      'receiver._id': new mongoose.Types.ObjectId(userId),
      isRead: false
    });

    res.status(200).json({ unreadCount: count });
  } catch (error) {
    res.status(500).json({ message: 'Error getting unread count', error });
  }
};

// Send image message
exports.sendImageMessage = async (req, res) => {
  try {
    const { sender, receiver } = req.body;
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }
    const senderUser = await User.findById(sender);
    const receiverUser = await User.findById(receiver);
    if (!senderUser || !receiverUser) {
      return res.status(400).json({ message: 'Sender or receiver not found' });
    }
     const cdnUrl = convertS3UrlToCDN(req.file.location);
    const newMessage = new Message({
      sender,
      receiver,
      message: 'Image',
      attachments: [{
        type: 'image',
        url: cdnUrl,
        name: req.file.originalname,
        size: req.file.size
      }],
      createdAt: new Date(),
    });
    await newMessage.save();
    // Emit real-time message event
    const io = getIo();
    io.to(receiver.toString()).emit('newMessage', {
      message: newMessage,
      sender: {
        _id: senderUser._id,
        fullName: senderUser.fullName,
        profilePicture: senderUser.profilePicture
      }
    });
    res.status(201).json({
      message: 'Image sent successfully',
      data: newMessage
    });
  } catch (error) {
    console.error('Error sending image:', error);
    res.status(500).json({
      message: 'Error sending image',
      error: error.message
    });
  }
};
exports.broadcastMessage = async (req, res) => {
  const { senderId, users, message, media } = req.body;

  try {
    // ✅ Ensure users is an array of user objects or IDs
    const userList = Array.isArray(users) ? users : [];

    const messages = userList
      .filter(u => (typeof u === 'string' ? u !== senderId : u._id !== senderId))
      .map(user => {
        const receiverId = typeof user === 'string' ? user : user._id;
        return {
          sender: senderId,
          receiver: receiverId,
          message,
          media,
          createdAt: new Date(),
        };
      });

    await Message.insertMany(messages);

    res.status(200).json({ success: true, message: 'Broadcasted to all users' });
  } catch (error) {
    console.error('Broadcast Error:', error);
    res.status(500).json({ success: false, message: 'Failed to broadcast' });
  }
};
