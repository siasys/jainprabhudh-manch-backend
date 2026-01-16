const Donation = require('../../model/Donation/donation');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const Sangh = require('../../model/SanghModels/hierarchicalSanghModel');

/**
 * CREATE DONATION
 */
const createDonation = async (req, res) => {
  try {
    const {
      userId,
      title,
      purpose,
      amount,
      onBehalfOf,
      onBehalfOfName,
      isGuptDaan
    } = req.body;

    // 🔐 BASIC VALIDATION
    // if (!userId || !title || !amount || !onBehalfOf || !onBehalfOfName) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Required fields are missing'
    //   });
    // }

    // 🔒 FETCH FOUNDATION SANGH (ALWAYS FIXED)
    const foundationSangh = await Sangh.findOne({ level: 'foundation' });

    if (!foundationSangh) {
      return res.status(404).json({
        success: false,
        message: 'Foundation Sangh not found'
      });
    }

    let paymentScreenshotUrl = '';
    let donationPhotoUrl = '';
    let paymentStatus = 'pending';

    // ✅ Payment Screenshot
    if (
      req.files?.paymentScreenshot &&
      req.files.paymentScreenshot.length > 0
    ) {
      const s3Url = req.files.paymentScreenshot[0].location;
      paymentScreenshotUrl = convertS3UrlToCDN(s3Url);
      paymentStatus = 'success';
    }

    // ✅ Donation Photo
    if (
      req.files?.donationPhoto &&
      req.files.donationPhoto.length > 0
    ) {
      const s3Url = req.files.donationPhoto[0].location;
      donationPhotoUrl = convertS3UrlToCDN(s3Url);
    }

    // ✅ CREATE DONATION
    const donation = await Donation.create({
      userId,
      sanghId: foundationSangh._id,
      title,
      purpose,
      amount,
      onBehalfOf,
      onBehalfOfName,
      paymentStatus,
      isGuptDan: isGuptDaan === true || isGuptDaan === 'true',
      paymentScreenshot: paymentScreenshotUrl,
      donationPhoto: donationPhotoUrl
    });

    return res.status(201).json({
      success: true,
      message: 'Donation submitted successfully',
      data: donation
    });

  } catch (error) {
    console.error('CREATE DONATION ERROR:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 *GET ALL DONATIONS
 */
const getAllDonations = async (req, res) => {
  try {
    const donations = await Donation.find({
      isGuptDan: { $ne: true } // ✅ Gupt Dan hide
    })
      .populate('userId', 'fullName gender phoneNumber profilePicture')
      .populate('sanghId', 'name sanghImage')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: donations.length,
      data: donations
    });
  } catch (error) {
    console.error('GET ALL DONATIONS ERROR:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * GET DONATION BY ID
 */
const getDonationById = async (req, res) => {
  try {
    const { donationId } = req.params;

    const donation = await Donation.findById(donationId)
      .populate('userId', 'fullName gender phoneNumber profilePicture');

    if (!donation) {
      return res.status(404).json({
        success: false,
        message: 'Donation not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: donation
    });
  } catch (error) {
    console.error('GET DONATION BY ID ERROR:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
/**
 * UPDATE DONATION
 */
const updateDonation = async (req, res) => {
  try {
    const { donationId } = req.params;

    if (!donationId) {
      return res.status(400).json({
        success: false,
        message: 'Donation ID is required'
      });
    }

    const donation = await Donation.findById(donationId);
    if (!donation) {
      return res.status(404).json({
        success: false,
        message: 'Donation not found'
      });
    }

    const {
      title, 
      purpose,
      amount,
      onBehalfOf,
      onBehalfOfName
    } = req.body;

    // 🔐 Update fields only if provided
    if (title) donation.title = title;
    if (purpose) donation.purpose = purpose;
    if (amount) donation.amount = amount;
    if (onBehalfOf) donation.onBehalfOf = onBehalfOf;
    if (onBehalfOfName) donation.onBehalfOfName = onBehalfOfName;

    // ✅ Update donationPhoto if new file provided
    if (req.files?.donationPhoto && req.files.donationPhoto.length > 0) {
      const s3Url = req.files.donationPhoto[0].location;
      donation.donationPhoto = convertS3UrlToCDN(s3Url);
    }

    // ✅ Update paymentScreenshot if new file provided
    if (req.files?.paymentScreenshot && req.files.paymentScreenshot.length > 0) {
      const s3Url = req.files.paymentScreenshot[0].location;
      donation.paymentScreenshot = convertS3UrlToCDN(s3Url);
      donation.paymentStatus = 'success'; // mark payment success if screenshot updated
    }

    await donation.save();

    return res.status(200).json({
      success: true,
      message: 'Donation updated successfully',
      data: donation
    });

  } catch (error) {
    console.error('UPDATE DONATION ERROR:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = {
  createDonation,
  getAllDonations,
  getDonationById,
  updateDonation
};
