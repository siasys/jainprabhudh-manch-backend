const VyavahikBiodata = require('../../model/Matrimonial/VyavahikBiodata');
const JainAadhar = require('../../model/UserRegistrationModels/jainAadharModel');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

// Create API
const createBiodata = async (req, res) => {
  try {
    // Extract S3 uploaded URLs
    const passportPhotoS3 = req.files?.passportPhoto?.[0]?.location || null;
    const fullPhotoS3 = req.files?.fullPhoto?.[0]?.location || null;
    const familyPhotoS3 = req.files?.familyPhoto?.[0]?.location || null;

    const healthCertificateS3 = req.files?.healthCertificate?.[0]?.location || null;
    const educationCertificateS3 = req.files?.educationCertificate?.[0]?.location || null;

    const paymentScreenshotS3 = req.files?.paymentScreenshot?.[0]?.location || null;

    // ⭐ Divorce Certificate
    const divorceCertificateS3 = req.files?.divorceCertificate?.[0]?.location || null;

    // Convert S3 URLs → CDN
    const passportPhoto = passportPhotoS3 ? convertS3UrlToCDN(passportPhotoS3) : null;
    const fullPhoto = fullPhotoS3 ? convertS3UrlToCDN(fullPhotoS3) : null;
    const familyPhoto = familyPhotoS3 ? convertS3UrlToCDN(familyPhotoS3) : null;
    const healthCertificate = healthCertificateS3 ? convertS3UrlToCDN(healthCertificateS3) : null;
    const educationCertificate = educationCertificateS3 ? convertS3UrlToCDN(educationCertificateS3) : null;

    const paymentScreenshot = paymentScreenshotS3 ? convertS3UrlToCDN(paymentScreenshotS3) : null;

    const divorceCertificate = divorceCertificateS3 ? convertS3UrlToCDN(divorceCertificateS3) : null;

    // Marriage Info (Clean Handling)
    let marriageInfo = {
      marriageType: req.body.marriageType,
    };

    //  If Divorced → Add divorcedDetails + divorceCertificate
    if (req.body.marriageType === "Divorced") {
      marriageInfo.divorcedDetails = {
        divorcedCompleted: req.body.divorcedCompleted,
        reasonForDivorce: req.body.reasonForDivorce,
        spouseName: req.body.spouseName,
        spouseFatherName: req.body.spouseFatherName,
        spouseMotherName: req.body.spouseMotherName,
        numberOfChildren: req.body.numberOfChildren,
        divorceCertificate: divorceCertificate || null,
      };
    }
    //  If Widowed/widower → Add widowedDetails
    if (req.body.marriageType === "Widowed/widower") {
      marriageInfo.widowedDetails = {
        reasonSpouseDeath: req.body.reasonSpouseDeath,
        spouseName: req.body.spouseName,
        spouseFatherName: req.body.spouseFatherName,
        spouseMotherName: req.body.spouseMotherName,
        numberOfChildren: req.body.numberOfChildren,
      };
    }

    // Save Biodata
    const biodata = new VyavahikBiodata({
      ...req.body,
      passportPhoto,
      fullPhoto,
      familyPhoto,
      healthCertificate,
      educationCertificate,
      paymentScreenshot,
      marriageInfo,
    });

    await biodata.save();

    res.status(201).json({
      success: true,
      message: "Biodata created successfully!",
      data: biodata,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error creating biodata",
      error: error.message,
    });
  }
};


// Update API
const updateBiodata = async (req, res) => {
  try {
    const { id } = req.params;

    // Extract S3 uploaded URLs — ONLY 3 IMAGES
    const passportPhotoS3 = req.files?.passportPhoto?.[0]?.location || null;
    const fullPhotoS3 = req.files?.fullPhoto?.[0]?.location || null;
    const familyPhotoS3 = req.files?.familyPhoto?.[0]?.location || null;

    // Convert S3 → CDN ONLY 3 IMAGES
    const passportPhoto = passportPhotoS3 ? convertS3UrlToCDN(passportPhotoS3) : undefined;
    const fullPhoto = fullPhotoS3 ? convertS3UrlToCDN(fullPhotoS3) : undefined;
    const familyPhoto = familyPhotoS3 ? convertS3UrlToCDN(familyPhotoS3) : undefined;

    // Build update object
    let updateData = {
      ...req.body, // normal fields update honge
    };

    if (passportPhoto) updateData.passportPhoto = passportPhoto;
    if (fullPhoto) updateData.fullPhoto = fullPhoto;
    if (familyPhoto) updateData.familyPhoto = familyPhoto;

    // Update database
    const updatedBiodata = await VyavahikBiodata.findByIdAndUpdate(id, updateData, { new: true });

    if (!updatedBiodata) {
      return res.status(404).json({
        success: false,
        message: "Biodata not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Biodata updated successfully!",
      data: updatedBiodata,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating biodata",
      error: error.message,
    });
  }
};

// Delete API
const deleteBiodata = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedBiodata = await VyavahikBiodata.findByIdAndDelete(id);

    if (!deletedBiodata) {
      return res.status(404).json({
        success: false,
        message: "Biodata not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Biodata deleted successfully!",
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting biodata",
      error: error.message,
    });
  }
};


// Get Single Biodata API
const getBiodata = async (req, res) => {
  try {
    const { id } = req.params;
    const biodata = await VyavahikBiodata.findById(id);
    if (!biodata) {
      return res.status(404).json({
        success: false,
        message: 'Biodata not found',
      });
    }
    res.status(200).json({
      success: true,
      data: biodata,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching biodata',
      error: error.message,
    });
  }
};

// Get All Biodatas API
const getAllBiodatas = async (req, res) => {
  try {
    let filter = {};
    // Search Parameters
    const { age, name, gotra, panth, mulJain, upJati, dobPlace} = req.query;
    if (name) {
      filter.name = { $regex: name, $options: 'i' };
    }
    if (age) {
      filter.age = age;
    }
    if (gotra) {
      filter.gotra = { $regex: gotra, $options: 'i' };
    }
    if (panth) {
      filter.panth = { $regex: panth, $options: 'i' };
    }
    if (mulJain) {
      filter.mulJain = { $regex: mulJain, $options: 'i' };
    }
    if (upJati) {
      filter.upJati = { $regex: upJati, $options: 'i' };
    }
    if (dobPlace) {
      filter.dobPlace = { $regex: dobPlace, $options: 'i' };
    }
    const biodatas = await VyavahikBiodata.find(filter)
      .populate('userId', 'firstName lastName fullName profilePicture');
      res.status(200).json({
        success: true,
        data: biodatas,
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching biodatas',
      error: error.message,
    });
  }
};
// Check if user has a biodata
const checkUserBiodata = async (req, res) => {
  try {
    const biodata = await VyavahikBiodata.findOne({ userId: req.user._id });

    if (!biodata) {
      return res.status(200).json({
        success: true,
        hasBiodata: false
      });
    }

    res.status(200).json({
      success: true,
      hasBiodata: true,
      isPaid: biodata.paymentStatus === 'paid',
      isVisible: biodata.isVisible,
      biodataId: biodata._id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking biodata status',
      error: error.message,
    });
  }
};
const getBiodataByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find biodata using userId
    const biodata = await VyavahikBiodata.findOne({ userId })
      .populate('userId', 'firstName lastName fullName profilePicture');

    if (!biodata) {
      return res.status(404).json({
        success: false,
        message: 'Biodata not found for this user',
      });
    }

    res.status(200).json({
      success: true,
      data: biodata,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching biodata by userId',
      error: error.message,
    });
  }
};


module.exports = {
  createBiodata,
  updateBiodata,
  getBiodata,
  getBiodataByUserId,
  getAllBiodatas,
  checkUserBiodata,
  deleteBiodata
};
