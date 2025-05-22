const express = require('express');
const router = express.Router();
const jainPratibhaController = require('../../controller/Jain Prathibha/jainPratibhaController');
const upload = require('../../middlewares/upload');

// POST /api/jainpratibha
router.post('/', upload.single('jainPrathibha'), jainPratibhaController.createPost);

// GET /api/jainpratibha
router.get('/all', jainPratibhaController.getAllPosts);

// POST /api/jainpratibha/like/:postId
router.post('/like/:postId', jainPratibhaController.toggleLike);

module.exports = router;
