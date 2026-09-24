const jwt = require("jsonwebtoken");
const AdminUser = require("../model/adminUserModel");
const { ROLES, ALL_PERMISSION_KEYS } = require("../config/permissions");
const { errorResponse } = require("../../utils/apiResponse");

/**
 * Verifies the token and sets req.admin.
 *
 * NOTE: ADMIN_JWT_SECRET is deliberately different from the user-side
 * JWT_SECRET, so a user token cannot be used on admin APIs (or vice versa).
 */
const protectAdmin = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return errorResponse(res, "No authentication token provided", 401);
    }

    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);

    const admin = await AdminUser.findById(decoded.id);
    if (!admin) return errorResponse(res, "Admin account not found", 401);
    if (!admin.isActive)
      return errorResponse(res, "Your account has been deactivated", 403);

    req.admin = admin;

    /* ── Compatibility bridge ──────────────────────────────────
       Some existing controllers (e.g. Jain Aadhar verification)
       check req.user.role === 'superadmin'. We set a compatible
       shape here so those routes work from the admin panel
       without modifying them.
    ---------------------------------------------------------- */
    req.user = {
      _id: admin._id,
      role: "superadmin",
      adminPermissions: ALL_PERMISSION_KEYS,
      fullName: admin.name,
      email: admin.email,
    };
    req.userId = admin._id;

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return errorResponse(res, "Your session has expired. Please sign in again.", 401);
    }
    return errorResponse(res, "Invalid authentication token", 401);
  }
};

/**
 * Permission guard.
 * Usage: router.get("/posts", can("post.view"), ctrl.list)
 */
const can = (permission) => (req, res, next) => {
  if (!req.admin) return errorResponse(res, "Not authenticated", 401);
  if (!req.admin.can(permission)) {
    return errorResponse(res, "You don't have permission to do this", 403);
  }
  next();
};

/**
 * Role guard — for Trustee / CEO only actions.
 * Usage: roleOnly(ROLES.TRUSTEE, ROLES.CEO)
 */
const roleOnly = (...roles) => (req, res, next) => {
  if (!req.admin) return errorResponse(res, "Not authenticated", 401);
  if (!roles.includes(req.admin.role)) {
    return errorResponse(res, "Only senior admins can do this", 403);
  }
  next();
};

module.exports = { protectAdmin, can, roleOnly, ROLES };