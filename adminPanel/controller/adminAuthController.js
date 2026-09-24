const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const AdminUser = require("../model/adminUserModel");
const { PERMISSIONS, PRESETS } = require("../config/permissions");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");
const crypto = require("crypto");
const AdminOtp = require("../model/adminOtpModel");
const { sendPasswordResetEmail } = require("../../services/nodemailerEmailService");

const signToken = (id) =>
  jwt.sign({ id }, process.env.ADMIN_JWT_SECRET, {
    expiresIn: process.env.ADMIN_JWT_EXPIRY || "7d",
  });

/* ───────────── POST /api/admin-panel/auth/login ───────────── */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return errorResponse(res, "Email and password are both required", 400);
  }

  const admin = await AdminUser.findOne({
    email: String(email).toLowerCase().trim(),
  }).select("+password");

  // Same message either way, so nobody can probe which emails exist
  if (!admin || !(await admin.matchPassword(password))) {
    return errorResponse(res, "Incorrect email or password", 401);
  }

  if (!admin.isActive) {
    return errorResponse(res, "Your account has been deactivated", 403);
  }

  admin.lastLoginAt = new Date();
  admin.lastLoginIp = req.ip || "";
  await admin.save({ validateBeforeSave: false });

  req.admin = admin;
  await logAction(req, {
    action: "auth.login",
    targetType: "AdminUser",
    targetId: admin._id,
    description: `${admin.name} signed in`,
  });

  return successResponse(
    res,
    { token: signToken(admin._id), admin: admin.toSafeJSON() },
    "Signed in successfully",
  );
});

/* ───────────── GET /api/admin-panel/auth/me ───────────── */
const getMe = asyncHandler(async (req, res) => {
  return successResponse(res, { admin: req.admin.toSafeJSON() }, "OK");
});

/* ───────────── PUT /api/admin-panel/auth/change-password ───────────── */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return errorResponse(res, "Both current and new password are required", 400);
  }
  if (String(newPassword).length < 6) {
    return errorResponse(res, "New password must be at least 6 characters", 400);
  }

  const admin = await AdminUser.findById(req.admin._id).select("+password");
  if (!(await admin.matchPassword(currentPassword))) {
    return errorResponse(res, "Current password is incorrect", 401);
  }

  admin.password = newPassword; // the pre-save hook hashes it
  await admin.save();

  await logAction(req, {
    action: "auth.password_change",
    targetType: "AdminUser",
    targetId: admin._id,
    description: `${admin.name} changed their own password`,
  });

  return successResponse(res, null, "Password changed successfully");
});

/* ───────────── GET /api/admin-panel/permissions ─────────────
   Powers the "Assign Permissions" screen on the frontend */
const getPermissionList = asyncHandler(async (req, res) => {
  return successResponse(res, { modules: PERMISSIONS, presets: PRESETS }, "OK");
});


/* ═══════════════════════════════════════════════════════════
   FORGOT PASSWORD
   ═══════════════════════════════════════════════════════════ */

const OTP_VALID_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

const hashCode = (code) =>
  crypto.createHash("sha256").update(String(code)).digest("hex");

/* ───────────── POST /api/admin-panel/auth/forgot-password ─────────────
   Body: { email } */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return errorResponse(res, "Email is required", 400);

  const cleanEmail = String(email).toLowerCase().trim();

  // Always answer the same way, whether or not the account exists.
  // Otherwise this endpoint becomes a way to discover admin emails.
  const genericReply = () =>
    successResponse(
      res,
      null,
      "If that email belongs to an admin account, a reset code has been sent to it",
    );

  const admin = await AdminUser.findOne({ email: cleanEmail });
  if (!admin || !admin.isActive) return genericReply();

  // Don't let someone spam the inbox
  const recent = await AdminOtp.findOne({ email: cleanEmail })
    .sort({ createdAt: -1 })
    .lean();

  if (recent) {
    const secondsAgo = (Date.now() - new Date(recent.createdAt)) / 1000;
    if (secondsAgo < RESEND_COOLDOWN_SECONDS) {
      return errorResponse(
        res,
        `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsAgo)} seconds before requesting another code`,
        429,
      );
    }
  }

  // Any older codes for this account are now void
  await AdminOtp.deleteMany({ email: cleanEmail });

  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits

  await AdminOtp.create({
    admin: admin._id,
    email: cleanEmail,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + OTP_VALID_MINUTES * 60 * 1000),
    requestIp: req.ip || "",
  });

  try {
    await sendPasswordResetEmail(cleanEmail, admin.name, code);
  } catch (err) {
    console.error("[adminPanel] reset email failed:", err.message);
    await AdminOtp.deleteMany({ email: cleanEmail });
    return errorResponse(
      res,
      "Could not send the email right now. Please try again in a moment.",
      500,
    );
  }

  return genericReply();
});

/* ───────────── POST /api/admin-panel/auth/verify-reset-code ─────────────
   Body: { email, code }
   Only checks the code — the password change happens in the next call. */
const verifyResetCode = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return errorResponse(res, "Email and code are required", 400);

  const cleanEmail = String(email).toLowerCase().trim();

  const otp = await AdminOtp.findOne({ email: cleanEmail, usedAt: null }).sort({
    createdAt: -1,
  });

  if (!otp) return errorResponse(res, "No active reset code. Please request a new one.", 404);
  if (new Date() > otp.expiresAt)
    return errorResponse(res, "This code has expired. Please request a new one.", 400);
  if (otp.attempts >= MAX_ATTEMPTS) {
    await otp.deleteOne();
    return errorResponse(res, "Too many wrong attempts. Please request a new code.", 429);
  }

  if (otp.codeHash !== hashCode(String(code).trim())) {
    otp.attempts += 1;
    await otp.save();
    const left = MAX_ATTEMPTS - otp.attempts;
    return errorResponse(
      res,
      left > 0 ? `Incorrect code. ${left} attempt${left > 1 ? "s" : ""} left.` : "Incorrect code.",
      400,
    );
  }

  return successResponse(res, { verified: true }, "Code verified");
});

/* ───────────── POST /api/admin-panel/auth/reset-password ─────────────
   Body: { email, code, newPassword } */
const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword)
    return errorResponse(res, "Email, code and new password are all required", 400);
  if (String(newPassword).length < 6)
    return errorResponse(res, "Password must be at least 6 characters", 400);

  const cleanEmail = String(email).toLowerCase().trim();

  const otp = await AdminOtp.findOne({ email: cleanEmail, usedAt: null }).sort({
    createdAt: -1,
  });

  if (!otp) return errorResponse(res, "No active reset code. Please request a new one.", 404);
  if (new Date() > otp.expiresAt)
    return errorResponse(res, "This code has expired. Please request a new one.", 400);
  if (otp.attempts >= MAX_ATTEMPTS) {
    await otp.deleteOne();
    return errorResponse(res, "Too many wrong attempts. Please request a new code.", 429);
  }
  if (otp.codeHash !== hashCode(String(code).trim())) {
    otp.attempts += 1;
    await otp.save();
    return errorResponse(res, "Incorrect code", 400);
  }

  const admin = await AdminUser.findById(otp.admin).select("+password");
  if (!admin) return errorResponse(res, "Admin account not found", 404);
  if (!admin.isActive)
    return errorResponse(res, "This account has been deactivated", 403);

  admin.password = newPassword; // the pre-save hook hashes it
  await admin.save();

  // Burn the code, and clear any others for this account
  otp.usedAt = new Date();
  await otp.save();
  await AdminOtp.deleteMany({ email: cleanEmail, usedAt: null });

  // Log it without a req.admin — this happens before sign-in
  try {
    const AuditLog = require("../model/auditLogModel");
    await AuditLog.create({
      admin: admin._id,
      adminName: admin.name,
      adminRole: admin.role,
      action: "auth.password_reset_self",
      targetType: "AdminUser",
      targetId: admin._id,
      description: `${admin.name} reset their own password using an email code`,
      ip: req.ip || "",
    });
  } catch (e) {
    console.error("[adminPanel] audit log failed:", e.message);
  }

  return successResponse(res, null, "Password reset. You can sign in now.");
});

module.exports = { login, getMe, changePassword, getPermissionList,  forgotPassword,
  verifyResetCode,
  resetPassword, };