// routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const reportController = require('../../controller/SocialMediaControllers/reportController');
const { authMiddleware } = require('../../middlewares/authMiddlewares');

router.use(authMiddleware);
// Create Report
router.post('/', reportController.createReport);

// Get All Reports (admin access)
router.get('/', reportController.getAllReports);
router.post('/story-report', reportController.createStoryReport);
router.get('/story-report', reportController.getAllStoryReports);
module.exports = router;
