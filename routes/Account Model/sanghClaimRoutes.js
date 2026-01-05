const express = require('express');
const { createClaim, getClaimsBySangh, getAllClaimsForFoundation, updateClaimStatus } = require('../../controller/Account Model/sanghClaimController');
const { authMiddleware } = require('../../middlewares/authMiddlewares');
const router = express.Router();

router.use(authMiddleware);

router.post('/', createClaim);

router.get('/sangh/:sanghId', getClaimsBySangh);

router.get('/foundation/:foundationId', getAllClaimsForFoundation);

router.put('/:claimId', updateClaimStatus);

module.exports = router;
