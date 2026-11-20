// routes/rojgarRoute.js
const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/upload");
const { authMiddleware } = require("../../middlewares/authMiddlewares");
const {
  createJob,
  getAllJobs,
  getJobById,
  updateJob,
  deleteJob,
  createRecruitee,
  getAllRecruitees,
  deleteRecruitee,
} = require("../../controller/Rojgar/rojgarController");
const {
  applyToJob,
  getApplicationsForJob,
  getMyApplications,
  updateApplicationStatus,
  getSuggestedJobs,
} = require("../../controller/Rojgar/jobApplicationController");
const {
  createFreelancer,
  getAllFreelancers,
  showInterest,
  getInterestedUsers,
  getMyInterests,
  deleteFreelancer,
  addPortfolioItem,
  deletePortfolioItem,
  updatePortfolioItem,
  updateFreelancer,
  getReviews,
  addReview,
  deleteReview,
  replyToReview,
} = require("../../controller/Rojgar/freelancerController");
const {
  getProfile,
  updateProfile,
  uploadCover,
  uploadPhoto,
  removePhoto,
  removeCover,
  getProfileBySlug,
  checkSlug,
  updateSlug,
} = require("../../controller/Rojgar/profileController");

// Routes for job operations
router.post("/create", upload.jobPostUpload, createJob);
router.post("/candidate", upload.candidateResumeUpload, createRecruitee);
router.get("/", getAllJobs);
router.get("/recruitee", getAllRecruitees);
// NEW: job profile delete (sirf owner / admin) — resume S3 se bhi hatta hai
router.delete("/recruitee/:id", authMiddleware, deleteRecruitee);

// ===== Job Application (Apply flow) — additive, keep ABOVE "/:id" =====
router.post("/apply", upload.candidateResumeUpload, applyToJob);
router.get("/applications/job/:jobId", getApplicationsForJob);
router.get("/applications/my/:userId", getMyApplications);
router.patch("/applications/:appId/status", updateApplicationStatus);
router.get("/suggested/:userId", getSuggestedJobs);

// ===== Freelancer (additive, keep ABOVE "/:id") =====
router.post("/freelancer/create", upload.jobPostUpload, createFreelancer);
router.get("/freelancer/all", getAllFreelancers);
router.post("/freelancer/interest", showInterest);
router.get("/freelancer/interested/:freelancerId", getInterestedUsers);
router.get("/freelancer/my-interests/:userId", getMyInterests);
router.post(
  "/freelancer/portfolio/:id",
  upload.jobPostUpload,
  addPortfolioItem,
);
router.delete("/freelancer/portfolio/:id/:itemId", deletePortfolioItem);
// NEW: portfolio project edit
router.put(
  "/freelancer/portfolio/:id/:itemId",
  upload.jobPostUpload,
  updatePortfolioItem,
);
// NEW: reviews / rating — keep ABOVE "/freelancer/:id"
router.get("/freelancer/:id/reviews", getReviews);
router.post("/freelancer/:id/reviews", authMiddleware, addReview);
router.delete(
  "/freelancer/:id/reviews/:reviewId",
  authMiddleware,
  deleteReview,
);
router.patch(
  "/freelancer/:id/reviews/:reviewId/reply",
  authMiddleware,
  replyToReview,
);
router.put("/freelancer/:id", upload.jobPostUpload, updateFreelancer);
router.delete("/freelancer/:id", deleteFreelancer);

// ===== Employment Profile (LinkedIn style) — keep ABOVE "/:id" =====
// NEW: public profile URL (slug) — keep ABOVE "/profile/:userId"
router.get("/profile/by-slug/:slug", getProfileBySlug);
router.get("/profile/slug-check/:slug", checkSlug);
router.put("/profile/:userId/slug", authMiddleware, updateSlug);
router.get("/profile/:userId", getProfile);
router.put("/profile/:userId", authMiddleware, updateProfile);
router.post(
  "/profile/:userId/cover",
  authMiddleware,
  upload.profileCoverUpload,
  uploadCover,
);
// NEW: Employment profile ki apni photo
router.post(
  "/profile/:userId/photo",
  authMiddleware,
  upload.employmentPhotoUpload,
  uploadPhoto,
);
// NEW: Employment profile se photo / cover hatao
router.delete("/profile/:userId/photo", authMiddleware, removePhoto);
router.delete("/profile/:userId/cover", authMiddleware, removeCover);

router.get("/:id", getJobById);
router.put("/:id", updateJob);
router.delete("/:id", deleteJob);

module.exports = router;
