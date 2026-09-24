const express = require("express");
const router = express.Router();
const {
  submitSadhuInfo,
  reviewSadhuSubmission,
  getAllSadhus,
  getSadhuById,
  sadhuLogin,
  updateSadhuProfile,
  getAvailableCities,
  getPendingSadhuApplications,
  getAllSadhu,
  // ── NEW ──
  removeSadhuImage,
  getSadhuDirectory,
  getSadhuFilterOptions,
} = require("../../controller/SadhuControllers/sadhuController");
const {
  authMiddleware,
  verifySadhuRole,
} = require("../../middlewares/authMiddlewares");
const {
  verifySadhuCredentials,
  isCityPresident,
} = require("../../middlewares/sadhuAuthMiddleware");
const upload = require("../../middlewares/upload");
const {
  generateSadhuCard,
} = require("../../controller/SadhuControllers/generateSadhuCard");

// Public routes
router.get("/available-cities", getAvailableCities);
router.get("/", getAllSadhus);
router.get("/all", getAllSadhu);

// ── NEW: directory routes ──
// Ye "/:sadhuId" se PEHLE hone chahiye, warna Express "directory" ko
// sadhuId samajh lega aur getSadhuById chal jaayega.
router.get("/directory", getSadhuDirectory);
router.get("/filter-options", getSadhuFilterOptions);

router.get("/:sadhuId", getSadhuById);

// Protected routes - require user authentication
router.use(authMiddleware);

// Application routes
router.post("/apply", upload.sadhuDocs, submitSadhuInfo);

// City president routes
router.get(
  "/pending/:citySanghId",
  isCityPresident,
  getPendingSadhuApplications,
);
router.get("/generate-card/sadhu/:id", generateSadhuCard);
router.put("/review/:sadhuId", isCityPresident, reviewSadhuSubmission);

// Sadhu dashboard routes - require sadhu role
router.put("/update/:sadhuId", upload.sadhuDocs, updateSadhuProfile);

// ── NEW: photo hatane ke liye ──
router.put("/remove-image/:sadhuId", removeSadhuImage);

module.exports = router;
