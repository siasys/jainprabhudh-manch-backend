const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../middlewares/authMiddlewares");
const {
  toggleWishlistItem,
  getMyWishlist,
  removeWishlistItem,
  clearWishlist,
  getWishlistCount,
  moveWishlistItemToCart,
} = require("../../controller/VyaparControllers/Wishlistcontroller");

// ─── Protected — auth required for all wishlist routes ───
router.use(authMiddleware);

// ⚠️ ORDER MATTERS — specific routes BEFORE dynamic :productId

// GET /api/wishlist/count  → count for header badge
router.get("/count", getWishlistCount);

// DELETE /api/wishlist/clear → empty wishlist
router.delete("/clear", clearWishlist);

// POST /api/wishlist/toggle/:productId → add or remove
router.post("/toggle/:productId", toggleWishlistItem);

// POST /api/wishlist/move-to-cart/:productId
router.post("/move-to-cart/:productId", moveWishlistItemToCart);

// DELETE /api/wishlist/item/:productId → remove single
router.delete("/item/:productId", removeWishlistItem);

// GET /api/wishlist        → my full wishlist
router.get("/", getMyWishlist);

module.exports = router;
