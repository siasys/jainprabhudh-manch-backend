const express = require('express');
const { createStory, getAllStories, getStoriesByUser, deleteStory, deleteStoryMedia, adminDeleteStory, viewStory, getStoryViews, toggleStoryMediaLike, getStoryMediaLikes, addStoryMediaComment, getStoryMediaComments, deleteStoryMediaComment, muteStoryUser, unmuteStoryUser, getMutedStoryUsers, checkMuteStatus, toggleHideStory } = require('../../controller/SocialMediaControllers/storyController');
const upload = require('../../middlewares/upload');
const { authMiddleware } = require('../../middlewares/authMiddlewares');
const router = express.Router();
const rateLimit = require('express-rate-limit');

// Protected routes
router.use(authMiddleware);
// Validation middleware
const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation error',
            errors: errors.array()
        });
    }
    next();
};

// Rate limiting for story creation to prevent spam
// const storyCreationLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000, // 1 hour
//     max: 10, // limit each user to 10 stories per hour
//     message: {
//         success: false,
//         message: 'Too many stories created. Please try again later.'
//     },
//     standardHeaders: true,
//     keyGenerator: (req) => req.user ? req.user.id : req.ip
// });

// Story routes
router.post("/", upload.storyUpload, createStory);
router.get('/get', getAllStories);
router.post('/:storyId/view', viewStory);
router.get('/:storyId/:mediaId/views', getStoryViews);
router.post('/:storyId/media/:mediaId/like', toggleStoryMediaLike);
router.get('/:storyId/media/:mediaId/likes', getStoryMediaLikes);
router.post('/:storyId/media/:mediaId/comment', addStoryMediaComment);
router.get('/:storyId/media/:mediaId/comments', getStoryMediaComments);
// Mute/Unmute routes
router.post("/mute/:userId", muteStoryUser);
router.post("/unmute/:userId", unmuteStoryUser);
router.post("/toggle-hide-story", toggleHideStory);
router.get("/muted-users", getMutedStoryUsers);

router.get("/mute-status/:userId", checkMuteStatus);
router.delete('/:storyId/media/:mediaId/comment/:commentId', deleteStoryMediaComment);
router.delete('/admin/delete/:storyId', adminDeleteStory);
router.delete('/delete/:storyId/:mediaId', deleteStoryMedia);
router.delete('/delete/:userId/:storyId', deleteStory);

router.get('/:userId', getStoriesByUser);

// router.post("/", upload.array("media"), createStory);
// router.get('/get', getAllStories);
// router.get('/:userId', getStoriesByUser);
// router.delete('/delete/:userId/:storyId', deleteStory);

module.exports = router;
