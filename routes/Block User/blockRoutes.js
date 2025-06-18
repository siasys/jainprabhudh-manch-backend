const express = require('express');
const router = express.Router();
const blockController = require('../../controller/Block User/blockController');
const { authMiddleware } = require('../../middlewares/authMiddlewares');

// ✅ Apply middleware globally to this router
// router.use(authMiddleware);


// Block a user
router.post('/',authMiddleware, blockController.blockUser);

// Unblock a user
router.delete('/unblock/:blockedUserId',authMiddleware, blockController.unblockUser);

// Get all blocked users of current user
router.get('/blocked-users', authMiddleware, blockController.getBlockedUsers);

// Check if user is blocked by me
router.get('/check/:userId', authMiddleware, blockController.isUserBlockedByMe); // optional extra API

module.exports = router;
