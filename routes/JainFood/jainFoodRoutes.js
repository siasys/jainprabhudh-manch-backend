const express = require('express');
const router = express.Router();
const jainFoodController = require('../../controller/Jainfood/jainFoodController');
const upload = require('../../middlewares/upload');

// Create new Jain Food post (user must be authenticated)
router.post('/create',  upload.single('jainFood'), jainFoodController.createPost);

// Get all Jain Food posts
router.get('/all', jainFoodController.getAllPosts);

// Like a post
router.put('/like/:id', jainFoodController.toggleLikePost);

// Unlike a post
router.put('/unlike/:id', jainFoodController.unlikePost);
router.delete('/:id', jainFoodController.deletePost);

module.exports = router;
