const asyncHandler = require("express-async-handler");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ✅ Fixed matrimonial fee
const MATRIMONIAL_FEE = 500; // ₹500 — apni zaroorat ke hisab se change karo

// ✅ Step 1: Create Razorpay Order for Matrimonial
const createMatrimonialOrder = asyncHandler(async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const amountInPaise = MATRIMONIAL_FEE * 100; // 500 rupees → 50000 paise
    const receipt = `matrimonial_${userId.toString().substring(0, 10)}_${Date.now()}`;

    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt,
    };

    const order = await razorpay.orders.create(options);

    console.log(
      "📦 Matrimonial Order Created:",
      order.id,
      "Amount:",
      amountInPaise,
    );

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount, // paise mein
      currency: order.currency,
      userId,
    });
  } catch (error) {
    console.error("Error in createMatrimonialOrder:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create matrimonial payment order",
      error: error.message,
    });
  }
});

// ✅ Step 2: Verify Razorpay Payment for Matrimonial
const verifyMatrimonialPayment = asyncHandler(async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message:
          "razorpay_order_id, razorpay_payment_id and razorpay_signature are required",
      });
    }

    // Signature verify karo
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    console.log("✅ Matrimonial Payment Verified:", razorpay_payment_id);

    res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      razorpay_payment_id,
      razorpay_order_id,
    });
  } catch (error) {
    console.error("Matrimonial Payment Verification Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error during matrimonial payment verification",
      error: error.message,
    });
  }
});

module.exports = {
  createMatrimonialOrder,
  verifyMatrimonialPayment,
};
