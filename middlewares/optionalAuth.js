// ✅ NEW (Share module): Optional auth
// Token ho to viewer set karo, na ho / invalid / expired ho to bhi request aage jaane do (guest).
// Existing authMiddleware ko touch nahi kiya — ye alag file hai.
const jwt = require("jsonwebtoken");
const User = require("../model/UserRegistrationModels/userModel");

const optionalAuth = async (req, res, next) => {
  req.viewer = null;

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (token && token !== "null" && token !== "undefined") {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // authMiddleware jaisa hi fallback (Sangh mode me originalUserId)
      const userId = decoded.originalUserId || decoded._id;

      if (userId) {
        const user = await User.findById(userId)
          .select("_id accountStatus activity.saved")
          .lean();

        if (user && user.accountStatus !== "deactivated") {
          req.viewer = user;
          req.jwtPayload = decoded;
        }
      }
    }
  } catch (e) {
    // Invalid / expired token → guest maan lo, error mat do
    req.viewer = null;
  }

  next();
};

module.exports = { optionalAuth };
