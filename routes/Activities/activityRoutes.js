const express = require("express");
const { getAllActivities, createActivity, getActivityById, participateInActivity, submitJudgeMarks, updateActivityMarks, calculateWinners } = require("../../controller/Avtivities/activityController");
const upload = require("../../middlewares/upload");
const router = express.Router();
//const { protect } = require("../middleware/authMiddleware");

// Create new activity (only Sangh users)
router.post("/create", createActivity);
router.post("/:activityId/participate", upload.uploadActivityFiles, participateInActivity);
router.post("/:activityId/marks", submitJudgeMarks);
router.post("/:activityId/update-marks", updateActivityMarks);
router.post("/:activityId/calculate-winners", calculateWinners);

// Get all activities
router.get("/", getAllActivities);

// Get single activity by ID
router.get("/:id", getActivityById);

module.exports = router;
