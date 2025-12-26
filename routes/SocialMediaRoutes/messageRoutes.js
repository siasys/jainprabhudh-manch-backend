// routes/messageRoutes.js
const express = require('express');
const { createMessage, getAllMessages, getMessageById, getMessages, getUnreadMessagesCount, deleteMessagesBySenderId, updateMessagesBySenderId, deleteMessageById, sendImageMessage, updateMessageById, getConversations, getConversation, clearAllMessagesBetweenUsers, blockUnblockUser, broadcastMessage, getBlockStatus, deleteMessageOnlyForMe, sharePost } = require('../../controller/SocialMediaControllers/messageController');
const {authenticate} = require('../../middlewares/authMiddlewares')
const upload = require('../../middlewares/upload');
const { param } = require('express-validator');
const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Create a new message
router.post('/create', createMessage);
router.post('/share-post', sharePost);
router.get('/',getMessages)
// Send an image message
router.post('/send-image', upload.single('chatImage'), sendImageMessage);
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

router.delete('/delete', authenticate, deleteMessageById);
router.delete('/delete-onlyme', authenticate, deleteMessageOnlyForMe);

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
