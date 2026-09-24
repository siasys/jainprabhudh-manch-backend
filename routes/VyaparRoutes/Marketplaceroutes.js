// routes/MarketplaceRoutes/marketplaceRoutes.js
// ─────────────────────────────────────────────────────────────
// Cart, wishlist and order routes. Product routes live in a
// separate file because they mount under `vyapar/products`.
// ─────────────────────────────────────────────────────────────
const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../../middlewares/authMiddlewares");

const {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  getWishlist,
  toggleWishlist,
} = require("../../controller/VyaparControllers/Cartcontroller");

const {
  createOrder,
  createPaymentOrder,
  verifyPayment,
  getMyOrders,
  getSellerOrders,
  getOrderById,
  updateOrderStatus,
  setShipment,
  cancelOrder,
} = require("../../controller/VyaparControllers/Ordercontroller");

// Everything here needs a logged-in user
router.use(authMiddleware);

// ── CART ──────────────────────────────────────────────────────
router.get("/cart", getCart);
router.post("/cart/add", addToCart);
router.delete("/cart/clear", clearCart);
router.patch("/cart/item/:productId", updateCartItem);
router.delete("/cart/item/:productId", removeCartItem);

// ── WISHLIST ──────────────────────────────────────────────────
router.get("/wishlist", getWishlist);
router.post("/wishlist/toggle/:productId", toggleWishlist);

// ── ORDERS ────────────────────────────────────────────────────
// Specific paths must come BEFORE `/:id`, otherwise "my" and
// "seller" get read as order ids.
router.get("/order/my", getMyOrders);
router.get("/order/seller/:vyaparId", getSellerOrders);

router.post("/order/create", createOrder);
router.post("/order/create-payment", createPaymentOrder);
router.post("/order/verify-payment", verifyPayment);

router.get("/order/:id", getOrderById);
router.patch("/order/:id/status", updateOrderStatus);
router.patch("/order/:id/shipment", setShipment);
router.patch("/order/:id/cancel", cancelOrder);

module.exports = router;
