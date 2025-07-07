
const User = require("../../model/UserRegistrationModels/userModel");
const Block = require('../../model/Block User/Block')
const asyncHandler = require("express-async-handler");
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const dotenv = require("dotenv");
dotenv.config();
const { userValidation } = require('../../validators/validations');
const { errorResponse, successResponse } = require("../../utils/apiResponse");
const { generateToken } = require("../../helpers/authHelpers");
const { sendVerificationEmail, sendPasswordResetEmail } = require('../../services/nodemailerEmailService');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const { isPasswordMatched, validatePassword, getPasswordErrors } = require('../../helpers/userHelpers');
const stateCityData = require("./stateCityData");

// const authLimiter = rateLimit({
//     windowMs: 15 * 60 * 1000, // 15 minutes
//     max: 5,
//     message: { error: 'Too many login attempts. Please try again later.' }
// });

// Generate a random 6-digit code
const generateVerificationCode = () =>{
    return Math.floor(100000 + Math.random() * 900000).toString();
  };
// Register new user with enhanced security
const registerUser = [
    userValidation.register,
    asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return errorResponse(
                res,
                'Validation failed',
                400,
                errors.array().map(err => ({ field: err.param, message: err.msg }))
            );
        }
        const {
            firstName,
            lastName,
            email,
            phoneNumber,
            password,
            birthDate,
            gender,
            location,
        } = req.body;
        // Check if user already exists
        const existingUserByEmail = await User.findOne({ email });

        if (existingUserByEmail) {
            if (existingUserByEmail.isEmailVerified) {
                return errorResponse(res, 'User with this email already exists', 400);
            }
            // 💡 Delete old unverified user to allow re-registration
            await User.deleteOne({ _id: existingUserByEmail._id });
        }
        // Now check phone number AFTER possibly deleting the old user
        const existingUser = await User.findOne({ phoneNumber });
        if (existingUser) {
            return errorResponse(res, 'User with this phone number already exists', 400);
        }
        // Generate verification code
        const verificationCode = generateVerificationCode();
        const codeExpiry = new Date();
        codeExpiry.setMinutes(codeExpiry.getMinutes() + 30); 
        // Enhanced name formatting
        const fullName = lastName.toLowerCase() === 'jain' 
            ? `${firstName} Jain`
            : `${firstName} Jain (${lastName})`;
        
        const newUser = await User.create({
            firstName,
            lastName,
            fullName,
            phoneNumber,
            email,
            password,
            birthDate,
            gender,
            location: {
            country: 'India',
            state: location.state,
            city: location.city
        },
            verificationCode: {
                code: verificationCode,
                expiresAt: codeExpiry
            },
            lastLogin: new Date(),
            accountStatus: 'active',
            registrationStep: 'initial'
        });
            // Send verification email
            try {
                await sendVerificationEmail(email, firstName, verificationCode);
            } catch (error) {
                // Don't fail registration if email fails, but log the error
                console.error('Error sending verification email:', error);
            }    
        // const token = generateToken(newUser);
        // newUser.token = token;
        await newUser.save();
        const userResponse = newUser.toObject();
        delete userResponse.password;
        delete userResponse.__v;
        delete userResponse.verificationCode;
        return successResponse(
            res, 
            {
                user: userResponse,
                verificationCode: newUser.verificationCode,
                nextStep: 'verify_email'
            },
            'User registered successfully. Please verify your email.',
            201
        );
    })
];
const sendVerificationCode = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return errorResponse(res, 'Email is required', 400);
    }

    const user = await User.findOne({ email });

    if (!user) {
        return errorResponse(res, 'User not found', 404);
    }

    if (user.isEmailVerified) {
        return errorResponse(res, 'Email is already verified', 400);
    }

    // Generate new verification code
    const verificationCode = generateVerificationCode();
    const codeExpiry = new Date();
    codeExpiry.setMinutes(codeExpiry.getMinutes() + 30);

    // Save code in user record
    user.verificationCode = {
        code: verificationCode,
        expiresAt: codeExpiry
    };
    await user.save();

    try {
        await sendVerificationEmail(email, user.firstName, verificationCode);
        return successResponse(res, {}, 'Verification code sent to your email');
    } catch (error) {
        console.error('Error sending verification email:', error);
        return errorResponse(res, 'Failed to send verification email', 500);
    }
});
// Verify email with verification code
const verifyEmail = asyncHandler(async (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
        return errorResponse(res, 'Email and verification code are required', 400);
    }

    const user = await User.findOne({ email });

    if (!user) {
        return errorResponse(res, 'User not found', 404);
    }

    if (user.isEmailVerified) {
        return errorResponse(res, 'Email is already verified', 400);
    }

    if (!user.verificationCode || !user.verificationCode.code) {
        return errorResponse(res, 'Verification code not found. Please request a new one.', 400);
    }

    if (new Date() > user.verificationCode.expiresAt) {
        return errorResponse(res, 'Verification code has expired. Please request a new one.', 400);
    }

    if (user.verificationCode.code !== code) {
        return errorResponse(res, 'Invalid verification code', 400);
    }

    // Mark email as verified and clear verification code
    user.isEmailVerified = true;
    user.verificationCode = undefined;
    user.registrationStep = 'initial';

    const token = generateToken(user);
    console.log(token)
    user.token = token;
    await user.save();

    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.__v;

    return successResponse(
        res,
        {
            user: userResponse,
            token,
            nextStep: 'Profile Picture'
        },
        'Email verified successfully',
        200
    );
});
// Send OTP to new email for email change
const sendChangeEmailOtp = asyncHandler(async (req, res) => {
  const { newEmail } = req.body;

  if (!newEmail) {
    return errorResponse(res, 'New email is required', 400);
  }

  // Check if email already exists
  const existingUser = await User.findOne({ email: newEmail });
  if (existingUser) {
    return errorResponse(res, 'Email already in use', 400);
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return errorResponse(res, 'User not found', 404);
  }

  // Generate 6-digit OTP
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  user.tempEmailChange = {
    email: newEmail,
    code,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 min
  };

  await user.save();

  try {
    // ✅ Send formatted verification email
    await sendVerificationEmail(newEmail, user.firstName, code);

    return successResponse(res, {}, 'OTP sent to new email address');
  } catch (error) {
    console.error('Error sending verification email:', error);
    return errorResponse(res, 'Failed to send verification email', 500);
  }
});

const verifyChangeEmail = asyncHandler(async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return errorResponse(res, 'Verification code is required', 400);
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return errorResponse(res, 'User not found', 404);
  }

  const temp = user.tempEmailChange;

  if (!temp || !temp.email || !temp.code) {
    return errorResponse(res, 'No email change request found', 400);
  }

  if (new Date() > temp.expiresAt) {
    return errorResponse(res, 'Verification code expired', 400);
  }

  if (temp.code !== code) {
    return errorResponse(res, 'Invalid verification code', 400);
  }

  // Update email
  user.email = temp.email;
  user.tempEmailChange = undefined;
  user.isEmailVerified = true;
  await user.save();

  return successResponse(res, null, 'Email updated and verified successfully');
});
// Resend verification code
const resendVerificationCode = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return errorResponse(res, 'Email is required', 400);
    }

    const user = await User.findOne({ email });

    if (!user) {
        return errorResponse(res, 'User not found', 404);
    }

    if (user.isEmailVerified) {
        return errorResponse(res, 'Email is already verified', 400);
    }

    // Generate new verification code
    const verificationCode = generateVerificationCode();
    const codeExpiry = new Date();
    codeExpiry.setMinutes(codeExpiry.getMinutes() + 30); // Code expires in 30 minutes

    user.verificationCode = {
        code: verificationCode,
        expiresAt: codeExpiry
    };
    await user.save();

    // Send verification email
    try {
        await sendVerificationEmail(email, user.firstName, verificationCode);
    } catch (error) {
        return errorResponse(res, 'Failed to send verification email', 500);
    }

    return successResponse(
        res,
        {},
        'Verification code resent successfully',
        200
    );
});

// Request password reset
const requestPasswordReset = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return errorResponse(res, 'Email is required', 400);
    }

    const user = await User.findOne({ email });

    // Security-friendly response
    if (!user) {
        return errorResponse(res, 'This email is not registered', 404);
    }

    // ✅ Add this check
    if (!user.isEmailVerified) {
        return errorResponse(res, 'Please verify your email before resetting your password', 403);
    }

    // Continue generating code
    const resetCode = generateVerificationCode();
    const codeExpiry = new Date();
    codeExpiry.setMinutes(codeExpiry.getMinutes() + 30);

    user.resetPasswordCode = {
        code: resetCode,
        expiresAt: codeExpiry
    };
    await user.save();

    try {
        await sendPasswordResetEmail(email, user.firstName, resetCode);
    } catch (error) {
        console.error('Error sending password reset email:', error);
        return errorResponse(res, 'Failed to send password reset email', 500);
    }

    return successResponse(res, {}, 'Password reset code has been sent to your email');
});


// Verify reset code and reset password
const resetPassword = asyncHandler(async (req, res) => {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
        return errorResponse(res, 'Email, reset code, and new password are required', 400);
    }

    const user = await User.findOne({ email });

    if (!user) {
        return errorResponse(res, 'User not found', 404);
    }

    if (!user.resetPasswordCode || !user.resetPasswordCode.code) {
        return errorResponse(res, 'Reset code not found. Please request a new one.', 400);
    }

    if (new Date() > user.resetPasswordCode.expiresAt) {
        return errorResponse(res, 'Reset code has expired. Please request a new one.', 400);
    }

    if (user.resetPasswordCode.code !== code) {
        return errorResponse(res, 'Invalid reset code', 400);
    }

    // Update password and clear reset code
    user.password = newPassword;
    user.resetPasswordCode = undefined;
    await user.save();

    return successResponse(
        res,
        {},
        'Password has been reset successfully',
        200
    );
});

const loginUser = [
   // authLimiter,
    userValidation.login,
    asyncHandler(async (req, res) => {
    const { email, password,captchaToken } = req.body;

    try {
       // 🔒 Step 1: Verify reCAPTCHA token with Google
            if (!captchaToken) {
                return errorResponse(res, "CAPTCHA token is missing", 400);
            }

            const verifyCaptcha = await axios.post(
                `https://www.google.com/recaptcha/api/siteverify`,
                {},
                {
                    params: {
                        secret: process.env.CAPTCHA_KEY,
                        response: captchaToken
                    }
                }
            );

            if (!verifyCaptcha.data.success) {
                return errorResponse(res, "CAPTCHA verification failed", 403);
            }
            const user = await User.findOne({ email });

            if (!user) {
                return errorResponse(res, "Email not found", 401);
              }

              const isMatch = await user.isPasswordMatched(password);
              if (!isMatch) {
                return errorResponse(res, "Incorrect password", 401);
              }

            if (!user.isEmailVerified) {
                return errorResponse(res, "Please verify your email before logging in", 401, {
                    requiresEmailVerification: true
                });
            }
        // Generate tokens
        const token = generateToken(user);
        user.token = token;
        user.lastLogin = new Date();
        await user.save();

        const userResponse = user.toObject();
        delete userResponse.password;
        delete userResponse.__v;

          // Prepare role information for the response
          const roleInfo = {
            hasSanghRoles: user.sanghRoles && user.sanghRoles.length > 0,
            hasPanchRoles: user.panchRoles && user.panchRoles.length > 0,
            hasTirthRoles: user.tirthRoles && user.tirthRoles.length > 0,
            hasVyaparRoles: user.vyaparRoles && user.vyaparRoles.length > 0
        };

        return successResponse(
            res,
            {
                user: userResponse,
                token: token,
                roles: roleInfo
            },
            "Login successful",
            200
        );
    } catch (error) {
        return errorResponse(res, "Login failed", 500, error.message);
    }
})
];

const getAllUsers = asyncHandler(async (req, res) => {
  const { search, city, gender, role, page = 1, limit = 10 } = req.query;
  const currentUserId = req.user._id;

  let query = {};

  // Search
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { fullName: searchRegex },
      { city: searchRegex }
    ];
  }

  // City, Gender, Role filters
  if (city) query.city = new RegExp(city, 'i');
  if (gender) query.gender = gender;
  if (role) query.role = role;

  // ✅ Block logic: get all users I blocked or who blocked me
  const blockedRelations = await Block.find({
    $or: [
      { blocker: currentUserId },
      { blocked: currentUserId },
    ]
  });

  // Get IDs to exclude
  const blockedUserIds = blockedRelations.map(rel => (
    rel.blocker.toString() === currentUserId.toString()
      ? rel.blocked.toString()
      : rel.blocker.toString()
  ));

  // Add condition to exclude those users
  query._id = { $nin: [...blockedUserIds, currentUserId] }; // also exclude self

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const users = await User.find(query)
    .select('-password -__v')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await User.countDocuments(query);

  users.forEach(user => {
    if (user.profilePicture) {
      user.profilePicture = convertS3UrlToCDN(user.profilePicture);
    }
  });

  res.json({
    users: users || [],
    totalUsers: total,
    currentPage: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});
// Enhanced user profile retrieval
const getUserById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const user = await User.findById(id)
        .select('-password -__v')
        .populate('friends', 'firstName lastName profilePicture')
        .populate({
            path: 'posts',
            select: '-__v',
            options: { sort: { createdAt: -1 } }
        })
        .populate('story', 'content createdAt');

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    if (user.profilePicture) {
        user.profilePicture = convertS3UrlToCDN(user.profilePicture);
    }
    const userResponse = user.toObject();
    userResponse.friendCount = user.friends.length;
    userResponse.postCount = user.posts.length;

    res.json(userResponse);
});
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Both current and new password are required' });
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  // ✅ Step 1: Check current password
  const isMatch = await user.isPasswordMatched(currentPassword);
  if (!isMatch) {
    return res.status(400).json({ message: 'Current password is incorrect' });
  }

  // ✅ Step 3: Update and save new password
  user.password = newPassword; // Will be hashed via pre-save middleware
  await user.save();

  return res.status(200).json({ message: 'Password updated successfully' });
});


// Enhanced user update with validation
const updateUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const files = req.files || {}; // ✅ Fix added here

  const newProfilePicture = files.profilePicture?.[0]
    ? convertS3UrlToCDN(files.profilePicture[0].location)
    : null;

  const newCoverPicture = files.coverPicture?.[0]
    ? convertS3UrlToCDN(files.coverPicture[0].location)
    : null;

  if (!req.user || !req.user._id) {
    return res.status(401).json({ error: 'Unauthorized: No valid token' });
  }

  if (req.user._id.toString() !== id) {
    return res.status(403).json({ error: 'Forbidden: You can only update your own profile' });
  }

  delete updates.password;
  delete updates.token;

  const user = await User.findById(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // ✅ Delete Old Profile Picture from S3 If New One is Uploaded
  if (newProfilePicture && user.profilePicture?.startsWith("https")) {
    const oldImageKey = user.profilePicture.split('/').pop(); 
    const params = { Bucket: process.env.AWS_S3_BUCKET_NAME, Key: oldImageKey };
    try {
      await s3.deleteObject(params).promise();
      console.log('✅ Old profile picture deleted from S3:', oldImageKey);
    } catch (error) {
      console.error('❌ Error deleting old profile picture:', error);
    }
  }

  // ✅ Update User Document with New Data
  const updatedUser = await User.findByIdAndUpdate(
    id,
    {
      $set: {
        ...updates,
        ...(newProfilePicture && { profilePicture: newProfilePicture }),
        ...(newCoverPicture && { coverPicture: newCoverPicture }), // ✅ working now
      },
    },
    { new: true, runValidators: true }
  ).select('-password -__v');

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: updatedUser
  });
});


// Enhanced privacy settings
const updatePrivacy = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { privacy } = req.body;

  const user = await User.findByIdAndUpdate(
    id,
    { privacy },
    { new: true }
  ).select('-password -__v');

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    message: 'Privacy settings updated successfully',
    user
  });
});

// Upload profile picture with registration step tracking
const uploadProfilePicture = asyncHandler(async (req, res) => {
    try {
        const userId = req.user._id;
        let imageUrl = null;

        if (req.file) {
            imageUrl = convertS3UrlToCDN(req.file.location); // S3 URL of the uploaded file
        }

        const updateData = {
            registrationStep: 'completed',
            ...(imageUrl && { profilePicture: imageUrl })
        };

        const user = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true }
        ).select('-password -__v');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            message: imageUrl ? 'Profile picture uploaded successfully' : 'Profile picture upload skipped',
            data: {
                user,
                registrationComplete: true
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error processing profile picture',
            error: error.message
        });
    }
});

// Skip profile picture upload
const skipProfilePicture = asyncHandler(async (req, res) => {
    try {
        const userId = req.user._id;
        
        const user = await User.findByIdAndUpdate(
            userId,
            { registrationStep: 'completed' },
            { new: true }
        ).select('-password -__v');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Profile picture upload skipped',
            data: {
                user,
                registrationComplete: true
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error skipping profile picture',
            error: error.message
        });
    }
});
const logoutUser = asyncHandler(async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return errorResponse(res, "User not found", 404);
        }

        // Clear tokens
        user.token = null;
        await user.save();

        return successResponse(
            res, 
            {},
            "Logged out successfully",
            200
        );
    } catch (error) {
        return errorResponse(res, "Logout failed", 500, error.message);
    }
});

// Search users by name, email, or phone - for suggestion/complaint recipient selection
const searchUsers = asyncHandler(async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.length < 3) {
            return errorResponse(res, 'Search query must be at least 3 characters', 400);
        }
        
        const users = await User.find({
            $or: [
                { firstName: { $regex: query, $options: 'i' } },
                { lastName: { $regex: query, $options: 'i' } },
                {fullName : { $regex: query, $options: 'i' }},
                { phoneNumber: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } }
            ]
        }).select('_id firstName lastName phoneNumber email roles profilePicture')
          .limit(10);
        
        // Format user data for frontend
        const formattedUsers = users.map(user => ({
            _id: user._id,
            name: `${user.firstName} ${user.lastName}`,
            phone: user.phoneNumber,
            email: user.email || '',
            roles: user.role || [],
            profilePicture: user.profilePicture || ''
        }));
        
        return successResponse(res, formattedUsers, 'Users retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});
 const getCitiesByState = asyncHandler(async (req, res) => {
  const { state } = req.query;

  if (!state) {
    return res.status(400).json({ message: 'State name is required' });
  }

  const cities = stateCityData[state];

  if (!cities) {
    return res.status(404).json({ message: 'No cities found for this state' });
  }

  res.status(200).json({ state, cities });
});

module.exports = {
    registerUser,
    loginUser,
    getCitiesByState,
    getAllUsers,
    getUserById,
    updateUserById,
    changePassword ,
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
    sendChangeEmailOtp,
    verifyChangeEmail
};
