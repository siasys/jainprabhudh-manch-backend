const SanghClaim = require('../../model/Account Model/SanghClaim');
const Sangh = require('../../model/SanghModels/hierarchicalSanghModel');


const findFoundationSangh = async (sanghId) => {
  let currentSangh = await Sangh.findById(sanghId);

  while (currentSangh && currentSangh.level !== 'foundation') {
    if (!currentSangh.parentSangh) break;
    currentSangh = await Sangh.findById(currentSangh.parentSangh);
  }

  return currentSangh?.level === 'foundation' ? currentSangh : null;
};

/**
 * ✅ POST – Sangh creates claim
 */
exports.createClaim = async (req, res) => {
  try {
    const {
      sanghId,
      totalMembers,
      ownSanghMembers,
      otherMembers,
      amountPerMember,
    } = req.body;

    const userId = req.user.id;

    // 🔍 Find foundation via hierarchy
    const foundationSangh = await findFoundationSangh(sanghId);

    if (!foundationSangh) {
      return res.status(400).json({
        success: false,
        message: 'Foundation Sangh not found in hierarchy',
      });
    }

    // ✅ SAFE number conversion
    const ownMembers = Number(ownSanghMembers) || 0;
    const otherMembersCount = Number(otherMembers) || 0;
    const perMemberAmount = Number(amountPerMember) || 0;

    // ❌ Prevent wrong request
    // if (!perMemberAmount) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'amountPerMember is required',
    //   });
    // }

    // 💰 Calculation
    const ownAmount = ownMembers * perMemberAmount * 0.5;
    const otherAmount = otherMembersCount * perMemberAmount * 0.1;
    const totalAmount = ownAmount + otherAmount;

    if (isNaN(totalAmount)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount calculation',
      });
    }

    // ✅ Create Claim
    const claim = await SanghClaim.create({
      sanghId,
      userId,
      foundationId: foundationSangh._id,
      totalMembers,
      totalAmount,
    });

    res.status(201).json({
      success: true,
      message: 'Claim submitted successfully',
      data: claim,
      calculation: {
        ownMembers,
        otherMembersCount,
        perMemberAmount,
        ownAmount,
        otherAmount,
        totalAmount,
      },
    });
  } catch (error) {
    console.error('Create Claim Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
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
      .sort({ createdAt: -1 });

    res.json({ success: true, data: claims });
  } catch (error) {
    console.error('Get Claims By Sangh Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * ✅ GET ALL – Foundation side (all claims)
 */
exports.getAllClaimsForFoundation = async (req, res) => {
  try {
    const { foundationId } = req.params;

    const claims = await SanghClaim.find({ foundationId })
      .populate('sanghId', 'name city')
      .populate('userId', 'fullName')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: claims });
  } catch (error) {
    console.error('Get Foundation Claims Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * ✅ UPDATE – Foundation updates status / payment
 */
exports.updateClaimStatus = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { status, paymentStatus, remark } = req.body;

    const claim = await SanghClaim.findByIdAndUpdate(
      claimId,
      {
        ...(status && { status }),
        ...(paymentStatus && { paymentStatus }),
        ...(remark && { remark }),
      },
      { new: true }
    );

    if (!claim) {
      return res.status(404).json({ success: false, message: 'Claim not found' });
    }

    res.json({
      success: true,
      message: 'Claim updated successfully',
      data: claim,
    });
  } catch (error) {
    console.error('Update Claim Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
