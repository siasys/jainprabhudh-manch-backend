const Razorpay = require('razorpay');
const crypto = require('crypto');
const FoundationPayment = require('../../model/Foundation/foundationPaymentModel');
const { successResponse, errorResponse } = require('../../utils/apiResponse');

// Initialize Razorpay with API keys
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

/**
 * Create a Razorpay Payment Order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createPayment = async (req, res) => {
    try {
        const { amountCollected, userId, note } = req.body;

        // Validate required fields
        if (!amountCollected || !userId || !note) {
            return errorResponse(res, 'Missing required fields', 400);
        }

        // Create receipt ID for the payment
        const timestamp = Date.now().toString();
        const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const receipt = `foundation_${timestamp}_${randomNum}`;

        // Create Razorpay order
        const order = await razorpay.orders.create({
            amount: amountCollected,  // Amount in paise (INR)
            currency: 'INR',  // Currency type
            receipt: receipt,  // Unique receipt ID
            notes: {
                userId: userId.toString(),  // User ID making the payment
                note: note,  // Payment note for the payment
            },
        });

        console.log("🔹 Razorpay Order Created:", order);

        // Save payment record to the database
        const payment = new FoundationPayment({
            userId,  // Reference to the user making the payment
            amountCollected,  // Payment amount
            transactionId: order.id,  // Store Razorpay order ID
            status: 'pending',  // Initial status of the payment
            note,  // User's note about the payment
            receipt,  // Receipt ID
        });

        // Save the payment document to the database
        await payment.save();
        console.log("✅ Payment Saved in DB:", payment);

        // Return the order details to the client
        return successResponse(res, {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            receipt,
            key: process.env.RAZORPAY_KEY_ID,  // Razorpay key
        });

    } catch (error) {
        console.error('Error creating Razorpay payment:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Verify Razorpay Payment Signature
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        console.log('Received Razorpay Data:', req.body);

        // Verify payment signature using HMAC SHA256
        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        console.log('Generated Signature:', generatedSignature);
        console.log('Received Signature:', razorpay_signature);

        // Check if generated signature matches the one sent by Razorpay
        const isValidSignature = generatedSignature === razorpay_signature;

        if (!isValidSignature) {
            return errorResponse(res, 'Invalid payment signature', 400);
        }

        // Get the payment details from the database using the Razorpay order ID
        const payment = await FoundationPayment.findOne({ transactionId: razorpay_order_id });
        console.log('Payment Record:', payment);

        if (!payment) {
            return errorResponse(res, 'Payment record not found', 404);
        }

        // Check if payment has already been marked as paid
        if (payment.status === 'paid') {
            return successResponse(res, {
                message: 'Payment already verified',
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
            });
        }

        // Update the payment status to 'paid' in the database
        payment.status = 'paid';
        await payment.save();

        // Return success response with payment details
        return successResponse(res, {
            message: 'Payment verified successfully',
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id,
        });

    } catch (error) {
        console.error('Error verifying Razorpay payment:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    createPayment,
    verifyPayment,
};
