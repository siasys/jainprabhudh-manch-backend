const express = require('express');
const { createOrder, verifyPayment } = require('../../controller/SanghControllers/paymentController');

const router = express.Router();

router.post('/create-order', createOrder);
router.post('/verify-payment', verifyPayment);

module.exports = router;
