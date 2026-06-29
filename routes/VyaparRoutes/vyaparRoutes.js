const express = require("express");
const router = express.Router();
const {
  submitVyaparApplication,
  vyaparLogin,
  getVyaparDetails,
  updateVyaparDetails,
  getCityVyapars,
  getAvailableCities,
  getAllVyapars,
  reviewApplication,
  verifyBusiness,
  updateVyaparDetail,
  deleteVyaparLogo,
  deleteVyaparPhoto,
  submitBusinessApplication,
} = require("../../controller/VyaparControllers/vyaparController");
const {
  createVyaparPaymentOrder,
  verifyVyaparPayment,
  completeVyaparRegistration,
  verifyVyaparQrPayment,
} = require("../../controller/PaymentControllers/paymentController");
const {
  authMiddleware,
  verifyVyaparRole,
} = require("../../middlewares/authMiddlewares");
const upload = require("../../middlewares/upload");
const {
  generateBusinessCard,
} = require("../../controller/VyaparControllers/businessCard");

// ✅ Rating controller (new — separate file, doesn't touch vyaparController.js)
const {
  submitRating,
  removeRating,
  getRatingSummary,
  getBusinessRatings,
  getRatingsBatch,
} = require("../../controller/VyaparControllers/Vyaparratingcontroller");

// Public routes
router.get("/available-cities", getAvailableCities);
router.get("/city/:citySanghId", getCityVyapars);
router.get("/", getAllVyapars);
router.get("/generate-card/verify/business/:businessCode", verifyBusiness);
router.get("/generate-card/business/:id", generateBusinessCard);
// Protected routes - require user authentication
router.use(authMiddleware);

// Vyapar access route - uses JWT token now
router.get("/access/:vyaparId", verifyVyaparRole, vyaparLogin);

// Payment and registration flow
router.post("/create-payment", createVyaparPaymentOrder);
router.post("/verify-payment", verifyVyaparPayment);
router.post("/verify-qr-payment", verifyVyaparQrPayment);
router.post(
  "/complete-registration/:orderId",
  upload.vyaparDocs,
  completeVyaparRegistration,
);

// Consider deprecating this in the future
router.post("/create", upload.vyaparDocs, submitVyaparApplication);
router.post("/submit", upload.vyaparDocs, submitBusinessApplication);
// Business viewing routes
router.get("/details/:vyaparId", getVyaparDetails);
router.patch("/review/:vyaparId", reviewApplication);
// Update vyapar details
router.put("/update/:id", upload.vyaparDocs, updateVyaparDetail);
// Business management routes - require business owner role
router.put(
  "/update/:vyaparId",
  verifyVyaparRole,
  upload.vyaparDocs,
  updateVyaparDetails,
);
// Delete specific photo
router.delete("/:id/photo/:photoIndex", deleteVyaparPhoto);

// Delete logo
router.delete("/:id/logo", deleteVyaparLogo);

// ════════════════════════════════════════════════
// ✅ RATING ROUTES (new)
// ════════════════════════════════════════════════
// Public: anyone can read summary / list of ratings
//   (kept under authMiddleware above; if you want truly public, move these
//    above `router.use(authMiddleware)` line. Leaving them protected so
//    we can show "your rating" inline.)
router.get("/rating-summary/:vyaparId", getRatingSummary);
router.get("/ratings/:vyaparId", getBusinessRatings);

// Batch summary fetch for list screens (one request for many businesses)
router.post("/ratings/batch", getRatingsBatch);

// Submit / update my rating for a business
router.post("/rate/:vyaparId", submitRating);

// Remove my rating
router.delete("/rate/:vyaparId", removeRating);

module.exports = router;
