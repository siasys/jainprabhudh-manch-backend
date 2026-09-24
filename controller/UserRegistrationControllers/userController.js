const User = require("../../model/UserRegistrationModels/userModel");
const JainAadharApplication = require("../../model/UserRegistrationModels/jainAadharModel");
const ScreenTime = require("../../model/UserRegistrationModels/screenTimeModel");
const Block = require("../../model/Block User/Block");
const MobileOtpVerification = require("../../model/UserRegistrationModels/MobileOtpVerification");
const asyncHandler = require("express-async-handler");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
dotenv.config();
const { userValidation } = require("../../validators/validations");
const { errorResponse, successResponse } = require("../../utils/apiResponse");
const { generateToken } = require("../../helpers/authHelpers");
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require("../../services/nodemailerEmailService");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
const {
  isPasswordMatched,
  validatePassword,
  getPasswordErrors,
} = require("../../helpers/userHelpers");
const stateCityData = require("./stateCityData");
const EmailVerification = require("../../model/UserRegistrationModels/EmailVerification");
const { sendVerificationSms } = require("../../services/smsHelper");
const { sendVerificationWhatsApp } = require("../../services/Whatsapphelper"); // ✅ NEW: WhatsApp helper
const { s3Client, DeleteObjectCommand } = require("../../config/s3Config");
const mongoose = require("mongoose");
const { processUserLocation } = require("../../helpers/locationHelper");
// const authLimiter = rateLimit({
//     windowMs: 15 * 60 * 1000, // 15 minutes
//     max: 5,
//     message: { error: 'Too many login attempts. Please try again later.' }
// });

// Generate a random 6-digit code
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Function to generate fullName dynamically
function generateFullName(firstName, lastName) {
  if (!firstName && !lastName) {
    return "";
  }

  if (!firstName) firstName = "";
  if (!lastName) lastName = "";
  if (lastName.toLowerCase() === "jain") {
    return `${firstName} ${lastName}`.trim();
  } else if (lastName) {
    return `${firstName} Jain (${lastName})`.trim();
  } else {
    return `${firstName} Jain`.trim();
  }
}
const registerUser = asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    phoneNumber,
    email,
    password,
    birthDate,
    accountType,
    location,
  } = req.body;

  if (!phoneNumber && !email) {
    return errorResponse(res, "Phone number or email is required", 400);
  }

  const fullName = generateFullName(firstName, lastName);

  // Check duplicates
  if (phoneNumber) {
    const existingPhoneUser = await User.findOne({ phoneNumber });
    if (existingPhoneUser) {
      return errorResponse(
        res,
        "User with this phone number already exists",
        400,
      );
    }
  }

  // ✅ Only check email if it's not empty
  if (email && email?.trim()) {
    const existingEmailUser = await User.findOne({ email });
    if (existingEmailUser) {
      return errorResponse(res, "User with this email already exists", 400);
    }
  }

  // Save in OTP/email-verification collection
  const verificationCode = generateVerificationCode();
  const codeExpiry = new Date(Date.now() + 5 * 60 * 1000);

  let tempData = {
    firstName: firstName || "",
    lastName: lastName || "",
    fullName: fullName || "",
    phoneNumber,
    email,
    password,
    birthDate,
    accountType,
    location: location || {},
  };

  if (phoneNumber) {
    await MobileOtpVerification.create({
      phoneNumber,
      code: verificationCode,
      expiresAt: codeExpiry,
      isVerified: false,
      tempUserData: tempData,
    });

    await sendVerificationSms(phoneNumber, verificationCode, firstName);
    return successResponse(
      res,
      {},
      "Verification OTP sent on mobile. Please verify.",
    );
  }

  if (email) {
    await EmailVerification.create({
      email,
      code: verificationCode,
      expiresAt: codeExpiry,
      isVerified: false,
      tempUserData: tempData,
    });

    await sendVerificationEmail(email, firstName, verificationCode);
    return successResponse(
      res,
      {},
      "Verification OTP sent on email. Please verify.",
    );
  }
});
const verifyRegisterOtp = asyncHandler(async (req, res) => {
  const { phoneNumber, email, otp } = req.body;

  if (!phoneNumber && !email) {
    return errorResponse(res, "Phone number or email is required", 400);
  }

  if (!otp) {
    return errorResponse(res, "OTP is required", 400);
  }

  // ✅ Mobile OTP Verify
  if (phoneNumber) {
    const otpRecord = await MobileOtpVerification.findOne({ phoneNumber }).sort(
      { createdAt: -1 },
    );

    if (!otpRecord) {
      return errorResponse(res, "OTP not found, please request again", 404);
    }

    if (otpRecord.isVerified) {
      return errorResponse(res, "OTP already verified", 400);
    }

    if (otpRecord.expiresAt < Date.now()) {
      return errorResponse(res, "OTP expired, please request again", 400);
    }

    if (otpRecord.code !== otp) {
      return errorResponse(res, "Invalid OTP", 400);
    }

    // ✅ Mark OTP verified
    otpRecord.isVerified = true;
    await otpRecord.save();

    // ✅ Create final user with phone verified flag
    const newUser = await User.create({
      ...otpRecord.tempUserData,
      isPhoneVerified: true,
    });

    return successResponse(
      res,
      newUser,
      "Phone OTP verified successfully, user created.",
    );
  }

  // ✅ Email OTP Verify
  if (email) {
    const otpRecord = await EmailVerification.findOne({ email }).sort({
      createdAt: -1,
    });

    if (!otpRecord) {
      return errorResponse(res, "OTP not found, please request again", 404);
    }

    if (otpRecord.isVerified) {
      return errorResponse(res, "OTP already verified", 400);
    }

    if (otpRecord.expiresAt < Date.now()) {
      return errorResponse(res, "OTP expired, please request again", 400);
    }

    if (otpRecord.code !== otp) {
      return errorResponse(res, "Invalid OTP", 400);
    }

    // ✅ Mark OTP verified
    otpRecord.isVerified = true;
    await otpRecord.save();

    // ✅ Create final user with email verified flag
    const newUser = await User.create({
      ...otpRecord.tempUserData,
      isEmailVerified: true,
    });

    return successResponse(
      res,
      newUser,
      "Email OTP verified successfully, user created.",
    );
  }
});

// const registerFinalUser = asyncHandler(async (req, res) => {
//   let { userData } = req.body;

//   if (!userData) {
//     return errorResponse(res, "User data is required", 400);
//   }

//   if (typeof userData === "string") {
//     userData = JSON.parse(userData);
//   }

//   const {
//     firstName,
//     lastName,
//     fullName,
//     birthDate,
//     email,
//     phoneNumber,
//     accountType,
//     sadhuName,
//     businessName,
//     businessDate,
//     shravakId,
//     password,
//     isEmailVerified = false,
//     isPhoneVerified = false,
//   } = userData;

//   // ✅ Duplicate check only for the field user is using
//   if (phoneNumber && (!email || email.trim() === "")) {
//     const existingPhoneUser = await User.findOne({ phoneNumber: String(phoneNumber) });
//     if (existingPhoneUser) {
//       return errorResponse(res, "User with this phone number already exists", 400);
//     }
//   }

//   if (email && (!phoneNumber || phoneNumber.trim() === "")) {
//     const existingEmailUser = await User.findOne({ email: email.toLowerCase() });
//     if (existingEmailUser) {
//       return errorResponse(res, "User with this email already exists", 400);
//     }
//   }

//   //Create user object based on accountType
//   let newUserData = {
//     email: email?.trim() || undefined,
//     phoneNumber: phoneNumber?.trim() || undefined,
//     accountType,
//     isEmailVerified,
//     isPhoneVerified,
//     password
//   };

//   if (accountType === "business") {
//     newUserData.businessName = businessName?.trim() || "";
//     newUserData.businessDate = businessDate || "";
//     newUserData.shravakId = shravakId || "";
//   }
//   else if (accountType === "sadhu") {
//     newUserData.sadhuName = sadhuName?.trim() || "";
//     newUserData.shravakId = shravakId || "";
//   }
//  else {
//   // 👤 Regular User Registration
//   newUserData.firstName = firstName?.trim() || "";
//   newUserData.lastName = lastName?.trim() || "";
//   newUserData.fullName = fullName?.trim() || "";

//   // BirthDate optional — only add if provided
//   if (birthDate) {
//     newUserData.birthDate = birthDate;
//   }
// }

//   // ✅ Create user in DB
//   const newUser = await User.create(newUserData);

//   // ✅ Generate token
//   const token = generateToken(newUser);
//   newUser.token = token;
//   await newUser.save();

//   // ✅ Prepare response
//   const userResponse = newUser.toObject();
//   delete userResponse.password;
//   delete userResponse.__v;

//   return successResponse(
//     res,
//     { newUser: userResponse, token },
//     "User registered successfully."
//   );
// });

// New register without number and email check
const registerFinalUser = asyncHandler(async (req, res) => {
  let { userData } = req.body;

  if (!userData) {
    return errorResponse(res, "User data is required", 400);
  }

  if (typeof userData === "string") {
    userData = JSON.parse(userData);
  }

  const {
    firstName,
    lastName,
    fullName,
    birthDate,
    email,
    phoneNumber,
    accountType,
    sadhuName,
    businessName,
    businessDate,
    tirthName,
    shravakId,
    password,
    isEmailVerified = false,
    isPhoneVerified = false,
    country,
  } = userData;

  // Duplicate check only against accountType "user"
  if (accountType === "user") {
    const orConditions = [];

    if (phoneNumber?.trim()) {
      orConditions.push({
        phoneNumber: phoneNumber.trim(),
        accountType: "user",
      });
    }

    // ✅ Only check email if it's not empty
    if (email && email?.trim()) {
      orConditions.push({ email: email.trim(), accountType: "user" });
    }

    if (orConditions.length > 0) {
      const existingUser = await User.findOne({ $or: orConditions });

      if (existingUser) {
        const isPhoneDuplicate =
          phoneNumber?.trim() &&
          existingUser.phoneNumber === phoneNumber.trim();

        const isEmailDuplicate =
          email?.trim() && existingUser.email === email.trim();

        if (isPhoneDuplicate) {
          return errorResponse(
            res,
            "This phone number is already registered, please login.",
            409,
          );
        }

        if (isEmailDuplicate) {
          return errorResponse(
            res,
            "This email is already registered, please login.",
            409,
          );
        }
      }
    }
  }

  // Prepare user object
  let newUserData = {
    email: email?.trim() || undefined,
    phoneNumber: phoneNumber?.trim() || undefined,
    accountType,
    isEmailVerified,
    isPhoneVerified,
    password,
  };

  if (accountType === "business") {
    newUserData.businessName = businessName?.trim() || "";
    newUserData.businessDate = businessDate || "";
    newUserData.shravakId = shravakId || "";
  } else if (accountType === "sadhu") {
    newUserData.sadhuName = sadhuName?.trim() || "";
    newUserData.shravakId = shravakId || "";
  } else if (accountType === "tirth") {
    newUserData.tirthName = tirthName?.trim() || "";
    newUserData.shravakId = shravakId || "";
  } else {
    newUserData.firstName = firstName?.trim() || "";
    newUserData.lastName = lastName?.trim() || "";
    newUserData.fullName = fullName?.trim() || "";
    if (birthDate) {
      newUserData.birthDate = birthDate;
    }
  }
  if (country) {
    newUserData.location = { country };
  }

  const newUser = await User.create(newUserData);

  const token = generateToken(newUser);
  newUser.token = token;
  await newUser.save();

  const userResponse = newUser.toObject();
  delete userResponse.password;
  delete userResponse.__v;

  return successResponse(
    res,
    { newUser: userResponse, token },
    "User registered successfully.",
  );
});

// Register new user with enhanced security
// const registerUser = asyncHandler(async (req, res) => {
//   const { firstName, lastName, phoneNumber, email, password, birthDate, gender, location } = req.body;

//   // Generate fullName
//   const fullName = generateFullName(firstName, lastName);

//   // Check if phone number already exists
//   const existingPhoneUser = await User.findOne({ phoneNumber });
//   if (existingPhoneUser) {
//     return errorResponse(res, 'User with this phone number already exists', 400);
//   }

//   // If old OTP exists, delete it
//   let pending = await MobileOtpVerification.findOne({ phoneNumber });
//   if (pending && pending.isVerified === false) {
//     await MobileOtpVerification.deleteOne({ phoneNumber });
//   }

//   // Generate OTP
//   const verificationCode = generateVerificationCode();
//   const codeExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry

//   // Save in DB
//   await MobileOtpVerification.create({
//     phoneNumber,
//     code: verificationCode,
//     expiresAt: codeExpiry,
//     isVerified: false,
//     tempUserData: {
//       firstName,
//       lastName,
//       fullName,
//       phoneNumber,
//       email,
//       password,
//       birthDate,
//       gender,
//       location
//     }
//   });

//   // Send SMS
//   try {
//     await sendVerificationSms(phoneNumber, verificationCode, firstName);
//     return successResponse(res, {}, 'Verification OTP sent on mobile. Please verify.');
//   } catch (error) {
//     console.error('SMS send error:', error);
//     return errorResponse(res, 'Failed to send verification OTP', 500);
//   }
// });

// Register woith mobile new modal
const sendOtp = asyncHandler(async (req, res) => {
  const { phoneNumber, email, country = "India" } = req.body; // ✅ NEW: Country parameter add किया

  if (!phoneNumber && !email) {
    return errorResponse(res, "Phone number or email is required", 400);
  }

  // ✅ ───────── NEW BLOCK START ─────────
  // Signup screen (MobileNumber.jsx) `checkExisting: true` bhejti hai.
  // Login / resend / add-another-account ye flag nahi bhejte, isliye
  // unke liye behaviour bilkul pehle jaisa hi rahega.
  if (req.body?.checkExisting === true) {
    // DUPLICATE KA NIYAM accountType PAR TIKA HAI — registerFinalUser neeche
    // theek yahi niyam lagata hai, aur dono ka ek jaisa hona zaroori hai.
    // Warna user yahan ruk jata hai jabki account banne me koi rukawat nahi
    // thi — wahi ho raha tha, kyunki yeh check accountType dekhta hi nahi tha.
    //
    //   accountType "user"  → ek number/email par SIRF EK personal account.
    //   business/sadhu/tirth → usi type ka account pehle se ho tabhi rok.
    //
    // Yani ek vyakti apne personal account wale number se apna vyapar, sadhu
    // ya tirth account bana sakta hai — aksar wahi vyakti dono chalata hai.
    const accountType = String(req.body?.accountType || "user").trim();

    const orQuery = [];
    if (phoneNumber) {
      orQuery.push({ phoneNumber: String(phoneNumber).trim(), accountType });
    }
    if (email) {
      orQuery.push({ email: String(email).trim().toLowerCase(), accountType });
    }

    if (orQuery.length > 0) {
      const alreadyRegistered = await User.findOne({ $or: orQuery })
        .select("_id phoneNumber email accountType")
        .lean();

      if (alreadyRegistered) {
        // 409 + userExists flag — frontend isi se login notice dikhata hai
        return res.status(409).json({
          success: false,
          userExists: true,
          accountType,
          message: phoneNumber
            ? "This mobile number is already registered. Please login."
            : "This email is already registered. Please login.",
        });
      }
    }
  }
  // ✅ ───────── NEW BLOCK END ─────────

  // 📱 Phone number case
  if (phoneNumber) {
    // const existingUser = await User.findOne({ phoneNumber: String(phoneNumber) });
    // if (existingUser) {
    //   return errorResponse(res, "User with this phone number already exists", 400);
    // }

    await MobileOtpVerification.deleteMany({ phoneNumber, isVerified: false });

    const verificationCode = generateVerificationCode();
    const codeExpiry = new Date(Date.now() + 5 * 60 * 1000);

    await MobileOtpVerification.create({
      phoneNumber,
      code: verificationCode,
      expiresAt: codeExpiry,
      isVerified: false,
    });

    // ✅ NEW: Country के हिसाब से SMS या WhatsApp भेजो
    const isIndiaUser = country.toLowerCase() === "india";

    if (isIndiaUser) {
      // 📱 SMS भेजो (India के लिए)
      console.log(`[OTP] Sending SMS to India: ${phoneNumber}`);
      const smsResult = await sendVerificationSms(
        phoneNumber,
        verificationCode,
      );
      console.log(`[OTP] SMS Result:`, smsResult);
      return successResponse(res, {}, "Verification OTP sent via SMS 📱");
    } else {
      // 💬 WhatsApp भेजो (International के लिए)
      console.log(`[OTP] Sending WhatsApp to ${country}: ${phoneNumber}`);
      const whatsappResult = await sendVerificationWhatsApp(
        phoneNumber,
        verificationCode,
        req.body.firstName,
        country, // ✅ Pass country for correct formatting
      );
      console.log(`[OTP] WhatsApp Result:`, whatsappResult);

      if (whatsappResult.statusCode === 0 || whatsappResult.success) {
        return successResponse(
          res,
          {},
          `Verification OTP sent via WhatsApp for ${country} 💬`,
        );
      } else {
        return errorResponse(
          res,
          whatsappResult.message || "Failed to send OTP",
          400,
        );
      }
    }
  }

  // 📧 Email case
  if (email) {
    // const existingUser = await User.findOne({ email: email.toLowerCase() });
    // if (existingUser) {
    //   return errorResponse(res, "User with this email already exists", 400);
    // }

    await EmailVerification.deleteMany({ email, isVerified: false });

    const verificationCode = generateVerificationCode();
    const codeExpiry = new Date(Date.now() + 5 * 60 * 1000);

    try {
      await EmailVerification.create({
        email,
        code: verificationCode,
        expiresAt: codeExpiry,
        isVerified: false,
      });

      await sendVerificationEmail(email, "User", verificationCode);
      return successResponse(res, {}, "Verification OTP sent on email 📧");
    } catch (err) {
      if (err.code === 11000) {
        return errorResponse(res, "User with this email already exists", 400);
      }
      console.error("Email OTP error:", err);
      return errorResponse(res, "Something went wrong while sending OTP", 500);
    }
  }
});
// Resend OTP (for phone or email)
// Resend OTP (for phone or email)
const resendOtp = asyncHandler(async (req, res) => {
  const { phoneNumber, email, country = "India" } = req.body; // ✅ Add country parameter

  if (!phoneNumber && !email) {
    return errorResponse(res, "Phone number or email is required", 400);
  }

  // 📱 Phone number case
  if (phoneNumber) {
    const existingOtp = await MobileOtpVerification.findOne({ phoneNumber });

    if (!existingOtp) {
      return errorResponse(
        res,
        "No OTP request found for this phone number",
        404,
      );
    }

    // Purana OTP delete
    await MobileOtpVerification.deleteMany({ phoneNumber });

    const verificationCode = generateVerificationCode();
    const codeExpiry = new Date(Date.now() + 5 * 60 * 1000);

    await MobileOtpVerification.create({
      phoneNumber,
      code: verificationCode,
      expiresAt: codeExpiry,
      isVerified: false,
    });

    // ✅ NEW: Country के हिसाब से SMS या WhatsApp भेजो (जैसे sendOtp में)
    const isIndiaUser = country.toLowerCase() === "india";

    if (isIndiaUser) {
      // 📱 SMS भेजो (India के लिए)
      console.log(`[Resend OTP] Sending SMS to India: ${phoneNumber}`);
      await sendVerificationSms(phoneNumber, verificationCode);
      return successResponse(res, {}, "OTP resent via SMS 📱");
    } else {
      // 💬 WhatsApp भेजो (International के लिए)
      console.log(
        `[Resend OTP] Sending WhatsApp to ${country}: ${phoneNumber}`,
      );
      const whatsappResult = await sendVerificationWhatsApp(
        phoneNumber,
        verificationCode,
        req.body.firstName || "User",
        country, // ✅ Pass country for correct formatting
      );

      if (whatsappResult.statusCode === 0 || whatsappResult.success) {
        return successResponse(
          res,
          {},
          `OTP resent via WhatsApp for ${country} 💬`,
        );
      } else {
        return errorResponse(
          res,
          whatsappResult.message || "Failed to send WhatsApp OTP",
          500,
        );
      }
    }
  }

  // Email case
  if (email) {
    const existingOtp = await EmailVerification.findOne({
      email: email.toLowerCase(),
    });

    if (!existingOtp) {
      return errorResponse(res, "No OTP request found for this email", 404);
    }

    // Purana OTP delete
    await EmailVerification.deleteMany({ email });

    const verificationCode = generateVerificationCode();
    const codeExpiry = new Date(Date.now() + 5 * 60 * 1000);

    try {
      await EmailVerification.create({
        email: email.toLowerCase(),
        code: verificationCode,
        expiresAt: codeExpiry,
        isVerified: false,
      });

      await sendVerificationEmail(email, "User", verificationCode);
      return successResponse(res, {}, "OTP resent on email 📧");
    } catch (err) {
      console.error("Email OTP resend error:", err);
      return errorResponse(
        res,
        "Something went wrong while resending OTP",
        500,
      );
    }
  }
});

const verifyOtpMobileEmail = asyncHandler(async (req, res) => {
  const { phoneNumber, email, otp } = req.body;

  let record;

  if (phoneNumber) {
    // ✅ Get OTP by phone
    record = await MobileOtpVerification.findOne({ phoneNumber }).sort({
      createdAt: -1,
    });
    if (!record)
      return errorResponse(res, "No OTP request found for this number", 400);
  } else if (email) {
    // ✅ Get OTP by email
    record = await EmailVerification.findOne({ email }).sort({ createdAt: -1 });
    if (!record)
      return errorResponse(res, "No OTP request found for this email", 400);
  } else {
    return errorResponse(res, "Phone number or email is required", 400);
  }

  // ✅ Already verified
  if (record.isVerified === true)
    return errorResponse(res, "Already verified", 400);

  // ✅ Expired
  if (record.expiresAt < new Date())
    return errorResponse(res, "OTP expired", 400);

  // ✅ Wrong OTP
  if (record.code !== otp) return errorResponse(res, "Invalid OTP", 400);

  // ✅ Mark OTP as verified
  record.isVerified = true;
  await record.save();

  // ✅ Respond back (User creation ab alag API me hoga)
  if (phoneNumber) {
    return successResponse(
      res,
      { phoneNumber },
      "Phone number verified successfully ✅",
    );
  }

  if (email) {
    return successResponse(res, { email }, "Email verified successfully ✅");
  }
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { phoneNumber, otp } = req.body;
  //  Fetch latest OTP request for this number
  const record = await MobileOtpVerification.findOne({ phoneNumber }).sort({
    createdAt: -1,
  });
  if (!record)
    return errorResponse(res, "No OTP request found for this number", 400);

  // ✅ Strict boolean check
  if (record.isVerified === true)
    return errorResponse(res, "Already verified", 400);

  if (record.expiresAt < new Date())
    return errorResponse(res, "OTP expired", 400);

  if (record.code !== otp) return errorResponse(res, "Invalid OTP", 400);

  // ✅ Mark OTP as verified
  record.isVerified = true;
  await record.save();

  // ✅ Create user and mark phone as verified
  const {
    firstName,
    lastName,
    phoneNumber: phone,
    email,
    password,
    birthDate,
    gender,
    location,
  } = record.tempUserData;

  const newUser = await User.create({
    firstName,
    lastName,
    fullName: generateFullName(firstName, lastName),
    phoneNumber: phone,
    email,
    password,
    birthDate,
    gender,
    location,
    isPhoneVerified: true,
    isEmailVerified: true,
  });

  const token = generateToken(newUser._id);

  return successResponse(
    res,
    { user: newUser, token },
    "User registered successfully",
  );
});

const sendVerificationCode = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return errorResponse(res, "Email is required", 400);
  }

  const user = await User.findOne({ email });

  if (!user) {
    return errorResponse(res, "User not found", 404);
  }

  if (user.isEmailVerified) {
    return errorResponse(res, "Email is already verified", 400);
  }

  // Generate new verification code
  const verificationCode = generateVerificationCode();
  const codeExpiry = new Date();
  codeExpiry.setMinutes(codeExpiry.getMinutes() + 30);

  // Save code in user record
  user.verificationCode = {
    code: verificationCode,
    expiresAt: codeExpiry,
  };
  await user.save();

  try {
    await sendVerificationEmail(email, user.firstName, verificationCode);
    return successResponse(res, {}, "Verification code sent to your email");
  } catch (error) {
    console.error("Error sending verification email:", error);
    return errorResponse(res, "Failed to send verification email", 500);
  }
});
const verifyEmails = asyncHandler(async (req, res) => {
  const { email, code } = req.body;

  const record = await EmailVerification.findOne({ email });
  if (!record) return errorResponse(res, "No pending verification found", 404);

  if (record.isVerified)
    return errorResponse(res, "Email already verified", 400);

  if (record.code !== code)
    return errorResponse(res, "Invalid verification code", 400);

  if (new Date() > record.expiresAt) {
    return errorResponse(res, "Verification code expired", 400);
  }

  // Mark verified
  record.isVerified = true;
  await record.save();

  // Create user in main User collection
  const {
    firstName,
    lastName,
    phoneNumber,
    password,
    birthDate,
    gender,
    location,
  } = record.tempUserData;
  const fullName =
    lastName.toLowerCase() === "jain"
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
      country: "India",
      state: location.state,
      district: location.district,
      city: location.city,
    },
    isEmailVerified: true,
    lastLogin: new Date(),
    accountStatus: "active",
    registrationStep: "initial",
  });

  const token = generateToken(newUser);
  newUser.token = token;
  await newUser.save();

  const userResponse = newUser.toObject();
  delete userResponse.password;
  delete userResponse.__v;

  return successResponse(
    res,
    { user: userResponse, token },
    "Email verified and user created",
  );
});

// Verify email with verification code
const verifyEmail = asyncHandler(async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return errorResponse(res, "Email and verification code are required", 400);
  }

  const user = await User.findOne({ email });

  if (!user) {
    return errorResponse(res, "User not found", 404);
  }

  if (user.isEmailVerified) {
    return errorResponse(res, "Email is already verified", 400);
  }

  if (!user.verificationCode || !user.verificationCode.code) {
    return errorResponse(
      res,
      "Verification code not found. Please request a new one.",
      400,
    );
  }

  if (new Date() > user.verificationCode.expiresAt) {
    return errorResponse(
      res,
      "Verification code has expired. Please request a new one.",
      400,
    );
  }

  if (user.verificationCode.code !== code) {
    return errorResponse(res, "Invalid verification code", 400);
  }

  // Mark email as verified and clear verification code
  user.isEmailVerified = true;
  user.verificationCode = undefined;
  user.registrationStep = "initial";

  const token = generateToken(user);
  // console.log(token)
  user.token = token;
  await user.save();

  const userResponse = user.toObject();
  userResponse.id = user._id;
  delete userResponse.password;
  delete userResponse.__v;

  return successResponse(
    res,
    {
      user: userResponse,
      token,
      nextStep: "Profile Picture",
    },
    "Email verified successfully",
    200,
  );
});
// Send OTP to new email for email change
const sendChangeEmailOtp = asyncHandler(async (req, res) => {
  const { newEmail } = req.body;

  if (!newEmail) {
    return errorResponse(res, "New email is required", 400);
  }

  // Check if email already exists
  const existingUser = await User.findOne({ email: newEmail });
  if (existingUser) {
    return errorResponse(res, "Email already in use", 400);
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return errorResponse(res, "User not found", 404);
  }

  // Generate 6-digit OTP
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  user.tempEmailChange = {
    email: newEmail,
    code,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min
  };

  await user.save();

  try {
    // ✅ Send formatted verification email
    await sendVerificationEmail(newEmail, user.firstName, code);

    return successResponse(res, {}, "OTP sent to new email address");
  } catch (error) {
    console.error("Error sending verification email:", error);
    return errorResponse(res, "Failed to send verification email", 500);
  }
});

const verifyChangeEmail = asyncHandler(async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return errorResponse(res, "Verification code is required", 400);
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return errorResponse(res, "User not found", 404);
  }

  const temp = user.tempEmailChange;

  if (!temp || !temp.email || !temp.code) {
    return errorResponse(res, "No email change request found", 400);
  }

  if (new Date() > temp.expiresAt) {
    return errorResponse(res, "Verification code expired", 400);
  }

  if (temp.code !== code) {
    return errorResponse(res, "Invalid verification code", 400);
  }

  // Update email and clear temp request
  user.email = temp.email;
  user.tempEmailChange = undefined; // clear temp data
  user.isEmailVerified = true;

  await user.save();

  return successResponse(res, null, "Email updated and verified successfully");
});

const sendChangePhoneOtp = asyncHandler(async (req, res) => {
  const { newPhoneNumber } = req.body;

  if (!newPhoneNumber) {
    return errorResponse(res, "New mobile number is required", 400);
  }

  // Check if phone number already exists
  const existingUser = await User.findOne({ phoneNumber: newPhoneNumber });
  if (existingUser) {
    return errorResponse(res, "Mobile number already in use", 400);
  }

  const user = await User.findById(req.user._id);
  if (!user) return errorResponse(res, "User not found", 404);

  // Generate 6-digit OTP
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  user.tempPhoneChange = {
    phoneNumber: newPhoneNumber,
    code,
    expiresAt,
  };

  await user.save();

  try {
    // Send OTP via SMS
    await sendVerificationSms(newPhoneNumber, code, user.firstName);

    return successResponse(res, {}, "OTP sent to new mobile number");
  } catch (error) {
    console.error("Error sending verification SMS:", error);
    return errorResponse(res, "Failed to send OTP", 500);
  }
});

const verifyChangePhone = asyncHandler(async (req, res) => {
  const { code } = req.body;

  if (!code) return errorResponse(res, "Verification code is required", 400);

  const user = await User.findById(req.user._id);
  if (!user) return errorResponse(res, "User not found", 404);

  const temp = user.tempPhoneChange;

  if (!temp || !temp.phoneNumber || !temp.code) {
    return errorResponse(res, "No phone change request found", 400);
  }

  if (new Date() > temp.expiresAt) {
    return errorResponse(res, "Verification code expired", 400);
  }

  if (temp.code !== code) {
    return errorResponse(res, "Invalid verification code", 400);
  }

  // Update phone number
  user.phoneNumber = temp.phoneNumber;
  user.tempPhoneChange = undefined;

  // Mark phone verified; consider either email or phone verification sufficient
  if (!user.isPhoneVerified) user.isPhoneVerified = true;
  if (!user.isEmailVerified) user.isEmailVerified = true; // optional, depends on your logic

  await user.save();

  return successResponse(
    res,
    null,
    "Mobile number updated and verified successfully",
  );
});
// Resend verification code
const resendVerificationCode = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return errorResponse(res, "Email is required", 400);
  }

  const user = await User.findOne({ email });

  if (!user) {
    return errorResponse(res, "User not found", 404);
  }

  if (user.isEmailVerified) {
    return errorResponse(res, "Email is already verified", 400);
  }

  // Generate new verification code
  const verificationCode = generateVerificationCode();
  const codeExpiry = new Date();
  codeExpiry.setMinutes(codeExpiry.getMinutes() + 30); // Code expires in 30 minutes

  user.verificationCode = {
    code: verificationCode,
    expiresAt: codeExpiry,
  };
  await user.save();

  // Send verification email
  try {
    await sendVerificationEmail(email, user.firstName, verificationCode);
  } catch (error) {
    return errorResponse(res, "Failed to send verification email", 500);
  }

  return successResponse(res, {}, "Verification code resent successfully", 200);
});
// Request password reset via mobile number
const requestPasswordResetMobile = asyncHandler(async (req, res) => {
  let { phoneNumber } = req.body;

  if (!phoneNumber) {
    return errorResponse(res, "Mobile number is required", 400);
  }
  // Clean number (remove spaces, +, - etc.)
  phoneNumber = phoneNumber.replace(/\D/g, "");

  // Ensure last 10 digits
  const last10Digits = phoneNumber.slice(-10);

  // EXACT match pehle. International numbers har jagah 10 ank ke nahi hote —
  // Australia ka "412345678" 9 ank ka hai, aur kai desh ke 11+ ke. Sirf
  // last-10 par dhoondhne se lambe number kat jate hain aur user "registered
  // hi nahi hai" sun leta hai, jabki uska account maujood hai.
  const user = await User.findOne({
    $or: [
      { phoneNumber },
      { phoneNumber: last10Digits },
      { phoneNumber: `+91${last10Digits}` },
    ],
  });

  if (!user) {
    return errorResponse(res, "This mobile number is not registered", 404);
  }

  if (!user.isPhoneVerified && !user.isEmailVerified) {
    return errorResponse(
      res,
      "Please verify your mobile number before resetting your password",
      403,
    );
  }
  // Generate 6-digit OTP
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  const codeExpiry = new Date();
  codeExpiry.setMinutes(codeExpiry.getMinutes() + 30);

  user.resetPasswordCode = {
    code: resetCode,
    expiresAt: codeExpiry,
  };
  await user.save();

  // KIS RAASTE SE BHEJNA HAI, YEH ACCOUNT KHUD BATATA HAI.
  //
  // Registration me country frontend se aati hai, par yahan user logged out
  // hai — uske paas batane ko kuch nahi. Isliye country DB se padhi jati hai,
  // wahi jo usne registration ke waqt chuni thi. Frontend par bharosa karna
  // yahan chalta bhi nahi aur zaruri bhi nahi.
  //
  // Purane accounts par location.country nahi hota; unke liye India maan lena
  // wahi purana behaviour hai, isliye kuch toota nahi.
  const country = user.location?.country || "India";
  const isIndiaUser = String(country).toLowerCase() === "india";

  // Number WAHI bhejo jo account par darj hai.
  //
  // Pehle yahan `+91${last10Digits}` tha — India ke liye theek, par Australia
  // ke "412345678" ko wo "+91412345678" bana deta tha, yaani OTP kisi ajnabi
  // Indian number par chala jata aur asli user intezaar karta reh jata.
  const targetNumber = user.phoneNumber;

  try {
    if (isIndiaUser) {
      console.log(`[reset] Sending SMS to India: ${targetNumber}`);
      await sendVerificationSms(
        targetNumber,
        resetCode,
        user.firstName || "User",
      );
    } else {
      console.log(`[reset] Sending WhatsApp to ${country}: ${targetNumber}`);
      const whatsappResult = await sendVerificationWhatsApp(
        targetNumber,
        resetCode,
        user.firstName || "User",
        country, // ✅ sahi formatting ke liye country
      );
      if (!(whatsappResult.statusCode === 0 || whatsappResult.success)) {
        return errorResponse(
          res,
          whatsappResult.message || "Failed to send password reset OTP",
          500,
        );
      }
    }
  } catch (error) {
    console.error("Error sending password reset OTP:", error);
    return errorResponse(res, "Failed to send password reset OTP", 500);
  }

  // `channel` frontend ko bhej rahe hain taaki wo sach bata sake — "check your
  // WhatsApp" jab WhatsApp par gaya ho. User ko sahi jagah dekhna chahiye.
  return successResponse(
    res,
    { channel: isIndiaUser ? "sms" : "whatsapp", country },
    isIndiaUser
      ? "Password reset OTP has been sent to your mobile number"
      : "Password reset OTP has been sent on WhatsApp",
  );
});

// Request password reset
const requestPasswordReset = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return errorResponse(res, "Email is required", 400);
  }

  const user = await User.findOne({ email });

  // Security-friendly response
  if (!user) {
    return errorResponse(res, "This email is not registered", 404);
  }

  // ✅ Add this check
  if (!user.isEmailVerified) {
    return errorResponse(
      res,
      "Please verify your email before resetting your password",
      403,
    );
  }

  // Continue generating code
  const resetCode = generateVerificationCode();
  const codeExpiry = new Date();
  codeExpiry.setMinutes(codeExpiry.getMinutes() + 30);

  user.resetPasswordCode = {
    code: resetCode,
    expiresAt: codeExpiry,
  };
  await user.save();

  try {
    await sendPasswordResetEmail(email, user.firstName, resetCode);
  } catch (error) {
    console.error("Error sending password reset email:", error);
    return errorResponse(res, "Failed to send password reset email", 500);
  }

  return successResponse(
    res,
    {},
    "Password reset code has been sent to your email",
  );
});

// Verify reset code and reset password via mobile number
const verifyResetPassword = asyncHandler(async (req, res) => {
  let { phoneNumber, code, newPassword } = req.body;

  if (!phoneNumber || !code || !newPassword) {
    return errorResponse(
      res,
      "Mobile number, reset code, and new password are required",
      400,
    );
  }

  // ✅ Clean number (remove spaces, +, - etc.)
  phoneNumber = phoneNumber.replace(/\D/g, "");

  // ✅ Ensure last 10 digits
  const last10Digits = phoneNumber.slice(-10);

  // ✅ Try finding with both formats
  const user = await User.findOne({
    $or: [
      { phoneNumber: last10Digits }, // stored without +91
      { phoneNumber: `+91${last10Digits}` }, // stored with +91
    ],
  });

  if (!user) {
    return errorResponse(res, "User not found", 404);
  }

  if (!user.resetPasswordCode || !user.resetPasswordCode.code) {
    return errorResponse(
      res,
      "Reset code not found. Please request a new one.",
      400,
    );
  }

  if (new Date() > user.resetPasswordCode.expiresAt) {
    return errorResponse(
      res,
      "Reset code has expired. Please request a new one.",
      400,
    );
  }

  if (user.resetPasswordCode.code !== code) {
    return errorResponse(res, "Invalid reset code", 400);
  }

  // ✅ Update password and clear reset code
  user.password = newPassword;
  user.resetPasswordCode = undefined;
  await user.save();

  return successResponse(res, {}, "Password has been reset successfully", 200);
});

// Verify reset code and reset password
const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return errorResponse(
      res,
      "Email, reset code, and new password are required",
      400,
    );
  }

  const user = await User.findOne({ email });

  if (!user) {
    return errorResponse(res, "User not found", 404);
  }

  if (!user.resetPasswordCode || !user.resetPasswordCode.code) {
    return errorResponse(
      res,
      "Reset code not found. Please request a new one.",
      400,
    );
  }

  if (new Date() > user.resetPasswordCode.expiresAt) {
    return errorResponse(
      res,
      "Reset code has expired. Please request a new one.",
      400,
    );
  }

  if (user.resetPasswordCode.code !== code) {
    return errorResponse(res, "Invalid reset code", 400);
  }

  // Update password and clear reset code
  user.password = newPassword;
  user.resetPasswordCode = undefined;
  await user.save();

  return successResponse(res, {}, "Password has been reset successfully", 200);
});

// const loginUser = [
//   userValidation.login,
//   asyncHandler(async (req, res) => {
//     let { phoneNumber, password } = req.body;

//     if (!phoneNumber) {
//       return errorResponse(res, "Phone number is required", 400);
//     }

//     // Normalize number (sirf digits rakho)
//     phoneNumber = phoneNumber.replace(/\D/g, "");
//     const last10Digits = phoneNumber.slice(-10);

//     // Possible formats
//     const plainNumber = last10Digits;          // e.g. "7415147930"
//     const withPrefix = "+91" + last10Digits;   // e.g. "+917415147930"

//     try {
//       // DB me dono format check karo
//       const user = await User.findOne({
//         phoneNumber: { $in: [plainNumber, withPrefix] }
//       });

//       if (!user) {
//         return errorResponse(res, "Phone number not found", 401);
//       }

//       const isMatch = await user.isPasswordMatched(password);
//       if (!isMatch) {
//         return errorResponse(res, "Incorrect password", 401);
//       }

//       if (!user.isEmailVerified && !user.isPhoneVerified) {
//         return errorResponse(
//           res,
//           "Please verify your email or phone number before logging in",
//           401,
//           { requiresVerification: true }
//         );
//       }

//       // Generate token
//       const token = generateToken(user);
//       user.token = token;
//       user.lastLogin = new Date();
//       await user.save();

//       const userResponse = user.toObject();
//       delete userResponse.password;
//       delete userResponse.__v;

//       const roleInfo = {
//         hasSanghRoles: user.sanghRoles?.length > 0,
//         hasPanchRoles: user.panchRoles?.length > 0,
//         hasTirthRoles: user.tirthRoles?.length > 0,
//         hasVyaparRoles: user.vyaparRoles?.length > 0,
//       };

//       return successResponse(
//         res,
//         { user: userResponse, token, roles: roleInfo },
//         "Login successful",
//         200
//       );
//     } catch (error) {
//       return errorResponse(res, "Login failed", 500, error.message);
//     }
//   }),
// ];

// login with number and email
const loginUser = [
  userValidation.login,
  asyncHandler(async (req, res) => {
    let { phoneNumber, email, password } = req.body;

    if (!phoneNumber && !email) {
      return errorResponse(res, "Phone number or email is required", 400);
    }

    let query = {};

    // ================= PHONE LOGIN =================
    if (phoneNumber) {
      phoneNumber = phoneNumber.replace(/\D/g, "");
      const last10Digits = phoneNumber.slice(-10);

      query.phoneNumber = {
        $in: [last10Digits, `+91${last10Digits}`],
      };
    }

    // ================= EMAIL LOGIN =================
    if (email) {
      query.email = email.toLowerCase();
    }

    try {
      // 🔴 CHANGE #1: findOne ❌ → find ✅
      const users = await User.find(query);

      if (!users || users.length === 0) {
        return errorResponse(res, "User not found", 401);
      }

      // 🔴 CHANGE #2: check password for ALL matched users
      let matchedUser = null;

      for (const user of users) {
        const isMatch = await user.isPasswordMatched(password);
        if (isMatch) {
          matchedUser = user;
          break;
        }
      }

      if (!matchedUser) {
        return errorResponse(res, "Incorrect password", 401);
      }
      // ================= SUSPENDED CHECK =================
      if (matchedUser.accountStatus === "deactivated") {
        return errorResponse(
          res,
          "Your account has been suspended. Please contact Jain Prabudh Manch for help.",
          403,
        );
      }
      // ================= VERIFICATION CHECK =================
      // if (!matchedUser.isEmailVerified && !matchedUser.isPhoneVerified) {
      //   return errorResponse(
      //     res,
      //     "Please verify your email or phone number before logging in",
      //     401,
      //     { requiresVerification: true }
      //   );
      // }

      // ================= TOKEN =================
      const token = generateToken(matchedUser);
      matchedUser.token = token;
      matchedUser.lastLogin = new Date();
      await matchedUser.save();

      const userResponse = matchedUser.toObject();
      delete userResponse.password;
      delete userResponse.__v;

      userResponse.token = token;

      return successResponse(res, userResponse, "Login successful", 200);
    } catch (error) {
      console.error("Login Error:", error);
      return errorResponse(res, "Login failed", 500, error.message);
    }
  }),
];

const getAllUsers = asyncHandler(async (req, res) => {
  const {
    search,
    country,
    state,
    district,
    city,
    gender,
    role,
    accountType,
    page = 1,
    limit = 20,
  } = req.query;

  const currentUserId = req.user._id.toString();
  let query = {};

  if (search) {
    const searchRegex = new RegExp(search, "i");
    query.$or = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { fullName: searchRegex },
      { businessName: searchRegex },
      { tirthName: searchRegex },
      { sadhuName: searchRegex },
      { "location.country": searchRegex },
      { "location.state": searchRegex },
      { "location.district": searchRegex },
      { "location.city": searchRegex },
    ];
  }

  if (country) query["location.country"] = new RegExp(country, "i");
  if (state) query["location.state"] = new RegExp(state, "i");
  if (district) query["location.district"] = new RegExp(district, "i");
  if (city) query["location.city"] = new RegExp(city, "i");

  if (gender) query.gender = gender;
  if (role) query.role = role;
  if (accountType) query.accountType = accountType;

  const blockRelations = await Block.find({
    $or: [{ blocker: currentUserId }, { blocked: currentUserId }],
  }).lean();

  const blockedUserIds = blockRelations.map((rel) =>
    rel.blocker.toString() === currentUserId
      ? rel.blocked.toString()
      : rel.blocker.toString(),
  );

  query._id = { $nin: [...blockedUserIds, currentUserId] };

  const maxLimit = accountType ? 10000 : 100;
  const parsedLimit = Math.min(Math.max(parseInt(limit) || 20, 1), maxLimit);

  const parsedPage = Math.max(parseInt(page) || 1, 1);
  const skip = (parsedPage - 1) * parsedLimit;

  // ✅ Aggregation $match auto-cast nahi karta ObjectId — manually convert karna padega
  const aggregateQuery = {
    ...query,
    _id: {
      $nin: [...blockedUserIds, currentUserId].map(
        (id) => new mongoose.Types.ObjectId(id),
      ),
    },
  };

  const [users, total, noCardCount] = await Promise.all([
    // ✅ find() ki jagah aggregate() — taki status-priority sort kar sake
    User.aggregate([
      { $match: aggregateQuery },
      {
        $addFields: {
          _statusOrder: {
            $switch: {
              branches: [
                {
                  case: {
                    $or: [
                      { $eq: ["$jainAadharStatus", "none"] },
                      { $eq: ["$jainAadharStatus", null] },
                      { $eq: ["$jainAadharStatus", ""] },
                      { $not: ["$jainAadharStatus"] },
                    ],
                  },
                  then: 0, // none → sabse pehle
                },
                { case: { $eq: ["$jainAadharStatus", "pending"] }, then: 1 },
                { case: { $eq: ["$jainAadharStatus", "verified"] }, then: 2 },
                { case: { $eq: ["$jainAadharStatus", "approved"] }, then: 2 },
                { case: { $eq: ["$jainAadharStatus", "rejected"] }, then: 3 },
              ],
              default: 99,
            },
          },
        },
      },
      { $sort: { _statusOrder: 1, createdAt: -1 } }, // pehle status, phir latest
      { $skip: skip },
      { $limit: parsedLimit },
      { $project: { password: 0, __v: 0, _statusOrder: 0 } }, // helper field hide
    ]),
    User.countDocuments(query),
    User.countDocuments({
      ...query,
      accountType: { $nin: ["business", "sadhu", "tirth"] },
      $or: [
        { jainAadharStatus: "none" },
        { jainAadharStatus: { $exists: false } },
        { jainAadharStatus: null },
        { jainAadharStatus: "" },
      ],
    }),
  ]);

  users.forEach((user) => {
    if (user.profilePicture) {
      user.profilePicture = convertS3UrlToCDN(user.profilePicture);
    }
  });

  return res.status(200).json({
    success: true,
    users,
    totalUsers: total,
    noCardCount,
    currentPage: parsedPage,
    totalPages: Math.ceil(total / parsedLimit),
    limit: parsedLimit,
    hasNextPage: parsedPage < Math.ceil(total / parsedLimit),
    hasPrevPage: parsedPage > 1,
  });
});

// Enhanced user profile retrieval

// Enhanced user profile retrieval
const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const currentUserId = req.user._id.toString();

  /* =================================================================
   * 🆕 SLIM MODE — sirf tab chalta hai jab ?slim=1 aaye.
   *
   * Param na ho to niche wala PURANA code jaisa ka waisa chalta hai,
   * isliye web / ActivityHistoryScreen / ActivityPostsScreen / koi bhi
   * purana caller nahi tootega.
   *
   * Slim me kya alag hai:
   *  - posts sirf `postsLimit` (default 12) aate hain, saare nahi
   *  - activity / likedPosts / token / OTP codes / fcmTokens / addresses
   *    skip — Profile screen inhe use hi nahi karti
   *  - friends populate nahi hota (sirf count chahiye tha)
   *  - .lean() — double toObject() ka kaam bach jata hai
   *  - block + currentUser + count queries Promise.all me parallel
   * ================================================================= */
  if (req.query.slim === "1" || req.query.slim === "true") {
    const postsLimit = Math.min(
      Math.max(parseInt(req.query.postsLimit, 10) || 12, 1),
      50,
    );

    const [slimUser, countsDoc, currentUserDoc] = await Promise.all([
      User.findById(id)
        .select(
          "-password -__v -activity -likedPosts -token -verificationCode " +
            "-resetPasswordCode -tempPhoneChange -tempEmailChange -fcmTokens " +
            "-addresses -blockedUsers -mutedStoryUsers -hiddenStoriesFrom " +
            "-loginAttempts -lockUntil",
        )
        .populate({
          path: "posts",
          select: "-__v",
          options: { sort: { createdAt: -1 }, limit: postsLimit },
        })
        .populate("story", "content createdAt")
        .lean(),
      // sirf ObjectId arrays — counts ke liye, bahut halki query hai
      User.findById(id).select("posts friends").lean(),
      User.findById(currentUserId).select("hiddenStoriesFrom").lean(),
    ]);

    if (!slimUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (slimUser.profilePicture) {
      slimUser.profilePicture = convertS3UrlToCDN(slimUser.profilePicture);
    }

    // .lean() ke saath Mongoose Map already plain object ban jata hai,
    // phir bhi purane data ke liye safety check rakha hai
    if (Array.isArray(slimUser.posts) && slimUser.posts.length > 0) {
      slimUser.posts = slimUser.posts.map((post) => {
        if (post.pollVotes instanceof Map) {
          post.pollVotes = Object.fromEntries(post.pollVotes);
        }
        return post;
      });
    }

    const totalPosts = Array.isArray(countsDoc?.posts)
      ? countsDoc.posts.length
      : 0;

    slimUser.friendCount = Array.isArray(countsDoc?.friends)
      ? countsDoc.friends.length
      : 0;
    slimUser.postCount = totalPosts;
    slimUser.hasMorePosts = totalPosts > (slimUser.posts?.length || 0);
    slimUser.postsReturned = slimUser.posts?.length || 0;
    slimUser.isStoryHidden = Boolean(
      currentUserDoc?.hiddenStoriesFrom?.some(
        (hiddenId) => hiddenId.toString() === id.toString(),
      ),
    );

    return res.json(slimUser);
  }
  /* ==================== 🆕 SLIM MODE END ==================== */

  // 🔐 First check block status
  const blockRelation = await Block.findOne({
    $or: [
      { blocker: currentUserId, blocked: id },
      { blocker: id, blocked: currentUserId },
    ],
  });

  // // ❌ If either blocked → hide whole profile
  // if (blockRelation) {
  //   return res.status(403).json({
  //     error: "This profile is not available."
  //   });
  // }

  // 🔍 Fetch user if not blocked
  const user = await User.findById(id)
    .select("-password -__v")
    .populate(
      "friends",
      "firstName lastName profilePicture accountType businessName accountTitle sadhuName tirthName",
    )
    .populate({
      path: "posts",
      select: "-__v",
      options: { sort: { createdAt: -1 } },
    })
    .populate("story", "content createdAt");

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (user.profilePicture) {
    user.profilePicture = convertS3UrlToCDN(user.profilePicture);
  }

  const userResponse = user.toObject({ flattenMaps: true });

  // Fix posts map flattening
  if (userResponse.posts?.length > 0) {
    userResponse.posts = userResponse.posts.map((post) => {
      const postObj = post.toObject
        ? post.toObject({ flattenMaps: true })
        : post;
      if (postObj.pollVotes instanceof Map) {
        postObj.pollVotes = Object.fromEntries(postObj.pollVotes);
      }
      return postObj;
    });
  }

  userResponse.friendCount = user.friends.length;
  userResponse.postCount = user.posts.length;
  const currentUser =
    await User.findById(currentUserId).select("hiddenStoriesFrom");

  const isStoryHidden = currentUser?.hiddenStoriesFrom?.some(
    (hiddenId) => hiddenId.toString() === id.toString(),
  );

  userResponse.isStoryHidden = isStoryHidden;
  res.json(userResponse);
});

// Get User Activity by type (including saved)
const getUserActivityByType = asyncHandler(async (req, res) => {
  const { id, type } = req.params;

  if (!["likes", "comments", "shares", "saved"].includes(type)) {
    return res.status(400).json({ error: "Invalid activity type" });
  }

  const user = await User.findById(id).populate({
    path: `activity.${type}.postId`,
    select: "caption media createdAt user likes comments postType type sanghId",
    populate: [
      {
        path: "user",
        select:
          "fullName profilePicture accountType sadhuName tirthName businessName",
      },
      {
        path: "sanghId",
        select: "name sanghImage",
      },
    ],
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const activities = user.activity[type] || [];
  let posts = activities
    .map((a) => {
      if (a.postId) {
        const post = a.postId.toObject ? a.postId.toObject() : a.postId;

        //Convert media URLs to CDN
        if (post.media && Array.isArray(post.media)) {
          post.media = post.media.map((m) => ({
            ...m,
            url: convertS3UrlToCDN(m.url),
          }));
        }

        return {
          _id: post._id,
          caption: post.caption || "",
          media: post.media || [],
          postType: post.postType || "post",

          type: post.type,
          sanghId: post.sanghId,

          createdAt: post.createdAt,
          user: post.user,

          likes: post.likes || [],
          likeCount: post.likes?.length || 0,
          comments: post.comments || [],
          commentCount: post.comments?.length || 0,

          activityCreatedAt: a.createdAt,
        };
      }
      return null;
    })
    .filter((p) => p !== null);

  // 🔹 Sort recent first
  posts = posts.sort(
    (a, b) => new Date(b.activityCreatedAt) - new Date(a.activityCreatedAt),
  );

  res.json({ posts });
});

// Get user by Jain Aadhar Number
const getUserByJainAadharNumber = asyncHandler(async (req, res) => {
  const { number } = req.params;

  if (!number || !String(number).trim()) {
    return res.status(400).json({
      success: false,
      message: "Jain Aadhar number is required",
    });
  }

  const aadharNumber = String(number).trim();

  // exact match, bas case ignore (JAIN41986503 / jain41986503 dono)
  const numberRegex = new RegExp(
    `^${aadharNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i",
  );

  // ── ✅ PRIMARY: seedha JainAadhar application se ──
  const jainAadhar = await JainAadharApplication.findOne({
    jainAadharNumber: numberRegex,
    status: { $in: ["approved", "verified"] },
  }).lean();

  if (jainAadhar) {
    const loc = jainAadhar.location || {};

    // age: DB me string ('41') hoti hai; na mile to dob se nikaal lo
    let age = null;
    const parsedAge = Number(jainAadhar.age);
    if (Number.isFinite(parsedAge) && parsedAge > 0) {
      age = parsedAge;
    } else if (jainAadhar.dob) {
      const dobDate = new Date(jainAadhar.dob);
      if (!isNaN(dobDate.getTime())) {
        const ageDate = new Date(Date.now() - dobDate.getTime());
        age = Math.abs(ageDate.getUTCFullYear() - 1970);
      }
    }

    const linkedUserId = jainAadhar.userId || jainAadhar.createdBy || null;

    // profileImage ke liye User se fallback (application me na ho to)
    let userDoc = null;
    if (!jainAadhar.userProfile && linkedUserId) {
      userDoc = await User.findById(linkedUserId)
        .select("profileImage location")
        .lean();
    }

    return res.json({
      success: true,
      data: {
        _id: linkedUserId || jainAadhar._id,
        name: jainAadhar.name || "Unknown",
        gender: jainAadhar.gender || "",
        dob: jainAadhar.dob || "",
        age,
        profileImage: jainAadhar.userProfile || userDoc?.profileImage || "",
        jainAadharNumber: jainAadhar.jainAadharNumber,

        // ✅ Location — ab JainAadhar se, User se nahi
        location: {
          country: loc.country || "",
          state: loc.state || "",
          district: loc.district || "",
          city: loc.city || "",
          address: loc.address || "",
          pinCode: loc.pinCode || "",
        },

        // ✅ additive — Razorpay prefill ke liye
        email: jainAadhar.contactDetails?.email || "",
        phoneNumber: jainAadhar.contactDetails?.number || "",
        bloodGroup: jainAadhar.bloodGroup || "",
      },
    });
  }

  // ── FALLBACK: purana User-based flow (jaisa tha waisa hi) ──
  const user = await User.findOne({
    jainAadharNumber: number,
    jainAadharStatus: "verified",
  }).populate("jainAadharApplication");

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found or not verified",
    });
  }

  const gender = user?.jainAadharApplication?.gender || "";
  const dob = user?.jainAadharApplication?.dob || "";

  let age = null;

  if (dob) {
    const dobDate = new Date(dob);
    const diffMs = Date.now() - dobDate.getTime();
    const ageDate = new Date(diffMs);
    age = Math.abs(ageDate.getUTCFullYear() - 1970);
  }

  res.json({
    success: true,
    data: {
      _id: user._id,
      name: user?.jainAadharApplication?.name || "Unknown",
      gender,
      dob,
      age,
      profileImage: user?.profileImage || "",
      jainAadharNumber: user.jainAadharNumber,

      // ✅ Location Added
      location: {
        country: user?.location?.country || "",
        state: user?.location?.state || "",
        district: user?.location?.district || "",
        city: user?.location?.city || "",
        address: user?.location?.address || "",
        pinCode: user?.location?.pinCode || "",
      },
    },
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ message: "Both current and new password are required" });
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  // ✅ Step 1: Check current password
  const isMatch = await user.isPasswordMatched(currentPassword);
  if (!isMatch) {
    return res.status(400).json({ message: "Current password is incorrect" });
  }

  // ✅ Step 3: Update and save new password
  user.password = newPassword; // Will be hashed via pre-save middleware
  await user.save();

  return res.status(200).json({ message: "Password updated successfully" });
});

const updateUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const files = req.files || {};

  // 🔐 Auth checks
  if (!req.user || !req.user._id) {
    return res.status(401).json({ error: "Unauthorized: No valid token" });
  }

  if (req.user._id.toString() !== id) {
    return res
      .status(403)
      .json({ error: "Forbidden: You can only update your own profile" });
  }

  // ✅ Get uploaded images
  const newProfilePicture = files.profilePicture?.[0]
    ? convertS3UrlToCDN(files.profilePicture[0].location)
    : null;

  const newCoverPicture = files.coverPicture?.[0]
    ? convertS3UrlToCDN(files.coverPicture[0].location)
    : null;

  // ❌ Never allow direct override
  delete updates.password;
  delete updates.token;
  delete updates.profilePicture;
  delete updates.coverPicture;

  const user = await User.findById(id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Helper to delete from S3
  const deleteFromS3 = async (fileUrl) => {
    try {
      let oldKey;

      if (fileUrl.includes("cloudfront.net")) {
        oldKey = fileUrl.split(".net/")[1];
      } else if (fileUrl.includes(".s3.")) {
        oldKey = fileUrl.split(".com/")[1];
      }

      if (oldKey) {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: oldKey,
          }),
        );
      }
    } catch (err) {
      console.error("❌ S3 delete failed:", err.message);
    }
  };

  const updateData = { ...updates };

  // ====================================================
  // ✅ LOCATION: country-wise field names (Aadhar form jaisa)
  // India -> state/district/city | USA -> state/county/city
  // Canada -> province/region/city | Japan -> prefecture/city
  // address aur postal yahan store nahi hote.
  // ====================================================
  if (updates.location && typeof updates.location === "object") {
    const processed = processUserLocation(updates.location);
    if (processed && Object.keys(processed).length > 0) {
      updateData.location = processed;
    } else {
      delete updateData.location;
    }
  }

  // ====================================================
  // ✅ CASE 1: New Profile Picture Uploaded
  // ====================================================
  if (newProfilePicture) {
    if (user.profilePicture) {
      await deleteFromS3(user.profilePicture);
    }
    updateData.profilePicture = newProfilePicture;
  }

  // ====================================================
  // ✅ CASE 2: Profile Picture Removed
  // Frontend must send: removeProfilePicture = "true"
  // ====================================================
  if (updates.removeProfilePicture === "true") {
    if (user.profilePicture) {
      await deleteFromS3(user.profilePicture);
    }
    updateData.profilePicture = null;
  }

  // ====================================================
  // Cover Picture Same Logic
  // ====================================================
  if (newCoverPicture) {
    if (user.coverPicture) {
      await deleteFromS3(user.coverPicture);
    }
    updateData.coverPicture = newCoverPicture;
  }

  if (updates.removeCoverPicture === "true") {
    if (user.coverPicture) {
      await deleteFromS3(user.coverPicture);
    }
    updateData.coverPicture = null;
  }

  const updatedUser = await User.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true },
  ).select("-password -__v");

  res.json({
    success: true,
    message: "Profile updated successfully",
    data: updatedUser,
  });
});
// Enhanced privacy settings
const updatePrivacy = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { privacy } = req.body;

  const user = await User.findByIdAndUpdate(
    id,
    { privacy },
    { new: true },
  ).select("-password -__v");

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({
    message: "Privacy settings updated successfully",
    user,
  });
});

// Upload profile picture with registration step tracking
const uploadProfilePicture = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id || req.body.userId;
    let imageUrl = null;

    if (req.file) {
      imageUrl = convertS3UrlToCDN(req.file.location); // S3 URL of the uploaded file
    }

    const updateData = {
      registrationStep: "completed",
      ...(imageUrl && { profilePicture: imageUrl }),
    };

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    }).select("-password -__v");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: imageUrl
        ? "Profile picture uploaded successfully"
        : "Profile picture upload skipped",
      data: {
        user,
        registrationComplete: true,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error processing profile picture",
      error: error.message,
    });
  }
});

// Skip profile picture upload
const skipProfilePicture = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findByIdAndUpdate(
      userId,
      { registrationStep: "completed" },
      { new: true },
    ).select("-password -__v");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Profile picture upload skipped",
      data: {
        user,
        registrationComplete: true,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error skipping profile picture",
      error: error.message,
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

    return successResponse(res, {}, "Logged out successfully", 200);
  } catch (error) {
    return errorResponse(res, "Logout failed", 500, error.message);
  }
});

// Search users by name, email, or phone - for suggestion/complaint recipient selection
const searchUsers = asyncHandler(async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 3) {
      return errorResponse(
        res,
        "Search query must be at least 3 characters",
        400,
      );
    }

    const users = await User.find({
      $or: [
        { firstName: { $regex: query, $options: "i" } },
        { lastName: { $regex: query, $options: "i" } },
        { fullName: { $regex: query, $options: "i" } },
        { phoneNumber: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ],
    })
      .select("_id firstName lastName phoneNumber email roles profilePicture")
      .limit(10);

    // Format user data for frontend
    const formattedUsers = users.map((user) => ({
      _id: user._id,
      name: `${user.firstName} ${user.lastName}`,
      phone: user.phoneNumber,
      email: user.email || "",
      roles: user.role || [],
      profilePicture: user.profilePicture || "",
    }));

    return successResponse(res, formattedUsers, "Users retrieved successfully");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});
const getCitiesByState = asyncHandler(async (req, res) => {
  const { state } = req.query;

  if (!state) {
    return res.status(400).json({ message: "State name is required" });
  }

  const cities = stateCityData[state];

  if (!cities) {
    return res.status(404).json({ message: "No cities found for this state" });
  }

  res.status(200).json({ state, cities });
});

const getCitiesByMultipleStates = asyncHandler(async (req, res) => {
  const { states } = req.query;

  // ✅ Expect: states=Madhya Pradesh,Gujarat
  if (!states) {
    return res.status(400).json({
      success: false,
      message: "States are required",
    });
  }

  const stateArray = states.split(",").map((s) => s.trim());

  const result = {};
  let allCities = [];

  stateArray.forEach((stateName) => {
    if (stateCityData[stateName]) {
      result[stateName] = stateCityData[stateName];
      allCities = allCities.concat(stateCityData[stateName]);
    }
  });

  if (Object.keys(result).length === 0) {
    return res.status(404).json({
      success: false,
      message: "No cities found for provided states",
    });
  }

  return res.status(200).json({
    success: true,
    states: result, // ✅ state-wise
    cities: allCities, // ✅ combined list
  });
});

/* ==================================================================
 * 🆕 SCREEN TIME ("Time spent" - Instagram style)
 * Purane kisi bhi function ko touch nahi kiya gaya.
 * ================================================================== */

const ST_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ST_MAX_PER_CALL = 6 * 60 * 60; // 6 ghante ka safety cap
const ST_MAX_PER_DAY = 24 * 60 * 60; // 24 ghante se zyada possible hi nahi

// 'YYYY-MM-DD' se n din aage/piche
const stShiftDate = (dateStr, days) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
};

const stDayName = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return ST_DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

const stTodayStr = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
};

/**
 * POST /api/user/screentime/track
 * body: { seconds, date: 'YYYY-MM-DD' (client ki LOCAL date), platform }
 * App har 60 sec par / background jaate hi ye hit karta hai.
 */
const trackScreenTime = asyncHandler(async (req, res) => {
  const userId = req.user?._id || req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  let { seconds, date, platform } = req.body || {};
  seconds = Math.floor(Number(seconds) || 0);

  if (seconds <= 0) {
    return res.status(400).json({ success: false, error: "Invalid seconds" });
  }
  if (seconds > ST_MAX_PER_CALL) seconds = ST_MAX_PER_CALL;
  if (!date || !ST_DATE_RE.test(String(date))) date = stTodayStr();

  try {
    const doc = await ScreenTime.findOneAndUpdate(
      { userId, date },
      {
        $inc: { seconds },
        $set: { lastActiveAt: new Date(), platform: platform || "unknown" },
        $setOnInsert: { userId, date },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).exec();

    if (doc && doc.seconds > ST_MAX_PER_DAY) {
      doc.seconds = ST_MAX_PER_DAY;
      await doc.save();
    }

    return res.status(200).json({
      success: true,
      date,
      seconds: doc ? doc.seconds : seconds,
    });
  } catch (err) {
    // do requests ek saath aayin to duplicate-key aa sakta hai -> ek retry
    if (err && err.code === 11000) {
      await ScreenTime.updateOne(
        { userId, date },
        { $inc: { seconds } },
      ).exec();
      return res.status(200).json({ success: true, date, retried: true });
    }
    throw err;
  }
});

/**
 * GET /api/user/:id/screentime/weekly?endDate=YYYY-MM-DD
 * Response: { success, days: [{date, day, seconds, minutes}], summary: {...} }
 */
const getWeeklyScreenTime = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, error: "Invalid user id" });
  }

  const endDate = ST_DATE_RE.test(String(req.query.endDate || ""))
    ? req.query.endDate
    : stTodayStr();

  const startDate = stShiftDate(endDate, -6); // aaj samet 7 din
  const prevStart = stShiftDate(endDate, -13);
  const prevEnd = stShiftDate(endDate, -7);

  const rows = await ScreenTime.find({
    userId: id,
    date: { $gte: prevStart, $lte: endDate },
  })
    .select("date seconds")
    .lean()
    .exec();

  const map = {};
  rows.forEach((r) => {
    map[r.date] = (map[r.date] || 0) + (Number(r.seconds) || 0);
  });

  const days = [];
  let weekTotalSeconds = 0;
  for (let i = 6; i >= 0; i--) {
    const d = stShiftDate(endDate, -i);
    const secs = map[d] || 0;
    weekTotalSeconds += secs;
    days.push({
      date: d,
      day: stDayName(d),
      seconds: secs,
      minutes: Math.round(secs / 60),
    });
  }

  let lastWeekTotal = 0;
  let cursor = prevStart;
  while (cursor <= prevEnd) {
    lastWeekTotal += map[cursor] || 0;
    cursor = stShiftDate(cursor, 1);
  }

  return res.status(200).json({
    success: true,
    startDate,
    endDate,
    days,
    summary: {
      todaySeconds: map[endDate] || 0,
      yesterdaySeconds: map[stShiftDate(endDate, -1)] || 0,
      weekTotalSeconds,
      dailyAverageSeconds: Math.round(weekTotalSeconds / 7),
      lastWeekTotalSeconds: lastWeekTotal,
      lastWeekAverageSeconds: Math.round(lastWeekTotal / 7),
    },
  });
});

/**
 * GET /api/user/:id/screentime/summary?days=30&endDate=YYYY-MM-DD
 * Lambi range ka total / average / sabse zyada use wala din.
 */
const getScreenTimeSummary = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, error: "Invalid user id" });
  }

  const endDate = ST_DATE_RE.test(String(req.query.endDate || ""))
    ? req.query.endDate
    : stTodayStr();

  let range = parseInt(req.query.days, 10);
  if (!range || range < 1 || range > 365) range = 30;
  const startDate = stShiftDate(endDate, -(range - 1));

  const rows = await ScreenTime.find({
    userId: id,
    date: { $gte: startDate, $lte: endDate },
  })
    .select("date seconds")
    .sort({ date: 1 })
    .lean()
    .exec();

  let total = 0;
  let longest = { date: null, seconds: 0 };
  rows.forEach((r) => {
    const s = Number(r.seconds) || 0;
    total += s;
    if (s > longest.seconds) longest = { date: r.date, seconds: s };
  });

  return res.status(200).json({
    success: true,
    startDate,
    endDate,
    rangeDays: range,
    totalSeconds: total,
    dailyAverageSeconds: Math.round(total / range),
    activeDays: rows.length,
    longestDay: longest,
  });
});

module.exports = {
  registerUser,
  loginUser,
  verifyOtp,
  getCitiesByState,
  getAllUsers,
  getUserById,
  getUserByJainAadharNumber,
  updateUserById,
  changePassword,
  updatePrivacy,
  uploadProfilePicture,
  skipProfilePicture,
  logoutUser,
  searchUsers,
  verifyEmail,
  verifyEmails,
  resendVerificationCode,
  requestPasswordReset,
  requestPasswordResetMobile,
  resetPassword,
  verifyResetPassword,
  sendVerificationCode,
  sendChangeEmailOtp,
  sendChangePhoneOtp,
  verifyChangePhone,
  verifyChangeEmail,
  verifyRegisterOtp,
  verifyOtpMobileEmail,
  sendOtp,
  registerFinalUser,
  resendOtp,
  getUserActivityByType,
  getCitiesByMultipleStates,
  trackScreenTime,
  getWeeklyScreenTime,
  getScreenTimeSummary,
};
