const SanghClaim = require('../../model/Account Model/SanghClaim');
const Sangh = require('../../model/SanghModels/hierarchicalSanghModel');
const User = require('../../model/UserRegistrationModels/userModel');

// ✅ 1. CREATE CLAIM (NO DISTRIBUTION)
exports.createClaim = async (req, res) => {
  try {
    const {
      sanghId,
      ownSanghMembers,
      honoraryMembers,
      ownSanghAmount,
      honoraryMembersAmount,
      receivedPaymentsAmount,
      totalAmount,
      remark,
    } = req.body;

    const userId = req.user.id;

    // 🔹 Validate sangh exists
    const sangh = await Sangh.findById(sanghId);
    if (!sangh) {
      return res.status(404).json({
        success: false,
        message: 'Sangh not found'
      });
    }

    // 🔹 Validate amounts
    if (!totalAmount || totalAmount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid total amount' 
      });
    }

    // 🔹 Get unclaimed receivedPayments IDs
    const unclaimedPayments = sangh.receivedPayments
      ?.filter(p => p.status === 'unclaimed')
      .map(p => p._id) || [];

    // 🔹 Create claim
    const claim = await SanghClaim.create({
      sanghId,
      userId,
      totalMembers: (ownSanghMembers || 0) + (honoraryMembers || 0),
      ownSanghMembers: ownSanghMembers || 0,
      honoraryMembers: honoraryMembers || 0,
      ownSanghAmount: ownSanghAmount || 0,
      honoraryMembersAmount: honoraryMembersAmount || 0,
      receivedPaymentsAmount: receivedPaymentsAmount || 0,
      totalAmount,
      claimedPaymentIds: unclaimedPayments,
      remark: remark || '',
      status: 'submitted',
      paymentStatus: 'pending',
      submittedAt: new Date(),
    });

    // 🔹 Mark receivedPayments as "claimed" in sangh
    if (unclaimedPayments.length > 0) {
      await Sangh.updateOne(
        { _id: sanghId },
        {
          $set: {
            'receivedPayments.$[elem].status': 'claimed',
            'receivedPayments.$[elem].claimedAt': new Date(),
            'receivedPayments.$[elem].claimId': claim._id,
          }
        },
        {
          arrayFilters: [{ 'elem.status': 'unclaimed' }]
        }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Claim submitted successfully',
      data: claim,
    });

  } catch (err) {
    console.error('❌ Create Claim Error:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
};

// ✅ 2. GET ALL CLAIMS (FOUNDATION VIEW)
exports.getAllClaims = async (req, res) => {
  try {
    const { status, paymentStatus, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const claims = await SanghClaim.find(query)
      .populate('sanghId', 'name level location')
      .populate('userId', 'fullName phoneNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await SanghClaim.countDocuments(query);

    res.status(200).json({
      success: true,
      data: claims,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });

  } catch (err) {
    console.error('❌ Get Claims Error:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
};

// ✅ 3. GET SANGH'S OWN CLAIMS
exports.getSanghClaims = async (req, res) => {
  try {
    const { sanghId } = req.params;
    const { status, paymentStatus } = req.query;

    const query = { sanghId };
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const claims = await SanghClaim.find(query)
      .populate('userId', 'fullName phoneNumber')
      .populate('adminResponse.reviewedBy', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: claims,
    });

  } catch (err) {
    console.error('❌ Get Sangh Claims Error:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
};

// ✅ 4. GET SINGLE CLAIM DETAILS
exports.getClaimById = async (req, res) => {
  try {
    const { claimId } = req.params;

    const claim = await SanghClaim.findById(claimId)
      .populate('sanghId', 'name level location members honoraryMembers receivedPayments')
      .populate('userId', 'name phoneNumber')
      .populate('adminResponse.reviewedBy', 'name');

    if (!claim) {
      return res.status(404).json({ 
        success: false, 
        message: 'Claim not found' 
      });
    }

    res.status(200).json({
      success: true,
      data: claim,
    });

  } catch (err) {
    console.error('❌ Get Claim Error:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
};

// ✅ 5. APPROVE CLAIM (FOUNDATION ADMIN)
exports.approveClaim = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { approvalNote } = req.body;
    const adminId = req.user.id;

    const claim = await SanghClaim.findById(claimId);
    if (!claim) {
      return res.status(404).json({
        success: false, 
        message: 'Claim not found'
      });
    }

    if (claim.status !== 'submitted' && claim.status !== 'under_review') {
      return res.status(400).json({
        success: false,
        message: 'Claim cannot be approved in current status'
      });
    }

    // Update claim status
    claim.status = 'approved';
    claim.approvedAt = new Date();
    claim.adminResponse = {
      reviewedBy: adminId,
      reviewedAt: new Date(),
      approvalNote: approvalNote || '',
    };

    await claim.save();

    res.status(200).json({
      success: true,
      message: 'Claim approved successfully',
      data: claim,
    });

  } catch (err) {
    console.error('❌ Approve Claim Error:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
};

// ✅ 6. REJECT CLAIM (FOUNDATION ADMIN)
exports.rejectClaim = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { rejectionReason } = req.body;
    const adminId = req.user.id;

    const claim = await SanghClaim.findById(claimId);
    if (!claim) {
      return res.status(404).json({ 
        success: false, 
        message: 'Claim not found' 
      });
    }

    if (claim.status === 'approved' || claim.status === 'rejected') {
      return res.status(400).json({ 
        success: false, 
        message: 'Claim already processed' 
      });
    }

    // Update claim status
    claim.status = 'rejected';
    claim.paymentStatus = 'failed';
    claim.rejectedAt = new Date();
    claim.adminResponse = {
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: rejectionReason || 'Not specified',
    };

    await claim.save();

    // 🔹 Revert receivedPayments status back to "unclaimed"
    const sangh = await Sangh.findById(claim.sanghId);
    if (sangh && claim.claimedPaymentIds.length > 0) {
      await Sangh.updateOne(
        { _id: claim.sanghId },
        {
          $set: {
            'receivedPayments.$[elem].status': 'unclaimed',
            'receivedPayments.$[elem].claimedAt': null,
            'receivedPayments.$[elem].claimId': null,
          }
        },
        {
          arrayFilters: [{ 'elem._id': { $in: claim.claimedPaymentIds } }]
        }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Claim rejected successfully',
      data: claim,
    });

  } catch (err) {
    console.error('❌ Reject Claim Error:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
};

// ✅ 7. MARK AS PAID (FOUNDATION ADMIN - After bank transfer)
exports.markAsPaid = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { 
      transactionId, 
      paymentMode, 
      bankReference, 
      screenshot 
    } = req.body;

    const claim = await SanghClaim.findById(claimId);
    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Claim not found'
      });
    }

    if (claim.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Claim must be approved first'
      });
    }

    // Update payment status
    claim.paymentStatus = 'paid';
    claim.paidAt = new Date();
    claim.paymentDetails = {
      transactionId,
      paymentMode,
      bankReference,
      screenshot,
      paidAt: new Date(),
    };

    await claim.save();

    res.status(200).json({
      success: true,
      message: 'Payment marked as completed',
      data: claim,
    });

  } catch (err) {
    console.error('❌ Mark Paid Error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// ✅ 8. UPDATE CLAIM STATUS (GENERIC)
exports.updateClaimStatus = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { status } = req.body;

    const validStatuses = ['submitted', 'under_review', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const claim = await SanghClaim.findByIdAndUpdate(
      claimId,
      { status },
      { new: true }
    );

    if (!claim) {
      return res.status(404).json({
        success: false, 
        message: 'Claim not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Claim status updated',
      data: claim,
    });

  } catch (err) {
    console.error('❌ Update Status Error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};
// ✅ UPDATE PAYMENT STATUS (GENERIC)
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { paymentStatus } = req.body;

    const validPaymentStatuses = [
      'pending',
      'processing',
      'paid',
      'failed',
    ];

    if (!validPaymentStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status',
      });
    }

    const claim = await SanghClaim.findByIdAndUpdate(
      claimId,
      { paymentStatus },
      { new: true }
    );

    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Claim not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment status updated successfully',
      data: claim,
    });

  } catch (err) {
    console.error('❌ Update Payment Status Error:', err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ✅ 9. GET CLAIM STATISTICS (FOUNDATION DASHBOARD)
exports.getClaimStatistics = async (req, res) => {
  try {
    const stats = await SanghClaim.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
        }
      }
    ]);

    const paymentStats = await SanghClaim.aggregate([
      {
        $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        byStatus: stats,
        byPaymentStatus: paymentStats,
      },
    });

  } catch (err) {
    console.error('❌ Get Statistics Error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};