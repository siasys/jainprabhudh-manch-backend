const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../middlewares/authMiddlewares");
const {
  createOrder,
  createPaymentOrder,
  verifyPayment,
  getMyOrders,
  getSellerOrders,
  getSellerSummary,
  getMyPurchaseSummary,
  getOrderById,
  updateOrderStatus,
  setShipment,
  cancelOrder,
} = require("../../controller/VyaparControllers/Ordercontroller");

// ─── Protected — auth required for all order routes ───
router.use(authMiddleware);

// ⚠️ ORDER MATTERS — specific routes BEFORE dynamic :id,
//    otherwise "my" and "seller" get read as order ids.

// GET /api/order/my                  → customer's own orders
router.get("/my", getMyOrders);

// ⚠️ Before "/my" would be wrong, but after it is fine — Express matches
//    in order and "/my/summary" is more specific than "/my".
// GET /api/order/my/summary          → what this account has bought
router.get("/my/summary", getMyPurchaseSummary);

// GET /api/order/seller/:vyaparId    → seller's order board
// ⚠️ Registered before "/seller/:vyaparId" so "summary" is not read as
//    a business id.
// GET /api/order/seller/:vyaparId/summary → the seller dashboard
router.get("/seller/:vyaparId/summary", getSellerSummary);

router.get("/seller/:vyaparId", getSellerOrders);

// POST /api/order/create             → place order (splits by seller)
router.post("/create", createOrder);

// POST /api/order/create-payment     → Razorpay order for a group
router.post("/create-payment", createPaymentOrder);

// POST /api/order/verify-payment     → verify signature, mark paid
router.post("/verify-payment", verifyPayment);

// GET /api/order/:id                 → single order (buyer or seller)
router.get("/:id", getOrderById);

// PATCH /api/order/:id/status        → seller advances the status
router.patch("/:id/status", updateOrderStatus);

// PATCH /api/order/:id/shipment      → Jaintva pickup or self ship
router.patch("/:id/shipment", setShipment);

// PATCH /api/order/:id/cancel        → customer cancels
router.patch("/:id/cancel", cancelOrder);

module.exports = router;
