const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../../middlewares/authMiddlewares");
const {
  getPujaTypesForUser,
  createPujaBooking,
  getMyPujaBookings,
  cancelPujaBooking,
} = require("../../controller/TirthControllers/tirthPujaController");

/* pujaon ki list dekhne ke liye login zaroori nahi */
router.get("/types/:tirthId", getPujaTypesForUser);

/* booking ke liye login chahiye */
router.get("/my", authMiddleware, getMyPujaBookings);
router.post("/book/:tirthId", authMiddleware, createPujaBooking);
router.put("/cancel/:bookingId", authMiddleware, cancelPujaBooking);

module.exports = router;
