const express = require('express');
const {
  createBiodata,
  updateBiodata,
  getBiodata,
  getAllBiodatas,
  checkUserBiodata,
  getBiodataByUserId,
  deleteBiodata,
  updateBiodataImages,
  getAllBiodata,
  getMyBiodata,
  getBiodataById,
  createBiodatas,
  likeProfile,
  unlikeProfile,
  getLikedProfiles,
  sendInterest,
  respondToInterest,
  getSentInterests,
  getReceivedInterests
} = require("../../controller/Matrimonial/vyavahikBiodataController");
const upload = require('../../middlewares/upload');
const { 
    createBiodataPaymentOrder,
    verifyBiodataPayment,
    completeBiodataRegistration
  } = require('../../controller/PaymentControllers/paymentController');
const { authMiddleware } = require('../../middlewares/authMiddlewares');
const router = express.Router();

router.use(authMiddleware);
// Check if user has a biodata
router.get('/check-status', checkUserBiodata);
// New payment flow routes
router.post('/', upload.biodataImageUpload, createBiodata);
router.post("/create", upload.biodataImageUpload, createBiodatas);

router.post('/create-payment', createBiodataPaymentOrder);
router.post('/verify-payment', verifyBiodataPayment);
router.post('/complete-registration/:orderId', upload.biodataImageUpload, completeBiodataRegistration);
router.get("/getall", getAllBiodata);
router.get("/me", getMyBiodata);
router.get("/get/:id", getBiodataById);
router.post("/like/:targetId", likeProfile);
router.get("/liked", getLikedProfiles);
// Update a biodata by ID
router.put('/:id', updateBiodata);
router.put('/images/:id', upload.biodataImageUpload, updateBiodataImages);
router.post("/interest/:targetId", sendInterest);
router.patch("/interest/:senderBiodataId/respond", respondToInterest ,);
router.get("/interests/sent", getSentInterests);
router.get("/interests/received", getReceivedInterests);
// Get a single biodata by ID
router.get('/:id', getBiodata);
router.get('/user/:userId', getBiodataByUserId);
router.delete('/delete/:id', deleteBiodata);
router.delete("/unlike/:targetId", unlikeProfile);
// Get all biodatas
router.get('/', getAllBiodatas);

module.exports = router;
