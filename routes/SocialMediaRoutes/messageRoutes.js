// routes/messageRoutes.js
const express = require('express');
const { createMessage, getAllMessages, getMessageById, getMessages, getUnreadMessagesCount, deleteMessagesBySenderId, updateMessagesBySenderId, deleteMessageById, sendImageMessage, updateMessageById, getConversations, getConversation, clearAllMessagesBetweenUsers, blockUnblockUser, broadcastMessage, getBlockStatus, deleteMessageOnlyForMe, sharePost } = require('../../controller/SocialMediaControllers/messageController');
const {authenticate} = require('../../middlewares/authMiddlewares')
const upload = require('../../middlewares/upload');
const { param } = require('express-validator');
const router = express.Router();
const { chatImageUpload } = require("../../middlewares/upload");
// Apply authentication middleware to all routes
const jwt = require('jsonwebtoken');
const authOnce = (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').split(' ')[1];
    const decoded = token ? jwt.verify(token, process.env.JWT_SECRET) : null;
    if (decoded && req.user && String(req.user._id) === String(decoded._id)) {
      return next(); // user pehle se load hai, DB call skip
    }
  } catch (e) {}
  return authenticate(req, res, next);
};
router.use(authOnce);

// Create a new message
router.post('/create', createMessage);
router.post('/share-post', sharePost);
router.get('/',getMessages)
// Send an image message
router.post("/send-image", chatImageUpload, sendImageMessage);
router.post('/broadcast', broadcastMessage)
// Get all messages for a user
router.get('/:userId', getAllMessages);
router.get('/conversation/:userId', getConversation);
router.get('/conversations/:userId',
    [
      param('userId').isMongoId().withMessage('Invalid user ID')
    ],
    getConversations
  );
// Get a specific message by its ID
router.get('/:messageId', getMessageById);
router.get('/block-status/:userId/:targetUserId', getBlockStatus);

router.delete('/delete', deleteMessageById);
router.delete('/delete-onlyme', deleteMessageOnlyForMe);

router.patch('/clear/:receiverId', clearAllMessagesBetweenUsers);

// Update messages by senderId
router.put('/update/:messageId',updateMessageById);
router.patch('/block-unblock', blockUnblockUser);
// Get unread messages count
router.get('/unread/:userId', getUnreadMessagesCount);
router.get('/conversations/:userId',
  [
    param('userId').isMongoId().withMessage('Invalid user ID')
  ],
  getConversations
);

module.exports = router;
