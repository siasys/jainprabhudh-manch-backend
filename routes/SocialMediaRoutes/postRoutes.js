const express = require('express');
const { createPost, getAllPosts, likePost, unlikePost, deletePost, getPostsByUser, getPostById, addComment, addReply, toggleLike, getReplies, editPost, hidePost, unhidePost, getCombinedFeed, getCombinedFeedOptimized, getLikedUsers, searchHashtags, likeComment, likeReply, sharePost, deleteComment, deleteReply, voteOnPoll, getAllVideoPosts } = require('../../controller/SocialMediaControllers/postController');
const { authMiddleware } = require('../../middlewares/authMiddlewares');
const rateLimit = require('express-rate-limit');

const router = express.Router();
// Apply authentication middleware to all routes
router.use(authMiddleware);
// Rate limiting for post creation
const postCreationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each user to 5 posts per 15 minutes
    message: {
      success: false,
      message: 'Too many posts created. Please try again later.'
    },
    standardHeaders: true,
    keyGenerator: (req) => req.user ? req.user.id : req.ip
  });

router.post('/create', createPost, postCreationLimiter);
router.post("/:postId/share", sharePost);
router.get('/', getAllPosts);
router.get('/videos', getAllVideoPosts);
router.get('/combined-feed', getCombinedFeed);
router.get('/hashtags/search', searchHashtags);
// Get optimized combined feed with cursor-based pagination
router.get('/combined-feed-optimized', getCombinedFeedOptimized);

router.put('/:postId/unlike', unlikePost); // Unlike a post
router.delete('/:postId', deletePost); // Delete a post
router.get('/user', getPostsByUser);
router.get('/:postId', getPostById);
router.get('/:postId/likes', getLikedUsers);
// routes/postRoutes.js
router.post('/:postId/vote', voteOnPoll);
router.post('/comment', addComment);
router.post('/comment/reply', addReply);
router.post('/like-comment', likeComment);
router.post('/like-reply', likeReply);
router.post('/deleteComment', deleteComment);
router.post('/deleteReply', deleteReply);
router.put('/:postId/like', toggleLike);
router.put('/:postId', editPost);
router.get('/comments/:commentId/replies', getReplies);

// Visibility routes
router.put('/:postId/hide', hidePost);
router.put('/:postId/unhide', unhidePost);


module.exports = router;
