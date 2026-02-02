
const express = require('express');
const {
    registerUser,
    getAllUsers,
    getUserById,
    updateUserById,
    loginUser,
    updatePrivacy,
    uploadProfilePicture,
    skipProfilePicture,
    logoutUser,
    searchUsers,
    verifyEmail,
    resendVerificationCode,
    requestPasswordReset,
    resetPassword,
    sendVerificationCode,
    getAllCities,
    sendChangeEmailOtp,
    verifyChangeEmail,
    changePassword,
    getCitiesByState,
    getUserByJainAadharNumber,
    verifyEmails,
    verifyOtp,
    verifyResetPassword,
    requestPasswordResetMobile,
    sendChangePhoneOtp,
    verifyChangePhone,
    verifyRegisterOtp,
    verifyOtpMobileEmail,
    sendOtp,
    registerFinalUser,
    resendOtp,
    getUserActivityByType,
    getCitiesByMultipleStates
} = require('../../controller/UserRegistrationControllers/userController');
const { authMiddleware, checkAccess, authenticate } = require('../../middlewares/authMiddlewares');
const upload = require('../../middlewares/upload');
const { check, param, body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { switchToUserToken } = require('../../controller/SanghControllers/hierarchicalSanghController');


const router = express.Router();


// Rate limiters
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per 15 minutes
    message: {
        success: false,
        message: 'Too many login attempts. Please try again later.'
    }
});

// const registerLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000, // 1 hour
//     max: 3, // 3 registration attempts per hour
//     message: {
//         success: false,
//         message: 'Too many registration attempts. Please try again later.'
//     }
// });

// Auth routes
router.post('/register',
    [
        body('firstName').trim().isLength({ min: 2, max: 30 }).withMessage('First name must be between 2 and 30 characters'),
        body('lastName').trim().isLength({ min: 2, max: 30 }).withMessage('Last name must be between 2 and 30 characters'),
        body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
        body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Gender must be Male, Female, or Other'),
    ],
    registerUser
);
router.post('/register-user', registerFinalUser);
router.post('/send-otp', sendOtp);
router.post('/resend-otp', resendOtp);
router.post('/verify-email-mobile-otp', verifyOtpMobileEmail);
router.post('/verification-email',sendVerificationCode)
router.post('/verify-email', verifyEmail);
router.post('/verify-emails', verifyEmails);
router.post('/resend-code', resendVerificationCode);
router.post("/register-verify", verifyRegisterOtp);// ui me bhi api change krna he
router.post("/verify-otp", verifyOtp);
//router.get('/cities', getAllCities);
router.get('/location', getCitiesByState);
router.get('/location/multiple', getCitiesByMultipleStates);

// Password reset
router.post('/password-reset', requestPasswordResetMobile);
router.post('/verify-reset-password', verifyResetPassword);
router.post('/request-password-reset', requestPasswordReset);
router.post('/reset-password', resetPassword);
router.post('/login',loginUser);

// backend route

router.use(authMiddleware);
router.post('/logout', logoutUser);
router.post('/switch-to-user', authMiddleware, switchToUserToken);
// router.use(checkAccess);
router.post('/send-change-number-otp', sendChangePhoneOtp);
router.post('/verify-change-number', verifyChangePhone);
router.post('/send-change-email-otp', sendChangeEmailOtp);
router.post('/verify-change-email', verifyChangeEmail);
// Search users endpoint for suggestion/complaint recipient selection
router.get('/search', searchUsers);
router.get('/', getAllUsers);
router.get("/:id/activity/:type", getUserActivityByType);
router.get('/by-jain-aadhar/:number', getUserByJainAadharNumber);

router.post('/change-password', changePassword);
router.post('/upload-profile-picture', authMiddleware,
upload.single('profilePicture'),uploadProfilePicture);
router.post('/skip-profile-picture', authMiddleware, skipProfilePicture);
router.put('/update-privacy/:id', updatePrivacy);
router.put('/:id', 
  authMiddleware,
  upload.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'coverPicture', maxCount: 1 }
  ]),
  upload.compressFiles,  // ✅ ADD THIS - compress karne ke liye
  upload.uploadToS3,     // ✅ ADD THIS - S3 mein upload karne ke liye
  updateUserById
);
router.get('/:id', getUserById);
module.exports = router;
