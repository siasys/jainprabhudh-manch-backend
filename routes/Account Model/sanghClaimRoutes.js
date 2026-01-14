const express = require('express');
const router = express.Router();

const {
  createClaim,
  getAllClaims,
  getSanghClaims,
  getClaimById,
  approveClaim,
  rejectClaim,
  markAsPaid,
  updateClaimStatus,
  getClaimStatistics,
  updatePaymentStatus,
} = require('../../controller/Account Model/sanghClaimController');

const { authMiddleware } = require('../../middlewares/authMiddlewares');

// 🔐 All routes protected
router.use(authMiddleware);

/**
 * =========================
 * CLAIM CREATION & FETCH
 * =========================
 */

// ✅ Create new claim (Sangh side)
router.post('/', createClaim);

// ✅ Get all claims (Foundation/Admin view)
router.get('/all', getAllClaims);

// ✅ Get claim statistics (Foundation dashboard)
router.get('/stats/overview', getClaimStatistics);

// ✅ Get all claims of a specific sangh
router.get('/sangh/:sanghId', getSanghClaims);

// ✅ Get single claim details
router.get('/:claimId', getClaimById);


/**
 * =========================
 * CLAIM ACTIONS (ADMIN)
 * =========================
 */
// ✅ Update payment status (generic)
router.patch('/:claimId/payment-status', updatePaymentStatus);

// ✅ Approve claim
router.patch('/:claimId/approve', approveClaim);

// ✅ Reject claim
router.patch('/:claimId/reject', rejectClaim);

// ✅ Mark claim as paid (after bank transfer)
router.patch('/:claimId/mark-paid', markAsPaid);

// ✅ Generic status update (submitted → under_review etc.)
router.patch('/:claimId/status', updateClaimStatus);

module.exports = router;
