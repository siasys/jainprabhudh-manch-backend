const express = require('express');
const { createPayment, verifyPayment } = require('../../controller/Foundation/foundationController');
const router = express.Router();

// Route for creating a payment (Razorpay order)
router.post('/create-payment', createPayment);

// Route for verifying the payment (Razorpay signature verification)
router.post('/verify-payment', verifyPayment);

module.exports = router;
