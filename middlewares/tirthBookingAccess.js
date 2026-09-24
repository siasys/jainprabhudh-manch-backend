const { errorResponse } = require("../utils/apiResponse");

/**
 * NAYA middleware — purane tirthAuthMiddleware.js ko touch nahi kiya gaya.
 * Sirf booking/room/accounting routes ke liye use hota hai.
 */

// Kya ye user is tirth ka manager hai?
const isUserTirthManager = (user, tirthId) => {
  if (!user || !tirthId) return false;

  // super admin / admin ko full access
  const role = (user.role || "").toLowerCase();
  if (role === "superadmin" || role === "admin") return true;

  if (!Array.isArray(user.tirthRoles)) return false;

  return user.tirthRoles.some(
    (r) => r && r.tirthId && r.tirthId.toString() === tirthId.toString(),
  );
};

// Route middleware — :tirthId param (ya body.tirthId) par check karta hai
const verifyTirthManager = (req, res, next) => {
  try {
    const tirthId = req.params.tirthId || req.body.tirthId;

    if (!tirthId) {
      return errorResponse(res, "Tirth ID is required", 400);
    }

    if (!isUserTirthManager(req.user, tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    req.tirthId = tirthId;
    return next();
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  isUserTirthManager,
  verifyTirthManager,
};
