const express = require("express");
const { createMatrimonialOrder, verifyMatrimonialPayment } = require("../../controller/Matrimonial/Matrimonialpaymentcontroller");
const router = express.Router();

// POST /matrimonial-payment/create-order
router.post("/create-order", createMatrimonialOrder);

// POST /matrimonial-payment/verify-payment
router.post("/verify-payment", verifyMatrimonialPayment);

module.exports = router;
