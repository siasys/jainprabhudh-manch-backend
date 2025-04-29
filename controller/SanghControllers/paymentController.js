const asyncHandler = require('express-async-handler');
const Payment = require('../../model/SanghModels/Payment');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose'); // Top par mongoose import hona chahiye

// Initialize Razorpay instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const createOrder = asyncHandler(async (req, res) => {
  try {
    const { sanghId, memberId } = req.body;
    if (!sanghId || !memberId) {
      return res.status(400).json({ success: false, message: "SanghId and MemberId are required" });
    }
    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) {
      return res.status(404).json({ success: false, message: "Sangh not found" });
    }
    const options = {
      amount: 1100 * 100,
      currency: "INR",
      receipt: `pay_${memberId.substring(0, 10)}_${Date.now()}`
    };
    const order = await razorpay.orders.create(options);
    const payment = new Payment({
      transactionId: order.id,
      sanghId: sanghId,
      memberId: memberId,
      amountCollected: 1100,
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


const verifyPayment = asyncHandler(async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, sanghId, memberId } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      const payment = await Payment.findOneAndUpdate(
        { transactionId: razorpay_order_id },
        { status: 'overdue' },
        { new: true }
      );
      return res.status(400).json({ success: false, message: "Invalid payment signature", data: payment });
    }

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) {
      return res.status(404).json({ success: false, message: "Sangh not found" });
    }

    let distribution = {
      city: { sanghId: null, amount: 0 },
      district: { sanghId: null, amount: 0 },
      state: { sanghId: null, amount: 0 },
      country: { sanghId: null, amount: 0 },
      foundation: { amount: 0 }
    };

    switch (sangh.level) {
      case 'country':
        distribution.country = { sanghId: sanghId, amount: 500 };
        break;
      case 'state':
        distribution.state = { sanghId: sanghId, amount: 500 };
        distribution.country = { sanghId: sangh.parentId, amount: 200 };
        break;
      case 'district':
        distribution.district = { sanghId: sanghId, amount: 500 };
        distribution.state = { sanghId: sangh.parentId, amount: 150 };
        distribution.country = { sanghId: sangh.grandParentId, amount: 150 };
        break;
      case 'city':
        distribution.city = { sanghId: sanghId, amount: 500 };
        distribution.district = { sanghId: sangh.parentId, amount: 100 };
        distribution.state = { sanghId: sangh.grandParentId, amount: 100 };
        distribution.country = { sanghId: sangh.greatGrandParentId, amount: 100 };
        break;
      default:
        return res.status(400).json({ success: false, message: "Invalid sangh level" });
    }

    // 🧠 Dynamic foundation amount calculation
    const totalDistributed = 
      (distribution.city?.amount || 0) + 
      (distribution.district?.amount || 0) + 
      (distribution.state?.amount || 0) + 
      (distribution.country?.amount || 0);

    distribution.foundation.amount = 1100 - totalDistributed;

    const payment = await Payment.findOneAndUpdate(
      { transactionId: razorpay_order_id },
      { status: 'paid', distribution },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment record not found" });
    }

    const updatedSangh = await HierarchicalSangh.findOneAndUpdate(
      { "members.userId": new mongoose.Types.ObjectId(memberId) },
      { $set: { "members.$.paymentStatus": "paid" } },
      { new: true }
    );
    if (!updatedSangh) {
      return res.status(404).json({ success: false, message: "Member not found in Sangh" });
    }

    res.status(201).json({ success: true, message: "Payment verified and member status updated", data: payment });

  } catch (error) {
    console.error("Payment Verification Error:", error);
    res.status(500).json({ success: false, message: "Server Error during payment verification", error: error.message });
  }
});




module.exports = { createOrder, verifyPayment };
