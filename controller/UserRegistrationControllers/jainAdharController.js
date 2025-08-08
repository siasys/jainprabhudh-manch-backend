const JainAadhar = require('../../model/UserRegistrationModels/jainAadharModel');
const User = require('../../model/UserRegistrationModels/userModel');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const { jainAadharValidation } = require('../../validators/validations');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const { sendVerificationEmail } = require('../../services/nodemailerEmailService');

const EmailVerification = require('../../model/UserRegistrationModels/EmailVerification');

// Check if user has existing application
// const checkExistingApplication = asyncHandler(async (req, res, next) => {
//   const existingApplication = await JainAadhar.findOne({ userId: req.user._id, status: { $in: ['pending', 'approved'] } });
//   if (existingApplication) {
//     return errorResponse(res, 'You already have a pending or approved Jain Aadhar application', 400);
//   }
//   next();
// });
// Determine application level based on location
const determineApplicationLevel = (location) => {
    if (location.area) return 'area';
    if (location.city) return 'city';
    if (location.district) return 'district';
    if (location.state) return 'state';
    return 'superadmin';
};
// Create Jain Aadhar application with level-based routing
const createJainAadhar = asyncHandler(async (req, res) => {
    try {
      const email = req.body.contactDetails?.email;
      const enteredOtp = req.body.otp;

  if (!email || !enteredOtp) {
    return errorResponse(res, 'Email and OTP are required for verification', 400);
  }

  const otpEntry = await EmailVerification.findOne({ email });

  if (!otpEntry || otpEntry.code !== enteredOtp || new Date(otpEntry.expiresAt) < new Date()) {
    return errorResponse(res, 'Invalid or expired OTP', 400);
  }

  // Mark email as verified
  otpEntry.isVerified = true;
  await otpEntry.save();

  req.body.isEmailVerified = true;

const { location } = req.body;
let applicationLevel = 'city';
let reviewingSanghId = req.body.reviewingSanghId || null; // ✅ pehle declare karo

if (!location || !location.state) {
  return errorResponse(res, 'State is required in location data', 400);
}

// ✅ Use frontend values if available
if (req.body.applicationLevel && req.body.reviewingSanghId) {
  applicationLevel = req.body.applicationLevel;
  reviewingSanghId = req.body.reviewingSanghId;
} else if (!location.city && location.district) {
  applicationLevel = 'district';
} else if (!location.district) {
  applicationLevel = 'state';
}

    // Special case: For country level office bearers, route to superadmin
    if (req.body.isOfficeBearer && applicationLevel === 'country') {
      applicationLevel = 'superadmin';
    }

  //  let reviewingSanghId = null;

    if (applicationLevel !== 'superadmin') {
      const query = {
        level: applicationLevel,
        status: 'active',
      };

      if (applicationLevel === 'district') {
        query['location.district'] = location.district;
        query['location.state'] = location.state;
      } else if (applicationLevel === 'state') {
        query['location.state'] = location.state;
      }

      const reviewingSangh = await HierarchicalSangh.findOne(query);

      if (!reviewingSangh) {
        // Handle fallback escalation
        const tryFallbackLevels = async (levels) => {
          for (const level of levels) {
            let sanghQuery = { level, status: 'active' };

            if (level === 'district') {
              sanghQuery['location.district'] = location.district;
              sanghQuery['location.state'] = location.state;
            } else if (level === 'state') {
              sanghQuery['location.state'] = location.state;
            } else if (level === 'country') {
              sanghQuery['location.country'] = location.country || 'India';
            }

            const fallbackSangh = await HierarchicalSangh.findOne(sanghQuery);
            if (fallbackSangh) {
              reviewingSanghId = fallbackSangh._id;
              applicationLevel = level;
              return;
            }
          }

          // If none found, try foundation
          const foundationSangh = await HierarchicalSangh.findOne({
            level: 'foundation',
            status: 'active',
          });
          if (foundationSangh) {
            reviewingSanghId = foundationSangh._id;
            applicationLevel = 'foundation';
          } else {
            applicationLevel = 'superadmin';
          }
        };

        // Start fallback search based on initial level
        if (applicationLevel === 'city') {
          await tryFallbackLevels(['district', 'state', 'country']);
        } else if (applicationLevel === 'district') {
          await tryFallbackLevels(['state', 'country']);
        } else if (applicationLevel === 'state') {
          await tryFallbackLevels(['country']);
        }
      } else {
        reviewingSanghId = reviewingSangh._id;
      }
    }

    const applicantUserId = req.body.applicantUserId || req.user._id;
      // Create application
      const jainAadharData = {
        ...req.body,
        userId:applicantUserId,
        createdBy: req.user._id,
            applicationLevel,
            reviewingSanghId,
            status: 'pending',
            location: {
                country: location.country || 'India',
                state: location.state || '',
                district: location.district || '',
                address: location.address || '',
                pinCode: location.pinCode || '',
            },
            reviewHistory: [{
                action: 'submitted',
                by: req.user._id,
                level: 'user',
                remarks: 'Application submitted',
                timestamp: new Date()
            }]
      };
     if (req.files) {
        // if (req.files.aadharCard && req.files.aadharCard[0]) {
        //     const aadharUrl = req.files.aadharCard[0].location || req.files.aadharCard[0].path;
        //     jainAadharData.AadharCard = convertS3UrlToCDN(aadharUrl);
        // }
        if (req.files.userProfile && req.files.userProfile[0]) {
            const profileUrl = req.files.userProfile[0].location || req.files.userProfile[0].path;
            jainAadharData.userProfile = convertS3UrlToCDN(profileUrl);
        }
    }
      const newJainAadhar = await JainAadhar.create(jainAadharData);

        // Update user's status
          const user = await User.findById(req.user._id);

            if (user.jainAadharStatus !== 'verified') {
            await User.findByIdAndUpdate(req.user._id, {
                jainAadharStatus: 'pending',
                jainAadharApplication: newJainAadhar._id
            });
            }

        return successResponse(res, newJainAadhar, 'Application submitted successfully', 201);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});

const sendEmailVerificationOtp = async (req, res) => {
  const { email, name } = req.body;

  if (!email) return errorResponse(res, 'Email is required', 400);

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  try {
    await sendVerificationEmail(email, name || 'User', code);

    await EmailVerification.findOneAndUpdate(
      { email },
      { code, expiresAt, isVerified: false },
      { upsert: true }
    );

    return successResponse(res, null, 'OTP sent to your email');
  } catch (err) {
    console.error(err);
    return errorResponse(res, 'Failed to send OTP', 500);
  }
};
const verifyEmailOtp = async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return errorResponse(res, 'Email and OTP code are required', 400);
  }

  try {
    const record = await EmailVerification.findOne({ email });

    if (!record) {
      return errorResponse(res, 'No OTP sent to this email', 404);
    }

    if (record.code !== code) {
      return errorResponse(res, 'Incorrect OTP', 400);
    }

    if (new Date() > record.expiresAt) {
      return errorResponse(res, 'OTP expired', 400);
    }

    // Mark as verified
    record.isVerified = true;
    await record.save();

    return successResponse(res, null, 'Email verified successfully');
  } catch (err) {
    console.error(err);
    return errorResponse(res, 'OTP verification failed', 500);
  }
};
const resendEmailVerificationOtp = async (req, res) => {
  const { email, name } = req.body;

  if (!email) return errorResponse(res, 'Email is required', 400);

  try {
    // Check if email exists in verification DB (optional)
    const existingRecord = await EmailVerification.findOne({ email });
    if (!existingRecord) {
      return errorResponse(res, 'No OTP request found for this email', 404);
    }

    // Generate new OTP code
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    const newExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Update record with new code and expiry, reset verification status
    await EmailVerification.findOneAndUpdate(
      { email },
      { code: newCode, expiresAt: newExpiresAt, isVerified: false },
      { upsert: true }
    );

    // Send new OTP email
    await sendVerificationEmail(email, name || 'User', newCode);

    return successResponse(res, null, 'OTP resent to your email');
  } catch (err) {
    console.error('Resend OTP Error:', err);
    return errorResponse(res, 'Failed to resend OTP', 500);
  }
};

const verifyJainAadhar = async (req, res) => {
  try {
    const jainAadhar = req.params.jainAadharNumber.trim();
    const record = await JainAadhar.findOne({ jainAadharNumber: jainAadhar });
    
    if (!record) {
      return res.status(404).json({ success: false, message: 'Jain Aadhar not found' });
    }

    res.status(200).json({
      success: true,
      user: {
        name: record.name,
        userId: record.userId,
      }
    });
  } catch (error) {
    console.error('Jain Aadhar verify error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get application status
const getApplicationStatus = asyncHandler(async (req, res) => {
  try {
    const application = await JainAadhar.findOne({ userId: req.user._id })
      .select('-AadharCard');
    if (!application) {
      return errorResponse(res, 'No Jain Aadhar application found', 404);
    }

    return successResponse(res, {
      status: application.status,
      applicationId: application._id,
      submittedAt: application.createdAt
    }, 'Application status retrieved successfully');
  } catch (error) {
    return errorResponse(res, 'Error fetching application status', 500, error.message);
  }
});
const getApplicationsReview = asyncHandler(async (req, res) => {
  try {
    const { level, sanghId } = req.query;

    const filter = {};

    if (level) {
      filter.applicationLevel = level;
    }

    if (sanghId) {
      filter.reviewingSanghId = sanghId;
    }

    const applications = await JainAadhar.find(filter)
      .populate('userId', 'firstName lastName fullName email')
      .sort('-createdAt');

    return successResponse(
      res,
      applications,
      'Filtered applications retrieved successfully',
      200,
      applications.length
    );
  } catch (error) {
    return errorResponse(res, 'Error fetching applications', 500, error.message);
  }
});

// Admin: Get all applications
const getAllApplications = asyncHandler(async (req, res) => {
  try {
    const applications = await JainAadhar.find()
      .populate('userId', 'firstName lastName fullName email')
      .sort('-createdAt');

    return successResponse(res, applications, 'Applications retrieved successfully', 200, applications.length);
  } catch (error) {
    return errorResponse(res, 'Error fetching applications', 500, error.message);
  }
});

// Function to generate unique Jain Aadhar number
const generateJainAadharNumber = async () => {
  while (true) {
    // Generate a random 8-digit number
    const randomNum = Math.floor(10000000 + Math.random() * 90000000);
    const jainAadharNumber = `JAIN${randomNum}`;

    // Check if this number already exists
    const existingUser = await User.findOne({ jainAadharNumber });
    if (!existingUser) {
      return jainAadharNumber;
    }
  }
};

// Get applications for review based on level and reviewer's authority
const getApplicationsForReview = asyncHandler(async (req, res) => {
    try {
        const userId = req.user._id;
        const reviewerLevel = req.reviewerLevel;
        const reviewerSanghId = req.reviewerSanghId;

        // For superadmin - can review all applications routed to superadmin level
        if (reviewerLevel === 'superadmin') {
            const applications = await JainAadhar.find({
                applicationLevel: 'superadmin',
                status: 'pending'
            })
            .populate('userId')
            .populate('reviewingSanghId', 'name level location')
            .sort('-createdAt');
            
            return successResponse(res, applications, 'Applications retrieved successfully');
        }

        // For admin with verify permissions - can review all pending applications
        if (reviewerLevel === 'admin') {
            const applications = await JainAadhar.find({
                status: 'pending'
            })
            .populate('userId')
            .populate('reviewingSanghId', 'name level location')
            .sort('-createdAt');

            return successResponse(res, applications, 'Applications retrieved successfully');
        }
         // ✅ Normal user - Can only see their own applications
         if (reviewerLevel === "user") {
            const applications = await JainAadhar.find({ userId: userId })
                .populate("userId")
                .populate("reviewingSanghId", "name level location")
                .sort("-createdAt");

            return successResponse(res, applications, "User applications retrieved successfully");
        }
        // For country president - can review all country-level applications
        if (reviewerLevel === 'country') {
            const applications = await JainAadhar.find({
                applicationLevel: 'superadmin',  // Country applications are routed to superadmin
                status: 'pending'
            })
            .populate('userId')
            .populate('reviewingSanghId', 'name level location')
            .sort('-createdAt');
            return successResponse(res, applications, 'Applications retrieved successfully');
        }

        // For state, district or city presidents
        if (['state', 'district', 'city','area'].includes(reviewerLevel)) {
            const sangh = await HierarchicalSangh.findById(reviewerSanghId);
            if (!sangh) {
                return errorResponse(res, 'Sangh not found', 404);
            }
            // Build location query based on president's authority
            const locationQuery = {
                status: 'pending',
                applicationLevel: reviewerLevel
            };
            if (reviewerLevel === 'area') {
                locationQuery['location.area'] = sangh.location.area;
                locationQuery['location.city'] = sangh.location.city;
                locationQuery['location.district'] = sangh.location.district;
                locationQuery['location.state'] = sangh.location.state;
            } else if (reviewerLevel === 'city') {
                locationQuery['location.city'] = sangh.location.city;
                locationQuery['location.district'] = sangh.location.district;
                locationQuery['location.state'] = sangh.location.state;
            } else if (reviewerLevel === 'district') {
                locationQuery['location.district'] = sangh.location.district;
                locationQuery['location.state'] = sangh.location.state;
            } else if (reviewerLevel === 'state') {
                locationQuery['location.state'] = sangh.location.state;
            }

            const applications = await JainAadhar.find(locationQuery)
                .populate('userId')
                .populate('reviewingSanghId', 'name level location')
                .sort('-createdAt');

            return successResponse(res, applications, 'Applications retrieved successfully');
        }

        return errorResponse(res, 'Invalid reviewer level', 400);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});

// Review application
const reviewApplication = asyncHandler(async (req, res) => {
  try {
        // Handle both parameter names (id and applicationId) for compatibility
        const appId = req.params.applicationId || req.params.id;
        const { status, remarks } = req.body;
        const userId = req.user._id;
        const reviewerLevel = req.reviewerLevel;
        const reviewerSanghId = req.reviewerSanghId;

        const allApplications = await JainAadhar.find({});
        const application = await JainAadhar.findById(appId);
    if (!application) {
      return errorResponse(res, 'Application not found', 404);
    }
    // Prevent re-reviewing applications that are already approved or rejected
    if (application.status !== 'pending') {
        return errorResponse(res, `This application has already been ${application.status}. Cannot review again.`, 400);
    }
    // Verify reviewer's authority
    let hasAuthority = false;
    let reviewerSangh = null;
        // Superadmin can review any application
        if (reviewerLevel === 'superadmin') {
            hasAuthority = true;
        }
        // Admin with verify permissions can review any application
        else if (reviewerLevel === 'admin' && req.user.adminPermissions.includes('verify_jain_aadhar')) {
            hasAuthority = true;
        }
        // Country president can review superadmin level applications
        else if (reviewerLevel === 'country') {
            if (application.applicationLevel === 'superadmin') {
                hasAuthority = true;
            } else {
                return errorResponse(res, `This application is not at country level for review`, 403);
            }
        }
        // State president can review state level applications
        else if (reviewerLevel === 'state') {
            if (application.applicationLevel !== 'state') {
                return errorResponse(res, `This application is not at state level for review`, 403);
            }
            // Get the reviewer's sangh details
            reviewerSangh = await HierarchicalSangh.findById(reviewerSanghId);
            if (!reviewerSangh) {
                return errorResponse(res, 'Reviewer sangh not found', 404);
            }
            // Verify location authority
            hasAuthority = verifyLocationAuthority(reviewerSangh, application);
        }

        // District and city presidents can only review applications from their area
        else if (reviewerLevel === 'district' || reviewerLevel === 'city') {
            // Ensure application is at the correct level
            if (application.applicationLevel.toLowerCase() !== reviewerLevel.toLowerCase()){
                return errorResponse(res, `This application is not at ${reviewerLevel} level for review`, 403);
            }
            // Get the reviewer's sangh details
            reviewerSangh = await HierarchicalSangh.findById(reviewerSanghId);
            if (!reviewerSangh) {
                return errorResponse(res, 'Reviewer sangh not found', 404);
            }
            // Verify location authority
            hasAuthority = verifyLocationAuthority(reviewerSangh, application);
        }

        if (!hasAuthority) {
            return errorResponse(res, 'Not authorized to review this application', 403);
        }

        // Update application
        application.status = status;
        // Add review details to history
        application.reviewHistory.push({
            action: status,
            by: userId,
            level: reviewerLevel,
            sanghId: reviewerSanghId,
      remarks,
            timestamp: new Date()
        });
        // Update reviewedBy information
        application.reviewedBy = {
            userId: userId,
            role: reviewerLevel === 'district' || reviewerLevel === 'city' ? 'president' : reviewerLevel,
            level: reviewerLevel,
            sanghId: reviewerSanghId
        };

    if (status === 'approved') {
      const jainAadharNumber = await generateJainAadharNumber();
        application.jainAadharNumber = jainAadharNumber;

      const user = await User.findById(application.userId);

      if (!user?.jainAadharNumber && user?.jainAadharStatus !== 'verified') {
    await User.findByIdAndUpdate(application.userId, {
      jainAadharStatus: 'verified',
      jainAadharNumber,
      city: application.location.city,
      district: application.location.district,
      state: application.location.state
    });
  }
        } else if (status === 'rejected') {
      await User.findByIdAndUpdate(application.userId, {
        jainAadharStatus: 'rejected'
      });
    }
        await application.save();
        return successResponse(res, application, `Application ${status} successfully`);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// Helper function to verify location authority
const verifyLocationAuthority = (sangh, application) => {
   switch (application.applicationLevel.toLowerCase()){
        case 'area':
            return sangh.location.area === application.location.area &&
                   sangh.location.city === application.location.city &&
                   sangh.location.district === application.location.district &&
                   sangh.location.state === application.location.state;
        case 'city':
            return sangh.location.city === application.location.city &&
                   sangh.location.district === application.location.district &&
                   sangh.location.state === application.location.state;
        case 'district':
            return sangh.location.district === application.location.district &&
                   sangh.location.state === application.location.state;
        case 'state':
            return sangh.location.state === application.location.state;
        case 'country':
            return true;
        default:
            return false;
    }
};
const reviewBySanghPresident = asyncHandler(async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status, remarks, userId, level, sanghId } = req.body;

    const reviewerLevel = level?.toLowerCase();
    const reviewerSanghId = sanghId;

    if (!['district', 'state', 'country'].includes(reviewerLevel)) {
      return errorResponse(res, 'Only district/state/country level presidents can review', 403);
    }

    const application = await JainAadhar.findById(applicationId);
    if (!application) return errorResponse(res, 'Application not found', 404);

    if (application.status !== 'pending') {
      return errorResponse(res, `This application has already been ${application.status}`, 400);
    }

    if (application.applicationLevel?.toLowerCase() !== reviewerLevel) {
      return errorResponse(res, `Application is not at ${reviewerLevel} level`, 403);
    }

    if (String(application.reviewingSanghId) !== String(reviewerSanghId)) {
      return errorResponse(res, 'You are not authorized to review this application', 403);
    }

    application.status = status;
    application.reviewHistory.push({
      action: status,
      by: userId,
      level: reviewerLevel,
      sanghId: reviewerSanghId,
      remarks,
      timestamp: new Date(),
    });

    application.reviewedBy = {
      userId,
      role: 'president',
      level: reviewerLevel,
      sanghId: reviewerSanghId,
    };

    if (status === 'approved') {
      const jainAadharNumber = await generateJainAadharNumber();
      application.jainAadharNumber = jainAadharNumber;

      await User.findByIdAndUpdate(application.userId, {
        jainAadharStatus: 'verified',
        jainAadharNumber,
        city: application.location.city,
        district: application.location.district,
        state: application.location.state,
      });
    } else if (status === 'rejected') {
      await User.findByIdAndUpdate(application.userId, {
        jainAadharStatus: 'rejected',
      });
    }

    await application.save();
    return successResponse(res, application, `Application ${status} successfully`);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});


// Admin: Get detailed application statistics
const getApplicationStats = asyncHandler(async (req, res) => {
  try {
    const stats = await JainAadhar.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          applications: { $push: '$$ROOT' }
        }
      }
    ]);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStats = await JainAadhar.countDocuments({
      createdAt: { $gte: todayStart }
    });

    return successResponse(res, {
      overall: stats,
      today: todayStats
    }, 'Application statistics retrieved successfully');
  } catch (error) {
    return errorResponse(res, 'Error fetching statistics', 500, error.message);
  }
});

// Admin: Get application details with all documents
const getApplicationDetails = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const application = await JainAadhar.findById(id)
      .populate('userId', 'firstName lastName email mobile');
    if (!application) {
      return errorResponse(res, 'Application not found', 404);
    }
    return successResponse(res, application, 'Application details retrieved successfully');
  } catch (error) {
    return errorResponse(res, 'Error fetching application details', 500, error.message);
  }
});

// Admin: Add review comment
const addReviewComment = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const application = await JainAadhar.findByIdAndUpdate(
      id,
      {
        $push: {
          reviewComments: {
            comment,
            reviewedBy: req.user._id,
            reviewedAt: Date.now()
          }
        }
      },
      { new: true }
    );
    return successResponse(res, application, 'Review comment added');
  } catch (error) {
    return errorResponse(res, 'Error adding review comment', 500, error.message);
  }
});

// Get applications by level and location
const getApplicationsByLevel = asyncHandler(async (req, res) => {
    try {
        const { level } = req.params;
        const { city, district, state, status } = req.query;
        // Get user's Sangh role
        const userRole = req.user.sanghRoles.find(role =>
            role.role === 'president' && role.level === level
        );
        if (!userRole) {
            return errorResponse(res, 'Not authorized to view applications at this level', 403);
        }
        // Build query based on level and location
        const query = {
            applicationLevel: level,
            status: status || 'pending'
        };

        // Add location filters based on president's level
        if (level === 'city') {
            query['location.city'] = city;
            query['location.district'] = district;
            query['location.state'] = state;
        } else if (level === 'district') {
            query['location.district'] = district;
            query['location.state'] = state;
        } else if (level === 'state') {
            query['location.state'] = state;
        }
        const applications = await JainAadhar.find(query)
            .populate('userId', 'firstName lastName email phoneNumber')
            .sort('-createdAt');

        return successResponse(res, applications, 'Applications retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});

// Review application at specific level
const reviewApplicationByLevel = asyncHandler(async (req, res) => {
    try {
        const { applicationId } = req.params;
        const { status, remarks } = req.body;
        const application = await JainAadhar.findById(applicationId);
        if (!application) {
            return errorResponse(res, 'Application not found', 404);
        }
        // Prevent re-reviewing applications that are already approved or rejected
        if (application.status !== 'pending') {
            return errorResponse(res, `This application has already been ${application.status}. Cannot review again.`, 400);
        }

        // Verify reviewer's authority
        const userRole = req.user.sanghRoles.find(role =>
            role.role === 'president' &&
            role.level === application.applicationLevel
        );

        if (!userRole) {
            return errorResponse(res, 'Not authorized to review this application', 403);
        }

        // Update application status
        application.status = status;
        application.reviewedBy = {
            userId: req.user._id,
            role: 'president',
            level: userRole.level,
            sanghId: userRole.sanghId
        };

        // Add to review history
        application.reviewHistory.push({
            action: status,
            by: req.user._id,
            level: userRole.level,
            sanghId: userRole.sanghId,
            remarks
        });

        // If approved, generate Jain Aadhar number
        if (status === 'approved') {
            const jainAadharNumber = await generateJainAadharNumber();
            // Update user's status and Jain Aadhar number
            await User.findByIdAndUpdate(application.userId, {
                jainAadharStatus: 'verified',
                jainAadharNumber
            });

            application.jainAadharNumber = jainAadharNumber;
        }

        await application.save();

        return successResponse(res, application, `Application ${status} successfully`);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});

// Get verified members for Sangh
const getVerifiedMembers = asyncHandler(async (req, res) => {
    try {
        const { level, city, district, state } = req.query;

        // Build location query
        const locationQuery = {};
        if (city) locationQuery.city = city;
        if (district) locationQuery.district = district;
        if (state) locationQuery.state = state;

        const members = await User.find({
            jainAadharStatus: 'verified',
            ...locationQuery
        }).select('firstName lastName jainAadharNumber email phoneNumber city district state');

        return successResponse(res, members, 'Verified members retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
  }
});
// Edit Jain Aadhar application details
const editJainAadhar = asyncHandler(async (req, res) => {
  try {
    const applicationId = req.params.applicationId;
    console.log("Received Application ID:", applicationId);

    // Check if application exists
    const application = await JainAadhar.findById(applicationId);
    if (!application) {
      return errorResponse(res, 'Application not found', 404);
    }

    // ✅ Parse JSON fields from FormData
    if (typeof req.body.contactDetails === 'string') {
      req.body.contactDetails = JSON.parse(req.body.contactDetails);
    }
    if (typeof req.body.location === 'string') {
      req.body.location = JSON.parse(req.body.location);
    }
    if (typeof req.body.conversionDetails === 'string') {
      req.body.conversionDetails = JSON.parse(req.body.conversionDetails);
    }
    if (typeof req.body.marriedStatus === 'string') {
      try {
        req.body.marriedStatus = JSON.parse(req.body.marriedStatus);
      } catch (e) {
        // keep it as string "No"
      }
    }

    // ✅ If userProfile file uploaded, convert URL & attach
    if (req.files?.userProfile?.[0]) {
      const profileUrl = req.files.userProfile[0].location || req.files.userProfile[0].path;
      req.body.userProfile = convertS3UrlToCDN(profileUrl);
    }

    // ✅ Create edit history log
    const editHistory = {
      action: 'edited',
      by: req.user._id,
      level: req.editingLevel,
      sanghId: req.editingSanghId,
      remarks: req.body.editRemarks || 'Application details edited',
      timestamp: new Date()
    };

    // ✅ Perform the update
    const updatedApplication = await JainAadhar.findByIdAndUpdate(
      applicationId,
      {
        $set: req.body,
        $push: { reviewHistory: editHistory }
      },
      { new: true }
    );

    return successResponse(res, updatedApplication, 'Application updated successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});


module.exports = {
  reviewBySanghPresident,
  getApplicationsReview,
  sendEmailVerificationOtp,
  resendEmailVerificationOtp,
  verifyEmailOtp,
  createJainAadhar,
  getApplicationStatus,
  getAllApplications,
  getApplicationsForReview,
  reviewApplication,
  getApplicationStats,
  getApplicationDetails,
  addReviewComment,
  getApplicationsByLevel,
  reviewApplicationByLevel,
  getVerifiedMembers,
  editJainAadhar,
  verifyJainAadhar
};