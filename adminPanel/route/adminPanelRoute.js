const express = require("express");
const router = express.Router();

const { protectAdmin, can, roleOnly, ROLES } = require("../middleware/adminAuth");
const auth = require("../controller/adminAuthController");
const team = require("../controller/adminTeamController");
const dashboard = require("../controller/adminDashboardController");
const { getAllUsers } = require("../../controller/UserRegistrationControllers/userController");
const post = require("../controller/adminPostController");
const report = require("../controller/adminReportController");
const story = require("../controller/adminStoryController");
const shravak = require("../controller/adminShravakController");
const userDetail = require("../controller/adminUserDetailController");
const feedback = require("../controller/adminFeedbackController");
const matrimonial = require("../controller/adminMatrimonialController");
const tirth = require("../controller/adminTirthController");
const tirthSettlement = require("../../controller/TirthControllers/tirthDonationController");

/* ───────────── PUBLIC ───────────── */
router.post("/auth/login", auth.login);

router.post("/auth/forgot-password", auth.forgotPassword);
router.post("/auth/verify-reset-code", auth.verifyResetCode);
router.post("/auth/reset-password", auth.resetPassword);

/* ───────────── PROTECTED — neeche sab protected hain ───────────── */
router.use(protectAdmin);

router.get("/auth/me", auth.getMe);
router.put("/auth/change-password", auth.changePassword);

// Permission master list — assign screen ke liye
router.get("/permissions", auth.getPermissionList);

// Dashboard
router.get("/dashboard/stats", dashboard.getStats);

// Audit log
router.get("/audit", can("audit.view"), dashboard.getAuditLogs);

/* ───────────── TEAM MANAGEMENT ─────────────
   Dekhna: permission se. Banana/badalna: sirf trustee/ceo */
const SENIOR = [ROLES.TRUSTEE, ROLES.CEO];

/* ───────────── USERS ─────────────
   Existing getAllUsers controller reuse kar rahe hain.
   protectAdmin ne req.user already set kar diya hai, isliye
   wo controller bina change ke chal jata hai.
   Sirf Trustee/CEO — members ko user list nahi dikhegi. */
router.get("/users", roleOnly(...SENIOR), getAllUsers);
router.get("/users/:id", can("user.detail"), userDetail.getUserDetail);
router.patch("/users/:id/remove-media", can("user.moderate"), userDetail.removeUserMedia);
router.patch("/users/:id/suspend", can("user.suspend"), userDetail.toggleSuspend);

router.get("/team", can("team.view"), team.listMembers);
router.get("/team/:id", can("team.view"), team.getMember);

router.post("/team", roleOnly(...SENIOR), team.createMember);
router.put("/team/:id", roleOnly(...SENIOR), team.updateMember);
router.put("/team/:id/permissions", roleOnly(...SENIOR), team.updatePermissions);
router.put("/team/:id/reset-password", roleOnly(...SENIOR), team.resetMemberPassword);
router.patch("/team/:id/toggle", roleOnly(...SENIOR), team.toggleActive);


/* ───────────── POSTS ───────────── */
router.get("/posts", can("post.view"), post.listPosts);
router.get("/posts/stats", can("post.view"), post.getPostStats);
router.get("/posts/:id", can("post.view"), post.getPostDetail);

router.patch("/posts/:id/hide", can("post.hide"), post.toggleHide);
router.patch("/posts/:id/pin", can("post.pin"), post.togglePin);
router.delete("/posts/:id", can("post.delete"), post.deletePost);
router.patch("/posts/:id/restore", can("post.restore"), post.restorePost);

router.delete(
  "/posts/:id/comments/:commentId",
  can("comment.delete"),
  post.deleteComment,
);


/* ───────────── REPORTS ───────────── */
router.get("/reports/stats", can("report.view"), report.getReportStats);
router.get("/reports", can("report.view"), report.listReports);
router.post("/reports/action", can("report.action"), report.takeAction);
router.patch("/reports/assign", can("report.assign"), report.assignReport);


/* ───────────── STORIES ───────────── */
router.get("/stories/stats", can("story.view"), story.getStoryStats);
router.get("/stories", can("story.view"), story.listStories);
router.get("/stories/:id", can("story.view"), story.getStoryDetail);

router.delete("/stories/:id", can("story.delete"), story.deleteStory);
router.patch("/stories/:id/restore", can("story.delete"), story.restoreStory);
router.delete("/stories/:id/slides/:slideId", can("story.delete"), story.deleteSlide);
router.delete(
  "/stories/:id/slides/:slideId/comments/:commentId",
  can("comment.delete"),
  story.deleteStoryComment,
);

/* ───────────── SHRAVAK CARD ───────────── */
router.get("/shravak/stats", can("shravak.view"), shravak.getShravakStats);
router.get("/shravak", can("shravak.view"), shravak.listApplications);
router.get("/shravak/:id", can("shravak.view"), shravak.getApplicationDetail);
router.put("/shravak/:id/review", can("shravak.review"), shravak.reviewApplication);



/* ───────────── SUGGESTIONS & COMPLAINTS ───────────── */
router.get("/feedback/stats", can("feedback.view"), feedback.getFeedbackStats);
router.get("/feedback", can("feedback.view"), feedback.listFeedback);
router.get("/feedback/:id", can("feedback.view"), feedback.getFeedbackDetail);
router.put("/feedback/:id/respond", can("feedback.respond"), feedback.respondToFeedback);


/* ───────────── MATRIMONIAL ───────────── */
router.get("/matrimonial/stats", can("matrimonial.view"), matrimonial.getMatrimonialStats);
router.get("/matrimonial", can("matrimonial.view"), matrimonial.listProfiles);
router.post(
  "/matrimonial/expire-lapsed",
  can("matrimonial.membership"),
  matrimonial.expireLapsed,
);
router.get("/matrimonial/:id", can("matrimonial.view"), matrimonial.getProfileDetail);
router.patch(
  "/matrimonial/:id/visibility",
  can("matrimonial.moderate"),
  matrimonial.toggleVisibility,
);
router.patch(
  "/matrimonial/:id/membership",
  can("matrimonial.membership"),
  matrimonial.updateMembership,
);
router.delete(
  "/matrimonial/:id/photos/:photoId",
  can("matrimonial.moderate"),
  matrimonial.removePhoto,
);


/* ───────────── TIRTH VERIFICATION ───────────── */
router.get("/tirth/stats", can("tirth.view"), tirth.getTirthStats);
router.get("/tirth", can("tirth.view"), tirth.listTirths);
router.get("/tirth/:id", can("tirth.view"), tirth.getTirthDetail);
router.put("/tirth/:id/review", can("tirth.review"), tirth.reviewTirth);

/* ───────────── TIRTH DONATION SETTLEMENTS ───────────── */
router.get(
  "/tirth-settlements",
  can("tirth.view"),
  tirthSettlement.getSettlementSummary,
);
router.get(
  "/tirth-settlements/:tirthId",
  can("tirth.view"),
  tirthSettlement.getTirthSettlementDetail,
);

router.put(
  "/tirth-settlements/donation/:donationId/commission",
  can("tirth.review"),
  tirthSettlement.setDonationCommission,
);

router.put(
  "/tirth-settlements/:tirthId/commission",
  can("tirth.review"),
  tirthSettlement.updateCommission,
);
router.put(
  "/tirth-settlements/:tirthId/settle",
  can("tirth.review"),
  tirthSettlement.markSettled,
);


module.exports = router;