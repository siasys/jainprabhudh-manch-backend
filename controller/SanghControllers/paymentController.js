const asyncHandler = require('express-async-handler');
const Payment = require('../../model/SanghModels/Payment');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Helper to get amount based on level
const getAmountByLevel = (level, sanghType, age) => {
  const type = sanghType?.toLowerCase();
  const lvl = level?.toLowerCase();

  const isYouthLike = (type === 'youth' || type === 'women') || (type === 'main' && age < 35);

  if (isYouthLike) {
    switch (lvl) {
      case 'city': return 500;
      case 'district': return 1100;
      case 'state': return 2500;
      case 'country': return 5100;
      default: return 500;
    }
  } else {
    switch (lvl) {
      case 'district': return 2100;
      case 'state': return 5100;
      case 'country': return 11000;
      case 'city':
      default: return 1100;
    }
  }
};

const createOrder = asyncHandler(async (req, res) => {
  try {
    const { sanghId, memberId, age } = req.body;
    if (!sanghId || !memberId) {
      return res.status(400).json({ success: false, message: "SanghId and MemberId are required" });
    }

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) {
      return res.status(404).json({ success: false, message: "Sangh not found" });
    }

    const amount = getAmountByLevel(sangh.level, sangh.sanghType,age);
    const receipt = `pay_${memberId.substring(0, 10)}_${Date.now()}`;

    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt
    };

    const order = await razorpay.orders.create(options);

    const payment = new Payment({
      transactionId: order.id,
      sanghId,
      memberId,
      amountCollected: amount,
      currency: "INR",
      status: "pending"
    });
    await payment.save();

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      sanghId,
      memberId
    });
  } catch (error) {
    console.error("Error in createOrder:", error);
    res.status(500).json({ success: false, message: "Failed to create order", error: error.message });
  }
});

// verifyPayment backend (only update payment, not member)
const verifyPayment = asyncHandler(async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, age, sanghId } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      await Payment.findOneAndUpdate(
        { transactionId: razorpay_order_id },
        { status: 'overdue' },
        { new: true }
      );
      return res.status(400).json({ success: false, message: "Invalid payment signature" });
    }

    // 🔹 get sangh to calculate amount
    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) {
      return res.status(404).json({ success: false, message: "Sangh not found" });
    }
    const amount = getAmountByLevel(sangh.level, sangh.sanghType, age);

    //update payment with status + foundationAccount
    const payment = await Payment.findOneAndUpdate(
      { transactionId: razorpay_order_id },
      {
        status: 'paid',
        foundationAccount: {
          amount,
          accountId: 'foundation'
        }
      },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment record not found" });
    }

    res.status(201).json({
      success: true,
      message: "Payment verified successfully",
      data: payment
    });

  } catch (error) {
    console.error("Payment Verification Error:", error);
    res.status(500).json({ success: false, message: "Server Error during payment verification", error: error.message });
  }
});


// VERIFY PAYMENT ONLY USING ORDER ID
const verifyPaymentByOrderId = asyncHandler(async (req, res) => {
  try {
    const { orderId, sanghId, memberId, userId } = req.body;

    if (!orderId || !sanghId || !memberId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const payment = await Payment.findOne({ transactionId: orderId });

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    if (payment.status !== 'paid') {
      return res.status(400).json({ success: false, message: "Payment not completed yet" });
    }

    // ✅ Check if already a member in Sangh
    const sangh = await HierarchicalSangh.findById(sanghId);

    if (!sangh) {
      return res.status(404).json({ success: false, message: "Sangh not found" });
    }

    const isMember = sangh.members?.some(
      (m) => m?.userId?.toString() === userId?.toString()
    );

    return res.status(200).json({
      success: true,
      message: isMember ? "Already a member" : "Payment verified, proceed to form",
      alreadyMember: isMember,
    });

  } catch (error) {
    console.error("Order ID verification error:", error);
    res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
});

const createOfficeBearerOrder = asyncHandler(async (req, res) => {
  const { sanghId, memberId, role } = req.body;

  if (!sanghId || !memberId || !role) {
    return res.status(400).json({ success: false, message: "sanghId, userId and role are required" });
  }
  const userId = memberId;

  const sangh = await HierarchicalSangh.findById(sanghId);
  if (!sangh) {
    return res.status(404).json({ success: false, message: "Sangh not found" });
  }

  const amount = getAmountByLevel(sangh.level);
  const receipt = `office_${userId.substring(0, 10)}_${Date.now()}`;

  const options = {
    amount: amount * 100,
    currency: "INR",
    receipt
  };

  const order = await razorpay.orders.create(options);

  const payment = new Payment({
    transactionId: order.id,
    sanghId,
    memberId: userId, // Keeping same field for simplicity
    amountCollected: amount,
    currency: "INR",
    status: "pending",
    role: role,
    type: "officeBearer"  // optional for clarity
  });

  await payment.save();

  res.status(200).json({
    success: true,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    sanghId,
    userId
  });
});

const verifyOfficeBearerPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, sanghId, memberId, role } = req.body;
  const userId = memberId;
  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    await Payment.findOneAndUpdate(
      { transactionId: razorpay_order_id },
      { status: 'overdue' }
    );
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }

  const sangh = await HierarchicalSangh.findById(sanghId);
  if (!sangh) {
    return res.status(404).json({ success: false, message: "Sangh not found" });
  }

  const amount = getAmountByLevel(sangh.level);
  const distribution = { foundation: { amount } };

const payment = await Payment.findOneAndUpdate(
  { transactionId: razorpay_order_id },
  {
    status: 'paid',
    foundationAccount: {
      amount: amount,
      accountId: 'foundation' // Optional
    }
  },
  { new: true }
);

  // Update paymentStatus in officeBearers array
  const updatedSangh = await HierarchicalSangh.findOneAndUpdate(
    {
      _id: sanghId,
      officeBearers: {
        $elemMatch: {
          userId: new mongoose.Types.ObjectId(userId),
          role: role
        }
      }
    },
    {
      $set: {
        "officeBearers.$.paymentStatus": "paid"
      }
    },
    { new: true }
  );

  if (!updatedSangh) {
    return res.status(404).json({ success: false, message: "Office bearer not found in Sangh" });
  }

  res.status(200).json({
    success: true,
    message: "Office bearer payment verified",
    data: payment
  });
});


module.exports = {verifyPaymentByOrderId, createOrder, verifyPayment,createOfficeBearerOrder ,verifyOfficeBearerPayment  };
