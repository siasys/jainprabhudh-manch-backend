const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../middlewares/authMiddlewares");
const {
  addToCart,
  getMyCart,
  updateCartItemQty,
  removeCartItem,
  clearCart,
  getCartCount,
  moveCartItemToWishlist,
} = require("../../controller/VyaparControllers/Cartcontroller");

// ─── Protected — auth required for all cart routes ───
router.use(authMiddleware);

// ⚠️ ORDER MATTERS — specific routes BEFORE dynamic :productId

// GET /api/cart/count      → count for header badge
router.get("/count", getCartCount);

// DELETE /api/cart/clear   → empty cart
router.delete("/clear", clearCart);

// POST /api/cart/move-to-wishlist/:productId
router.post("/move-to-wishlist/:productId", moveCartItemToWishlist);

// POST /api/cart/add       → add product to cart (or increment qty)
router.post("/add", addToCart);

// PATCH /api/cart/item/:productId  → update qty
router.patch("/item/:productId", updateCartItemQty);

// DELETE /api/cart/item/:productId → remove one item
router.delete("/item/:productId", removeCartItem);

// GET /api/cart            → my full cart
router.get("/", getMyCart);

module.exports = router;
