const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../model/UserRegistrationModels/userModel');
const {Message} = require('../model/SocialMediaModels/messageModel')

let io;
const userSockets = new Map();
const userStatus = new Map(); 
const messageQueue = new Map();

const initializeWebSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    console.warn("❌ No token found in handshake.auth");
    return next(new Error("Authentication error: No token"));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    //console.log("🔓 Token decoded:", decoded);

    // ✅ userId resolve karne ka safe way
    socket.userId = decoded.originalUserId || decoded._id || socket.handshake.auth?.userId;

    if (!socket.userId) {
      console.error("❌ Authentication failed: userId missing after decode");
      return next(new Error("Authentication error: userId missing"));
    }

    // DB update
    const result = await User.findByIdAndUpdate(
      socket.userId,
      { status: "online", lastSeen: null },
      { new: true }
    );

    console.log("✅ DB update result:", result);

    return next();
  } catch (err) {
    console.error("❌ JWT verification failed:", err.message);
    return next(new Error("Authentication error"));
  }
});


  io.on('connection', (socket) => {
   // console.log('User connected:', socket.userId);

    userSockets.set(socket.userId, socket.id);
    socket.join(socket.userId.toString());
    updateUserStatus(socket.userId, 'online');

    // ✅ Add updateStatus here (just before sendMessage)
    socket.on('updateStatus', ({ status }) => {
    //  console.log('🔥 updateStatus received:', status); 
    if (['online', 'offline'].includes(status)) {
      updateUserStatus(socket.userId, status);
      //console.log(`User ${socket.userId} manually updated to ${status}`);
    }
  });

    socket.on('joinGroup', (groupId) => {
      socket.join(`group:${groupId}`);
     // console.log(`User ${socket.userId} joined group ${groupId}`);
    });

    socket.on('typing', ({ chatId, receiverId }) => {
      if (chatId) {
        socket.to(`group:${chatId}`).emit('userTyping', {
          userId: socket.userId,
          chatId
        });
      } else if (receiverId) {
        socket.to(receiverId.toString()).emit('userTyping', {
          userId: socket.userId
        });
      }
    });

socket.on('messageRead', async (data) => {
  const { messageId, senderId } = data;
  try {
    await Message.findByIdAndUpdate(messageId, {
      isRead: true,
      isDelivered: true,
      readAt: new Date()
    });
    socket.to(senderId.toString()).emit('messageReadReceipt', {
      messageId,
      readBy: socket.userId
    });
      io.to(socket.userId.toString()).emit('unreadMessageCountUpdate');
  } catch (err) {
    console.error("❌ Failed to update isRead in DB:", err.message);
  }
});


  socket.on('messageDelivered', async (data) => {
  const { messageId, senderId } = data;
  try {
    await Message.findByIdAndUpdate(messageId, {
      isDelivered: true
    });
    socket.to(senderId.toString()).emit('messageDeliveryStatus', {
      messageId,
      status: 'delivered',
      deliveredAt: new Date()
    });
  } catch (err) {
    console.error("❌ Failed to update isDelivered in DB:", err.message);
  }
});

    socket.on('typingInGroup', ({ groupId }) => {
      const groupChatController = require('../controllers/SocialMediaControllers/groupChatController');
      groupChatController.handleGroupTyping(socket, groupId);
    });

    socket.on('groupMessageRead', ({ groupId, messageId }) => {
      socket.to(`group:${groupId}`).emit('groupMessageReadStatus', {
        messageId,
        readBy: socket.userId,
        readAt: new Date()
      });
    });

socket.on('sendMessage', async (data) => {
  const receiverId = data?.receiver?._id || data?.receiver;
  const senderId = socket.userId;

  if (!receiverId || !data._id) return;

  const formattedMessage = {
    message: data,
    sender: { _id: senderId }
  };

  // ✅ Don't emit 'newMessage' back to sender
  if (userSockets.has(receiverId)) {
    // Send only to receiver
    if (receiverId !== senderId) {
      io.to(receiverId.toString()).emit('newMessage', formattedMessage);
    }

    // Send delivery status back to sender
    io.to(senderId.toString()).emit('messageDeliveryStatus', {
      messageId: data._id,
      status: 'delivered',
      deliveredAt: new Date()
    });

    // Update DB
    try {
      await Message.findByIdAndUpdate(data._id, { isDelivered: true });
          io.to(receiverId.toString()).emit('unreadMessageCountUpdate');
    } catch (err) {
      console.error('DB update failed for isDelivered:', err.message);
    }
  } else {
    addToMessageQueue(receiverId, formattedMessage);
  }
});
socket.on('markMessagesRead', async ({ senderId }) => {
  try {
    await Message.updateMany(
      { sender: senderId, receiver: socket.userId, isRead: false },
       { isRead: true, isDelivered: true, readAt: new Date() }
    );

    // ✅ Notify sender
    socket.to(senderId.toString()).emit('messagesReadByReceiver', {
      readBy: socket.userId,
      senderId
    });

    // ✅ Refresh unread count on receiver (self)
    io.to(socket.userId.toString()).emit('unreadMessageCountUpdate');

  } catch (err) {
    console.error("❌ Error in markMessagesRead:", err.message);
  }
});

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    if (messageQueue.has(socket.userId)) {
      const messages = messageQueue.get(socket.userId);
      messages.forEach(msg => {
        socket.emit('newMessage', msg);
      });
      messageQueue.delete(socket.userId);
    }

    socket.on('disconnect', () => {
      userSockets.delete(socket.userId);
      updateUserStatus(socket.userId, 'offline');
      //console.log('User disconnected:', socket.userId);
    });
  });
  io.on('reconnect_attempt', () => {
    console.log('Attempting to reconnect...');
  });

  return io;
};

// Helper functions
const getUserStatus = (userId) => {
  if (!userStatus.has(userId)) {
    return { status: 'offline', lastSeen: null };
  }
  return userStatus.get(userId);
};

const getIo = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

const addToMessageQueue = (userId, message) => {
  if (!messageQueue.has(userId)) {
    messageQueue.set(userId, []);
  }
  messageQueue.get(userId).push(message);
};

const updateUserStatus = async (userId, status) => {
  const statusObj = {
    status,
    lastSeen: status === 'offline' ? new Date() : null,
  };

  userStatus.set(userId, statusObj);

  if (io) {
    io.emit('userStatusUpdate', {
      userId,
      ...statusObj,
    });
  }

  // ✅ Update in database
  try {
    const result = await User.findByIdAndUpdate(
      userId,
      {
        status: statusObj.status,
        lastSeen: statusObj.lastSeen,
      },
      { new: true } // optional: returns updated doc
    );
    //console.log("✅ DB update result:", result);
    if (result) {
     // console.log(`✅ DB updated: user ${userId} is now ${statusObj.status}`);
    } else {
      console.warn(`⚠️ No user found in DB for ID ${userId}`);
    }
  } catch (err) {
    console.error(`❌ Failed to update user ${userId} status in DB:`, err.message);
  }
};

module.exports = {
  initializeWebSocket,
  getIo,
  getUserStatus,
  getUserSocket: (userId) => userSockets.get(userId),
  addToMessageQueue,
  updateUserStatus
};
