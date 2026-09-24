const express = require("express");
const router = express.Router();

const {
  getAnnouncementFeed,
  getTirthAnnouncements,
  markViewed,
} = require("../../controller/TirthControllers/tirthAnnouncementController");

// Home feed — saare live announcements
router.get("/feed", getAnnouncementFeed);

// Ek tirth ki announcements
router.get("/tirth/:tirthId", getTirthAnnouncements);

// view count
router.patch("/:announcementId/view", markViewed);

module.exports = router;
