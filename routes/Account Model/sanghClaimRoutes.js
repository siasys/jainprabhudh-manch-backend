const express = require('express');
const { createClaim, getClaimsBySangh, getAllClaimsForFoundation, updateClaimStatus, getClaimSummary, getAllClaims, updatePaymentStatus } = require('../../controller/Account Model/sanghClaimController');
const { authMiddleware } = require('../../middlewares/authMiddlewares');
const router = express.Router();

router.use(authMiddleware);

router.post('/', createClaim);
router.get('/sangh/:sanghId/summary', getClaimSummary);
router.get('/claims', getAllClaims);

router.get('/sangh/:sanghId', getClaimsBySangh);

router.get('/foundation/:foundationId', getAllClaimsForFoundation);

// router.put('/:claimId', updateClaimStatus);
router.patch('/claims/:claimId/status', updateClaimStatus);
router.patch('/claims/:claimId/payment-status', updatePaymentStatus);

module.exports = router;
