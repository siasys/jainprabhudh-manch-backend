const express = require('express');
const router = express.Router();
const { 
  createJainAadhar,
  getApplicationStatus,
  getAllApplications,
  reviewApplication,
  getApplicationStats,
  getApplicationDetails,
  addReviewComment,
  getApplicationsByLevel,
  reviewApplicationByLevel,
  getVerifiedMembers,
  getApplicationsForReview,
  editJainAadhar,
  //checkExistingApplication,
  verifyJainAadhar,
  getApplicationsReview,
  reviewBySanghPresident,
  sendEmailVerificationOtp,
  verifyEmailOtp,
  resendEmailVerificationOtp,
  reviewByAdmin
} = require('../../controller/UserRegistrationControllers/jainAdharController');
const { authMiddleware, canReviewJainAadhar } = require('../../middlewares/authMiddlewares');
const { canEditJainAadhar } = require('../../middlewares/jainAadharEditPermissions');
const { canReviewJainAadharByLocation } = require('../../middlewares/sanghPermissions');
const upload = require('../../middlewares/upload');
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { generateJainAadharCard } = require('../../controller/UserRegistrationControllers/generateCard');

// Rate limiting for application submission
// const applicationLimiter = rateLimit({
//   windowMs: 24 * 60 * 60 * 1000, // 24 hours
//   max: 3, // limit each IP to 1 application per day
//   message: {
//     success: false,
//     message: 'Too many applications. Please try again tomorrow.'
//   },
//   standardHeaders: true,
//   keyGenerator: (req) => req.user ? req.user.id : req.ip // Use user ID if available
// });

// Rate limiting for status checks
const statusCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per 15 minutes
  message: {
    success: false,
    message: 'Too many status checks. Please try again later.'
  }
});

// Protected routes (require authentication)
router.use(authMiddleware);

// User routes
router.post(
  '/apply',
  // applicationLimiter,
  upload.jainAadharDocs,
  //checkExistingApplication,
  createJainAadhar
);
// routes/jainAadharRoutes.js
router.post('/send-email-otp', sendEmailVerificationOtp);
router.post('/verify-email-otp', verifyEmailOtp);
router.post('/resend-email-otp', resendEmailVerificationOtp);

router.get(
  '/status',
  statusCheckLimiter,
  getApplicationStatus
);
router.get('/verify/:jainAadharNumber', verifyJainAadhar);
// Admin/Superadmin routes (require review permissions)
router.use(canReviewJainAadhar);

// Admin application management
router.get(
  '/applications',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
    query('status').optional().isIn(['pending', 'approved', 'rejected']).withMessage('Invalid status value'),
    query('sortBy').optional().isIn(['createdAt', 'updatedAt']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order')
  ],
  getAllApplications
);
router.get('/applications', getApplicationsReview);
router.get('/generate-card/:id', generateJainAadharCard);
router.get('/verify/jain-shravak/:jainAadharNumber', async (req, res) => {
  try {
    const { jainAadharNumber } = req.params;

    const application = await JainAadhar.findOne({ jainAadharNumber });

    if (!application) {
      return res.status(404).send(`<h2 style="text-align:center;color:red">Verification Failed ❌</h2>`);
    }

    res.send(`
      <html>
        <head><title>Card Verification</title></head>
        <body style="text-align:center; font-family:sans-serif; margin-top: 40px;">
          <h1>Your Jain Shravak Card is Verified ✅</h1>
          <h3 style="margin-bottom: 40px;">Below are your card details:</h3>

          <div style="display:inline-block; text-align:left; font-size:18px; line-height:1.6;">
            <p><strong>Name:</strong> ${application.name || 'N/A'}</p>
            <p><strong>Father/Husband Name:</strong> ${application.pitaOrpatiName || 'N/A'}</p>
            <p><strong>Date of Birth:</strong> ${application.dob || 'N/A'}</p>
            <p><strong>Mul Jain:</strong> ${application.mulJain || 'N/A'}</p>
            <p><strong>Panth:</strong> ${application.panth || 'N/A'}</p>
            <p><strong>Sub Caste:</strong> ${application.subCaste || 'N/A'}</p>
            <p><strong>Gotra:</strong> ${application.gotra || 'N/A'}</p>
            <p><strong>City:</strong> ${application.location?.city || 'N/A'}</p>
            <p><strong>Jain Aadhar Number:</strong> ${application.jainAadharNumber || 'N/A'}</p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Verification Error:", err.message);
    res.status(500).send(`<h2 style="text-align:center;color:red">Server Error. Please try again.</h2>`);
  }
});

// Admin application management
// router.get(
//   '/applications',
//   [
//     query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
//     query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
//     query('status').optional().isIn(['pending', 'approved', 'rejected']).withMessage('Invalid status value'),
//     query('sortBy').optional().isIn(['createdAt', 'updatedAt']).withMessage('Invalid sort field'),
//     query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order')
//   ],
//   getAllApplications
// );

// Get applications for review based on reviewer's authority level
router.get(
    '/applications/for-review',
    getApplicationsForReview
);

router.get(
  '/applications/stats',
  getApplicationStats
);

router.get(
  '/applications/:id',
  [
    param('id').isMongoId().withMessage('Invalid application ID')
  ],
  getApplicationDetails
);

// Admin review actions
// router.put(
//   '/applications/:id/review',
//   reviewApplication
// );


// Review application - for all authorized reviewers (superadmin, admin, district/city presidents)
router.put(
  '/applications/:id/review',
  [
      param('applicationId').isMongoId().withMessage('Invalid application ID'),
      body('status').isIn(['approved', 'rejected']).withMessage('Invalid status'),
      body('remarks').optional().isString().withMessage('Remarks must be a string')
  ],
  reviewApplication
);
router.put(
  '/applications/:applicationId/review-by-president',
  reviewBySanghPresident
);
router.put('/applications/:applicationId/review-by-admin', reviewByAdmin);

// Edit Jain Aadhar application
router.put(
  '/applications/:applicationId/edit',
  // [
  //     param('applicationId').isMongoId().withMessage('Invalid application ID'),
  //     body('editRemarks').optional().isString().withMessage('Edit remarks must be a string')
  // ],
 upload.jainAadharDocs,
  editJainAadhar
);
router.post(
  '/applications/:id/comment',
  addReviewComment
);

// Get applications by specific level - for backward compatibility
router.get(
  '/applications/level/:level',
  [
      param('level').isIn(['superadmin', 'country', 'state', 'district', 'city']).withMessage('Invalid level')
  ],
  getApplicationsByLevel
);

// Get verified members for Sangh
router.get(
  '/verified-members',
  [
      query('level').isIn(['city', 'district', 'state', 'country']).withMessage('Invalid level'),
      query('city').optional().isString(),
      query('district').optional().isString(),
      query('state').optional().isString()
  ],
  getVerifiedMembers
);


module.exports = router;