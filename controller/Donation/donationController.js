const Donation = require('../../model/Donation/donation');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

/**
 * CREATE DONATION
 */
const createDonation = async (req, res) => {
  try {
    const {
      userId,
      title,
      purpose,
      description,
      amount,
      inMemory
    } = req.body;

    let paymentScreenshotUrl = '';
    let donationPhotoUrl = '';
    let paymentStatus = 'pending';

    // Payment Screenshot
    if (
      req.files &&
      req.files.paymentScreenshot &&
      req.files.paymentScreenshot.length > 0
    ) {
      const s3Url = req.files.paymentScreenshot[0].location;
      paymentScreenshotUrl = convertS3UrlToCDN(s3Url);
      paymentStatus = 'success';
    }

    // Donation Photo
    if (
      req.files &&
      req.files.donationPhoto &&
      req.files.donationPhoto.length > 0
    ) {
      const s3Url = req.files.donationPhoto[0].location;
      donationPhotoUrl = convertS3UrlToCDN(s3Url);
    }

    const donation = await Donation.create({
      userId,
      title,
      purpose,
      description,
      amount,
      inMemory,
      paymentStatus,
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
    const donations = await Donation.find()
      .populate('userId', 'fullName gender phoneNumber profilePicture')
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

module.exports = {
  createDonation,
  getAllDonations,
  getDonationById
};
