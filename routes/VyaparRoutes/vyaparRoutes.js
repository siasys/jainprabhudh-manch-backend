const express = require('express');
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
    deleteVyaparPhoto
} = require('../../controller/VyaparControllers/vyaparController');
const { 
    createVyaparPaymentOrder,
    verifyVyaparPayment,
    completeVyaparRegistration,
    verifyVyaparQrPayment
} = require('../../controller/PaymentControllers/paymentController');
const { authMiddleware, verifyVyaparRole } = require('../../middlewares/authMiddlewares');
const upload = require('../../middlewares/upload');
const { generateBusinessCard } = require('../../controller/VyaparControllers/businessCard');

// Public routes
router.get('/available-cities', getAvailableCities);
router.get('/city/:citySanghId', getCityVyapars);
router.get('/', getAllVyapars);
router.get('/generate-card/verify/business/:businessCode', verifyBusiness);
router.get('/generate-card/business/:id', generateBusinessCard);
// Protected routes - require user authentication
router.use(authMiddleware);

// Vyapar access route - uses JWT token now
router.get('/access/:vyaparId', verifyVyaparRole, vyaparLogin);


// Payment and registration flow
router.post('/create-payment', createVyaparPaymentOrder);
router.post('/verify-payment', verifyVyaparPayment);
router.post('/verify-qr-payment', verifyVyaparQrPayment);
router.post('/complete-registration/:orderId', 
    upload.vyaparDocs,
    completeVyaparRegistration
);

// Consider deprecating this in the future
router.post('/create', upload.vyaparDocs, submitVyaparApplication);

// Business viewing routes
router.get('/details/:vyaparId',
    getVyaparDetails
);
router.patch('/review/:vyaparId', reviewApplication);
// Update vyapar details
router.put('/update/:id', upload.vyaparDocs, updateVyaparDetail);
// Business management routes - require business owner role
router.put('/update/:vyaparId',
    verifyVyaparRole,
    upload.vyaparDocs,
    updateVyaparDetails
);
// Delete specific photo
router.delete('/:id/photo/:photoIndex', deleteVyaparPhoto);

// Delete logo
router.delete('/:id/logo', deleteVyaparLogo);
module.exports = router;
