const express = require("express");
const {
  createStory,
  getAllStories,
  getStoriesByUser,
  deleteStory,
  deleteStoryMedia,
  adminDeleteStory,
  viewStory,
  getStoryViews,
  toggleStoryMediaLike,
  getStoryMediaLikes,
  addStoryMediaComment,
  getStoryMediaComments,
  deleteStoryMediaComment,
  muteStoryUser,
  unmuteStoryUser,
  getMutedStoryUsers,
  checkMuteStatus,
  toggleHideStory,
} = require("../../controller/SocialMediaControllers/storyController");
const upload = require("../../middlewares/upload");
const { authMiddleware } = require("../../middlewares/authMiddlewares");
const router = express.Router();

router.use(authMiddleware);

// ✅ 1. Static routes SABSE PEHLE (koi param nahi)
router.post("/", upload.storyUpload, createStory);
router.get("/get", getAllStories);
router.post("/toggle-hide-story", toggleHideStory);
router.get("/muted-users", getMutedStoryUsers);

// ✅ 2. Static + 1 param routes
router.post("/mute/:userId", muteStoryUser);
router.post("/unmute/:userId", unmuteStoryUser);
router.get("/mute-status/:userId", checkMuteStatus);

// ✅ 3. Admin/delete static keyword routes (dynamic se pehle)
router.delete("/admin/delete/:storyId", adminDeleteStory);

// ✅ 4. media keyword wale routes (/:storyId/:mediaId se pehle — warna "media" param ban jayega)
router.post("/:storyId/media/:mediaId/like", toggleStoryMediaLike);
router.get("/:storyId/media/:mediaId/likes", getStoryMediaLikes);
router.post("/:storyId/media/:mediaId/comment", addStoryMediaComment);
router.get("/:storyId/media/:mediaId/comments", getStoryMediaComments);
router.delete(
  "/:storyId/media/:mediaId/comment/:commentId",
  deleteStoryMediaComment,
);

// ✅ 5. delete keyword wale routes
router.delete("/delete/:storyId/:mediaId", deleteStoryMedia);
router.delete("/delete/:userId/:storyId", deleteStory);

// ✅ 6. Baaki dynamic 2-param routes
router.post("/:storyId/view", viewStory);
router.get("/:storyId/:mediaId/views", getStoryViews);

// ✅ 7. Single param dynamic route SABSE BAAD
router.get("/:userId", getStoriesByUser);

module.exports = router;
