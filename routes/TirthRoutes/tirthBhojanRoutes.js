const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../../middlewares/authMiddlewares");
const {
  getMenuForUser,
  createFoodOrder,
  getMyFoodOrders,
  cancelFoodOrder,
} = require("../../controller/TirthControllers/tirthBhojanController");

/* menu dekhne ke liye login zaroori nahi */
router.get("/menu/:tirthId", getMenuForUser);

/* order ke liye login chahiye */
router.get("/my", authMiddleware, getMyFoodOrders);
router.post("/order/:tirthId", authMiddleware, createFoodOrder);
router.put("/cancel/:orderId", authMiddleware, cancelFoodOrder);

module.exports = router;