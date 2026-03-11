const express = require("express");
const { verifyDonationPayment, createDonationOrder } = require("../../controller/Donation/Donationpaymentcontroller");
const router = express.Router();

// POST /donation-payment/create-order
router.post("/create-order", createDonationOrder);

// POST /donation-payment/verify-payment
router.post("/verify-payment", verifyDonationPayment);

module.exports = router;
