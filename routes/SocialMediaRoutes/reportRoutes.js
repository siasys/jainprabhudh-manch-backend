// routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const reportController = require('../../controller/SocialMediaControllers/reportController');
const { authMiddleware } = require('../../middlewares/authMiddlewares');

router.use(authMiddleware);
router.post('/', reportController.createReport);
router.get('/', reportController.getAllReports);
router.get('/my', reportController.getMyReports);
router.get('/:id', reportController.getReportById);
router.post('/story-report', reportController.createStoryReport);
router.get('/story-report', reportController.getAllStoryReports);
module.exports = router;
