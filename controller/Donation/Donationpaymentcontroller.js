const asyncHandler = require("express-async-handler");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Donation = require("../../model/Donation/donation"); // apna actual path use karo

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ✅ Step 1: Create Razorpay Order for Donation
const createDonationOrder = asyncHandler(async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || !amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "userId and valid amount are required",
      });
    }

    const amountInPaise = Math.round(Number(amount) * 100); // rupees → paise
    const receipt = `donation_${userId.toString().substring(0, 10)}_${Date.now()}`;

    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt,
    };

    const order = await razorpay.orders.create(options);

    console.log(
      "📦 Donation Order Created:",
      order.id,
      "Amount:",
      amountInPaise,
    );

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount, // paise mein (frontend ke liye)
      currency: order.currency,
      userId,
    });
  } catch (error) {
    console.error("Error in createDonationOrder:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create donation order",
      error: error.message,
    });
  }
});

// ✅ Step 2: Verify Razorpay Payment for Donation
const verifyDonationPayment = asyncHandler(async (req, res) => {
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

    console.log("✅ Donation Payment Verified:", razorpay_payment_id);

    res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      razorpay_payment_id,
      razorpay_order_id,
    });
  } catch (error) {
    console.error("Donation Payment Verification Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error during donation payment verification",
      error: error.message,
    });
  }
});

module.exports = {
  createDonationOrder,
  verifyDonationPayment,
};
