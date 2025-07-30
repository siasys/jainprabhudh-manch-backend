const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../model/UserRegistrationModels/userModel')
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

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded._id;

      userStatus.set(socket.userId, {
        status: 'online',
        lastSeen: Date.now()
      });

      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      return next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.userId);

    userSockets.set(socket.userId, socket.id);
    socket.join(socket.userId.toString());
    updateUserStatus(socket.userId, 'online');

    // ✅ Add updateStatus here (just before sendMessage)
  socket.on('updateStatus', ({ status }) => {
    if (['online', 'offline'].includes(status)) {
      updateUserStatus(socket.userId, status);
      console.log(`User ${socket.userId} manually updated to ${status}`);
    }
  });

    socket.on('joinGroup', (groupId) => {
      socket.join(`group:${groupId}`);
      console.log(`User ${socket.userId} joined group ${groupId}`);
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

    socket.on('messageRead', (data) => {
      const { messageId, senderId } = data;
      socket.to(senderId.toString()).emit('messageReadReceipt', {
        messageId,
        readBy: socket.userId
      });
    });

    socket.on('messageDelivered', (data) => {
      const { messageId, senderId } = data;
      socket.to(senderId.toString()).emit('messageDeliveryStatus', {
        messageId,
        status: 'delivered',
        deliveredAt: new Date()
      });
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

    // ✅ NEW: Handle sendMessage from client socket
    socket.on('sendMessage', (data) => {
      const receiverId = data?.receiver?._id || data?.receiver;
      if (!receiverId) return;

      const formattedMessage = {
        message: data,
        sender: {
          _id: socket.userId
        }
      };

      if (userSockets.has(receiverId)) {
        io.to(receiverId.toString()).emit('newMessage', formattedMessage);
      } else {
        addToMessageQueue(receiverId, formattedMessage);
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
      console.log('User disconnected:', socket.userId);
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
    await User.findByIdAndUpdate(userId, {
      status: statusObj.status,
      lastSeen: statusObj.lastSeen,
    });
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
