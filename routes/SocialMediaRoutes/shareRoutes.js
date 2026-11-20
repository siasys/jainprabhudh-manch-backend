// ✅ NEW (Share module) routes — public (bina login ke bhi chalenge)
const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  getPublicPost,
  getShareMeta,
} = require("../../controller/SocialMediaControllers/shareController");
const { optionalAuth } = require("../../middlewares/optionalAuth");

const router = express.Router();

// Public page API — scraping se bachne ke liye per-IP limit
const publicPostLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

// Meta API Netlify Edge Function se aati hai (kai users ek hi edge IP share karte hain),
// isliye limit zyada rakhi hai
const metaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

router.get("/post/:postId", publicPostLimiter, optionalAuth, getPublicPost);
router.get("/meta/:postId", metaLimiter, getShareMeta);

module.exports = router;
