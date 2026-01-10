const SanghClaim = require('../../model/Account Model/SanghClaim');
const Sangh = require('../../model/SanghModels/hierarchicalSanghModel');
const User = require('../../model/UserRegistrationModels/userModel');


exports.createClaim = async (req, res) => {
  try {
    const {
      sanghId,
      ownSanghMembers,
      honoraryMembers,
      remark,
      ownSanghAmount: frontendOwnSanghAmount,
      honoraryMembersAmount: frontendHonoraryAmount,
      foundationAmount: frontendFoundationAmount,
      countryAmount: frontendCountryAmount,
      districtAmount: frontendDistrictAmount,
      honorarySanghAmount: frontendHonorarySanghAmount,
      totalAmount: frontendTotalAmount,
    } = req.body;

    const userId = req.user.id;

    // 🔹 Fetch claiming sangh
    const claimingSangh = await Sangh.findById(sanghId);
    if (!claimingSangh) {
      return res.status(400).json({ success: false, message: 'Sangh not found' });
    }

    const { foundationId, honorarySanghId } = claimingSangh;

    // 🔹 SAFE COUNTS
    const regularCount = Number(ownSanghMembers) || 0;
    const honoraryCount = Number(honoraryMembers) || 0;
    if (regularCount <= 0 && honoraryCount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid members' });
    }

    // 🔹 FEES
    const REGULAR_FEE = claimingSangh.membershipFee || 0;
    const HONORARY_FEE = claimingSangh.honoraryFee || 110;

    // 🔹 Calculated base amounts
    const regularBase = regularCount * REGULAR_FEE;
    const honoraryBase = honoraryCount * HONORARY_FEE;

    // 🔹 Distribution percentages
    const ownShare = regularBase * 0.50;          // 50% -> claiming sangh
    const foundationShare = regularBase * 0.20;   // 20% -> foundation
    const countryShare = regularBase * 0.10;      // 10% -> country
    const districtShare = regularBase * 0.10;     // 10% -> district
    const honoraryShare = regularBase * 0.10;     // 10% -> honorary sangh

    // 🔹 Final amounts
    const ownSanghAmount = frontendOwnSanghAmount ?? (ownShare + honoraryBase);
    const honoraryMembersAmount = frontendHonoraryAmount ?? honoraryBase;
    const foundationAmount = frontendFoundationAmount ?? foundationShare;
    const countryAmount = frontendCountryAmount ?? countryShare;
    const districtAmount = frontendDistrictAmount ?? districtShare;
    const honorarySanghAmount = frontendHonorarySanghAmount ?? honoraryShare;
    const totalAmount = frontendTotalAmount ?? (regularBase + honoraryBase);

    // 🔹 SIRF PAID MEMBERS KI LOCATION SE COUNTRY AUR DISTRICT NIKALO
    let countrySanghId = null;
    let districtSanghId = null;

    // Regular members + Honorary members dono mein se paid wale
    const allMembers = [
      ...(claimingSangh.members || []),
      ...(claimingSangh.honoraryMembers || [])
    ];

    // Filter: sirf paid members
    const paidMembers = allMembers.filter(member => 
      member.paymentStatus === 'paid'
    );

    if (paidMembers.length > 0) {
      // Sabhi paid members ke locations collect karo
      const countries = new Set();
      const districts = new Set();

      paidMembers.forEach(member => {
        if (member.address?.country) {
          countries.add(member.address.country);
        }
        if (member.address?.district) {
          districts.add(member.address.district);
        }
      });

      // 🔹 Country Sangh dhundho (pehla country use karo ya majority)
      if (countries.size > 0) {
        const primaryCountry = Array.from(countries)[0]; // pehla country
        const countrySangh = await Sangh.findOne({
          level: 'country',
          'location.country': primaryCountry,
        });
        if (countrySangh) {
          countrySanghId = countrySangh._id;
        }
      }

      // 🔹 District Sangh dhundho (pehla district use karo ya majority)
      if (districts.size > 0) {
        const primaryDistrict = Array.from(districts)[0]; // pehla district
        const districtSangh = await Sangh.findOne({
          level: 'district',
          'location.district': primaryDistrict,
        });
        if (districtSangh) {
          districtSanghId = districtSangh._id;
        }
      }
    }

    // 🔹 CREATE CLAIM
    const claim = await SanghClaim.create({
      sanghId,
      userId,
      foundationId,
      countrySanghId,
      stateSanghId: null,
      districtSanghId,
      honorarySanghId,
      totalMembers: regularCount + honoraryCount,
      ownSanghMembers: regularCount,
      honoraryMembers: honoraryCount,
      ownSanghAmount,
      honoraryMembersAmount,
      foundationAmount,
      countryAmount,
      districtAmount,
      honorarySanghAmount,
      totalAmount,
      remark: remark || '',
    });

    // 🔹 UPDATE WALLETS
    const updates = [];

    updates.push(
      Sangh.findByIdAndUpdate(sanghId, { $inc: { totalAvailableAmount: ownSanghAmount } })
    );

    if (foundationId) {
      updates.push(
        Sangh.findByIdAndUpdate(foundationId, { $inc: { totalAvailableAmount: foundationAmount } })
      );
    }

    if (countrySanghId) {
      updates.push(
        Sangh.findByIdAndUpdate(countrySanghId, { $inc: { totalAvailableAmount: countryAmount } })
      );
    }

    if (districtSanghId) {
      updates.push(
        Sangh.findByIdAndUpdate(districtSanghId, { $inc: { totalAvailableAmount: districtAmount } })
      );
    }

    if (honorarySanghId) {
      updates.push(
        Sangh.findByIdAndUpdate(honorarySanghId, { $inc: { totalAvailableAmount: honorarySanghAmount } })
      );
    }

    await Promise.all(updates);

    res.status(201).json({
      success: true,
      message: 'Claim created successfully',
      data: claim,
      calculation: {
        regularBase,
        honoraryBase,
        ownSanghAmount,
        foundationAmount,
        countryAmount,
        districtAmount,
        honorarySanghAmount,
        totalAmount,
      },
      distributedTo: {
        foundationId,
        countrySanghId,
        districtSanghId,
        honorarySanghId,
      },
      paidMembersCount: paidMembers.length,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};
exports.getAllClaims = async (req, res) => {
  try {
    const claims = await SanghClaim.find({})
      .populate('sanghId', 'name level')
      .populate('userId', 'fullName profilePicture')
      .populate('foundationId', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: claims.length,
      data: claims,
    });
  } catch (error) {
    console.error('Get All Claims Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};
/**
 * ✅ GET – Claims by Sangh
 */
exports.getClaimsBySangh = async (req, res) => {
  try {
    const { sanghId } = req.params;

    const claims = await SanghClaim.find({ sanghId })
      .populate('userId', 'fullName profilePicture')
      .populate('foundationId', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: claims });
  } catch (error) {
    console.error('Get Claims By Sangh Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
exports.getClaimSummary = async (req, res) => {
  const { sanghId } = req.params;

  const claims = await SanghClaim.find({
    sanghId,
    status: { $in: ['submitted', 'approved'] }
  });

  const claimedAmount = claims.reduce(
    (sum, c) => sum + (Number(c.totalAmount) || 0),
    0
  );

  const pendingClaimAmount = claims
    .filter(c => c.paymentStatus === 'pending')
    .reduce((s, c) => s + c.totalAmount, 0);

  const approvedClaimAmount = claims
    .filter(c => c.paymentStatus === 'paid')
    .reduce((s, c) => s + c.totalAmount, 0);

  res.json({
    success: true,
    claimedAmount,
    pendingClaimAmount,
    approvedClaimAmount,
    claims
  });
};
/**
 * ✅ GET ALL – Foundation side (all claims)
 */
exports.getAllClaimsForFoundation = async (req, res) => {
  try {
    const { foundationId } = req.params;

    const claims = await SanghClaim.find({ foundationId })
      .populate('sanghId', 'name city level')
      .populate('userId', 'fullName')
      .sort({ createdAt: -1 });

    // Calculate totals
    const totals = claims.reduce((acc, claim) => {
      acc.totalClaims += 1;
      acc.totalAmount += claim.totalAmount || 0;
      acc.foundationAmount += claim.foundationAmount || 0;
      acc.sanghAmount += claim.sanghAmount || 0;
      
      if (claim.paymentStatus === 'paid') {
        acc.paidClaims += 1;
        acc.paidAmount += claim.sanghAmount || 0;
      } else if (claim.paymentStatus === 'pending') {
        acc.pendingClaims += 1;
        acc.pendingAmount += claim.sanghAmount || 0;
      }
      
      return acc;
    }, {
      totalClaims: 0,
      totalAmount: 0,
      foundationAmount: 0,
      sanghAmount: 0,
      paidClaims: 0,
      paidAmount: 0,
      pendingClaims: 0,
      pendingAmount: 0,
    });

    res.json({ 
      success: true, 
      data: claims,
      summary: totals,
    });
  } catch (error) {
    console.error('Get Foundation Claims Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * ✅ UPDATE – Foundation updates status / payment
 */
// exports.updateClaimStatus = async (req, res) => {
//   try {
//     const { claimId } = req.params;
//     const { status, paymentStatus, remark, transactionId, paymentMode } = req.body;

//     const updateData = {
//       ...(status && { status }),
//       ...(paymentStatus && { paymentStatus }),
//       ...(remark && { remark }),
//     };

//     // If payment is being marked as paid, update payment details
//     if (paymentStatus === 'paid') {
//       updateData['paymentDetails.paidAt'] = new Date();
//       if (transactionId) {
//         updateData['paymentDetails.transactionId'] = transactionId;
//       }
//       if (paymentMode) {
//         updateData['paymentDetails.paymentMode'] = paymentMode;
//       }
//     }

//     const claim = await SanghClaim.findByIdAndUpdate(
//       claimId,
//       updateData,
//       { new: true }
//     ).populate('sanghId', 'name')
//      .populate('foundationId', 'name');

//     if (!claim) {
//       return res.status(404).json({ success: false, message: 'Claim not found' });
//     }

//     res.json({
//       success: true,
//       message: 'Claim updated successfully',
//       data: claim,
//     });
//   } catch (error) {
//     console.error('Update Claim Error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

/**
 * ✅ GET – Single claim details
 */
exports.getClaimById = async (req, res) => {
  try {
    const { claimId } = req.params;

    const claim = await SanghClaim.findById(claimId)
      .populate('sanghId', 'name city level')
      .populate('foundationId', 'name')
      .populate('userId', 'fullName email profilePicture');

    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Claim not found',
      });
    }

    res.json({
      success: true,
      data: claim,
    });
  } catch (error) {
    console.error('Get Claim Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
exports.updateClaimStatus = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { status } = req.body;

    const allowedStatuses = [
      'submitted',
      'under_review',
      'approved',
      'rejected',
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid claim status',
      });
    }

    const claim = await SanghClaim.findByIdAndUpdate(
      claimId,
      { status },
      { new: true }
    )
      .populate('sanghId', 'name level')
      .populate('userId', 'fullName profilePicture')
      .populate('foundationId', 'name');

    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Claim not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Claim status updated successfully',
      data: claim,
    });
  } catch (error) {
    console.error('Update Claim Status Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { paymentStatus } = req.body;

    const allowedPaymentStatuses = [
      'pending',
      'paid',
      'rejected',
      'under_review',
    ];

    if (!allowedPaymentStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status',
      });
    }

    const claim = await SanghClaim.findById(claimId);

    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Claim not found',
      });
    }

    // 🔒 already paid → no double deduction
    if (claim.paymentStatus === 'paid' && paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Claim already paid',
      });
    }

    // ✅ IF payment approved → subtract from Sangh
    if (paymentStatus === 'paid' && claim.paymentStatus !== 'paid') {
      await Sangh.findByIdAndUpdate(
        claim.sanghId,
        {
          $inc: {
            totalAvailableAmount: -claim.ownSanghAmount, // 🔻 1760 minus
          },
        }
      );
    }

    claim.paymentStatus = paymentStatus;
    await claim.save();

    res.status(200).json({
      success: true,
      message: 'Payment status updated successfully',
      data: claim,
    });
  } catch (error) {
    console.error('Update Payment Status Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

module.exports = exports;