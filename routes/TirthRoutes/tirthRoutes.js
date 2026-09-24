const express = require("express");
const router = express.Router();
const {
  authMiddleware,
  verifyTirthRole,
} = require("../../middlewares/authMiddlewares");
const upload = require("../../middlewares/upload");
const {
  canManageTirthPost,
  canReviewTirth,
  canManageTirth,
  canViewTirth,
} = require("../../middlewares/tirthAuthMiddleware");
const {
  getAvailableCities,
  submitTirthApplication,
  getPendingApplications,
  reviewApplication,
  getTirthDetails,
  updateTirthDetails,
  getCityTirths,
  tirthLogin,
  getAllTirths,
  getAllTirth,
  deleteTirth,
  updateTirthImages, // ✅ spelling same as export
} = require("../../controller/TirthControllers/tirthController");
const Tirth = require("../../model/TirthModels/tirthModel");

/**
 * ✅ Edit ke liye guard
 * - Owner (jisne tirth submit kiya) apna PENDING / REJECTED tirth edit kar sake
 *   — approve hone se pehle use manager role nahi milta, isliye purane
 *   middleware use rok dete the ("Tirth not found or inactive")
 * - Approved tirth ke liye purane dono check (verifyTirthRole + canManageTirth)
 *   bilkul waise hi chalte hain
 */
const canEditTirth = async (req, res, next) => {
  try {
    const { tirthId } = req.params;
    const tirth = await Tirth.findById(tirthId)
      .select("submittedBy status applicationStatus")
      .lean();

    const isOwner =
      tirth && String(tirth.submittedBy || "") === String(req.user?._id || "");

    if (
      isOwner &&
      tirth.status === "active" &&
      tirth.applicationStatus !== "approved"
    ) {
      return next(); // pending / rejected — owner edit kar sakta hai
    }
  } catch (err) {
    // galat id ya DB error — purane middleware apna jawab denge
  }

  // baaki sab ke liye purana raasta
  return verifyTirthRole(req, res, () => canManageTirth(req, res, next));
};

// Public routes
router.get("/available-cities", getAvailableCities);
router.get("/city/:citySanghId", getCityTirths);
router.get("/", getAllTirths);
router.get("/get", getAllTirth);

// Protected routes - require user authentication
router.use(authMiddleware);

// Tirth access route - uses JWT token now
router.get("/access/:tirthId", verifyTirthRole, tirthLogin);

// Application routes
router.post("/apply", upload.tirthDocs, submitTirthApplication);

// City president routes
router.get("/pending/:citySanghId", canReviewTirth, getPendingApplications);

router.put("/review/:tirthId", canReviewTirth, reviewApplication);

// Tirth viewing routes
router.get(
  "/details/:tirthId",
  // verifyTirthRole,
  getTirthDetails,
);
router.delete("/delete/:tirthId", deleteTirth);
// Tirth management routes - require tirth manager role
router.put("/update-images/:tirthId", upload.tirthDocs, updateTirthImages);

router.put(
  "/update/:tirthId",
  canEditTirth, // owner → pending/rejected edit; baaki → verifyTirthRole + canManageTirth
  upload.tirthDocs,
  updateTirthDetails,
);

module.exports = router;
