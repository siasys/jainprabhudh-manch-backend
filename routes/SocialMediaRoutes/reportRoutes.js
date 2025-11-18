const express = require('express');
const router = express.Router();
const reportController = require('../../controller/SocialMediaControllers/reportController');
const { authMiddleware } = require('../../middlewares/authMiddlewares');

router.use(authMiddleware);

// ---------- STATIC ROUTES (Always FIRST) ----------
router.post('/', reportController.createReport);
router.get('/', reportController.getAllReports);
router.get('/my', reportController.getMyReports);

// STORY REPORT ROUTES (STATIC)
router.post('/story-report', reportController.createStoryReport);
router.get('/story-report', reportController.getAllStoryReports);
router.post('/comment-report', reportController.createCommentReport);
router.get('/get/comment-report', reportController.getAllCommentReports);

// ---------- ROUTE (Always LAST) ----------
router.get('/:id', reportController.getReportById);

module.exports = router;
