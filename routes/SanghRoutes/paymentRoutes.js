const express = require('express');
const { createOrder, verifyPayment, createOfficeBearerOrder, verifyOfficeBearerPayment, verifyPaymentByOrderId } = require('../../controller/SanghControllers/paymentController');

const router = express.Router();

router.post('/create-order', createOrder);
router.post('/verify-payment', verifyPayment);
router.post('/verify-payment-by-order-id', verifyPaymentByOrderId);

// ✅ Office Bearer-based payment
router.post('/create-office-order', createOfficeBearerOrder);
router.post('/verify-office-payment', verifyOfficeBearerPayment);

module.exports = router;
