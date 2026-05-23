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
    const divorceCertificateS3 = req.files?.divorceCertificate?.[0]?.location || null;

    // Convert S3 URLs → CDN
    const passportPhoto = passportPhotoS3 ? convertS3UrlToCDN(passportPhotoS3) : null;
    const fullPhoto = fullPhotoS3 ? convertS3UrlToCDN(fullPhotoS3) : null;
    const familyPhoto = familyPhotoS3 ? convertS3UrlToCDN(familyPhotoS3) : null;
    const healthCertificate = healthCertificateS3 ? convertS3UrlToCDN(healthCertificateS3) : null;
    const educationCertificate = educationCertificateS3 ? convertS3UrlToCDN(educationCertificateS3) : null;
    const divorceCertificate = divorceCertificateS3 ? convertS3UrlToCDN(divorceCertificateS3) : null;

    // ============= DOB & AGE PROCESSING (BACKEND FIX) =============
    let processedDob = null;
    let processedAge = null;

    if (req.body.dob) {
      // Parse DOB (Expected format: YYYY-MM-DD)
      const dobDate = new Date(req.body.dob);
      
      // Check if valid date
      if (!isNaN(dobDate.getTime())) {
        processedDob = dobDate;

        // Calculate Age from DOB
        const today = new Date();
        let age = today.getFullYear() - dobDate.getFullYear();
        const monthDiff = today.getMonth() - dobDate.getMonth();

        // Adjust age if birthday hasn't occurred this year
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) {
          age--;
        }

        processedAge = age.toString(); // Store as string to match schema
      } else {
        console.warn("⚠️ Invalid DOB received:", req.body.dob);
      }
    }

    // Marriage Info (Clean Handling)
    let marriageInfo = {
      marriageType: req.body.marriageType,
    };

    // If Divorced → Add divorcedDetails + divorceCertificate
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

    // If Widowed/widower → Add widowedDetails
    if (req.body.marriageType === "Widowed/widower") {
      marriageInfo.widowedDetails = {
        reasonSpouseDeath: req.body.reasonSpouseDeath,
        spouseName: req.body.spouseName,
        spouseFatherName: req.body.spouseFatherName,
        spouseMotherName: req.body.spouseMotherName,
        numberOfChildren: req.body.numberOfChildren,
      };
    }

    // ============= PREPARE DATA FOR SAVING =============
    const biodataData = {
      ...req.body,
      dob: processedDob,           // ✅ Override with backend-processed DOB
      age: processedAge,            // ✅ Override with backend-calculated Age
      passportPhoto,
      fullPhoto,
      familyPhoto,
      healthCertificate,
      educationCertificate,
      marriageInfo,
    };

    // Save Biodata
    const biodata = new VyavahikBiodata(biodataData);
    await biodata.save();

    res.status(201).json({
      success: true,
      message: "Biodata created successfully!",
      data: biodata,
    });

  } catch (error) {
    console.error("❌ Biodata Creation Error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating biodata",
      error: error.message,
    });
  }
};
// // ─── Helper: safe CDN convert ────────────────────────────────────────────────
// const toCDN = (files, key) => {
//   const loc = files?.[key]?.[0]?.location;
//   return loc ? convertS3UrlToCDN(loc) : null;
// };

// // ─── CREATE ──────────────────────────────────────────────────────────────────
// const createBiodata = async (req, res) => {
//   try {
//     const { body, files } = req;

//     // ── File uploads → CDN URLs ──────────────────────────────────
//     const educationCertificateUrl = toCDN(files, 'educationCertificate');
//     const divorceCertificateUrl   = toCDN(files, 'divorceCertificate');

//     // uploadedPhotos: multer field name = 'uploadedPhotos', max 10
//     const uploadedPhotos = (files?.uploadedPhotos || [])
//       .slice(0, 10)
//       .map((f, i) => ({
//         label: f.originalname || `photo_${i}`,
//         url: convertS3UrlToCDN(f.location),
//       }))
//       .filter((p) => p.url);

//     // ── DOB processing ───────────────────────────────────────────
//     let processedDob = null;
//     if (body.dob) {
//       const d = new Date(body.dob);
//       if (!isNaN(d.getTime())) processedDob = d;
//       else console.warn('⚠️ Invalid DOB:', body.dob);
//     }

//     // ── Marriage Info ────────────────────────────────────────────
//     const marriageInfo = { marriageType: body.marriageType };

//     if (body.marriageType === 'Divorced') {
//       marriageInfo.divorcedDetails = {
//         isDivorceComplete:  body.isDivorceComplete,
//         reasonForDivorce:   body.reasonForDivorce,
//         divorceCertificate: divorceCertificateUrl,
//         spouseName:         body.spouseName,
//         spouseFatherName:   body.spouseFatherName,
//         spouseMotherName:   body.spouseMotherName,
//         numberOfChildren:   body.numberOfChildren,
//       };
//     }

//     if (body.marriageType === 'Widowed/widower') {
//       marriageInfo.widowedDetails = {
//         spouseName:        body.spouseName,
//         spouseFatherName:  body.spouseFatherName,
//         spouseMotherName:  body.spouseMotherName,
//         reasonSpouseDeath: body.reasonSpouseDeath,
//         numberOfChildren:  body.numberOfChildren,
//       };
//     }

//     // ── Education ────────────────────────────────────────────────
//     const education = {
//       highestEducation:     body.highestEducation,
//       collegeUniversity:    body.collegeUniversity,
//       degreeName:           body.degreeName,
//       yearOfPassing:        body.yearOfPassing,
//       educationCertificate: educationCertificateUrl,
//     };

//     // ── Work Info ────────────────────────────────────────────────
//     const workInfo = {
//       workStatus:      body.workStatus,
//       companyName:     body.companyName,
//       businessName:    body.businessName,
//       workingIndustry: body.workingIndustry,
//       workLocation:    body.workLocation,
//       annualIncome:    body.annualIncome,
//     };

//     // ── Family Info ──────────────────────────────────────────────
//     const familyInfo = {
//       fatherName:       body.fatherName,
//       fatherOccupation: body.fatherOccupation,
//       motherName:       body.motherName,
//       motherOccupation: body.motherOccupation,
//       nativePlace:      body.nativePlace,
//       familyType:       body.familyType,
//       familyIncome:     body.familyIncome,
//       noOfBrothers:     body.noOfBrothers,
//       noOfSisters:      body.noOfSisters,
//     };

//     // ── Community / Religion ─────────────────────────────────────
//     const communityInfo = {
//       mulJain:      body.mulJain,
//       panth:        body.panth,
//       gotra:        body.gotra,
//       subGotra:     body.subGotra,
//       caste:        body.caste,
//       subCaste:     body.subCaste,
//       mamaGotra:    body.mamaGotra,
//       manglik:      body.manglik,
//       motherTongue: body.motherTongue,
//     };

//     // ── Address ──────────────────────────────────────────────────
//     const addressInfo = {
//       country:     body.country || 'India',
//       state:       body.state,
//       district:    body.district,
//       city:        body.city,
//       fullAddress: body.fullAddress,
//     };

//     // ── Contact ──────────────────────────────────────────────────
//     const contactInfo = {
//       mobileNumber:          body.contactMobile || body.mobileNumber,
//       contactPerson:         body.contactPerson,
//       email:                 body.email,
//       alternativeNumber:     body.alternativeNumber,
//       contactPersonRelation: body.contactPersonRelation,
//     };

//     // ── Partner Preference ───────────────────────────────────────
//     const partnerPreference = {
//       preferredAgeFrom:    body.preferredAgeFrom,
//       preferredAgeTo:      body.preferredAgeTo,
//       heightFrom:          body.heightFrom,
//       heightTo:            body.heightTo,
//       incomePreference:    body.incomePreference,
//       maritalStatus:       body.partnerMaritalStatus,
//       educationPreference: body.educationPreference,
//       locationPreference:  body.locationPreference,
//       additionalPreference:body.additionalPreference,
//     };


//     // ── Assemble Document ────────────────────────────────────────
//     const biodataData = {
//       userId: req.user?._id,

//       // profile
//       profile:                body.profile,
//       relationWithCandidate:  body.relationWithCandidate,
//       creatorName:            body.creatorName,

//       // basic
//       shravakId:   body.shravakId,
//       jainShravak: body.jainShravak,
//       fullName:    body.fullName,
//       gender:      body.gender,
//       dob:         processedDob,
//       timeOfBirth: body.timeOfBirth,
//       birthPlace:  body.birthPlace,
//       mobileNumber:body.mobileNumber,

//       // personal
//       height:                   body.height,
//       complexion:               body.complexion,
//       dietPreference:           body.dietPreference,
//       hobbies:                  body.hobbies,
//       physicalCondition:        body.physicalCondition,
//       physicalConditionDescribe:body.physicalConditionDescribe,

//       // nested
//       marriageInfo,
//       education,
//       workInfo,
//       familyInfo,
//       communityInfo,
//       addressInfo,
//       contactInfo,
//       uploadedPhotos,
//       healthReport,
//       partnerPreference,

//       specialInformation: body.specialInformation,
//       paymentScreenshot:  toCDN(files, 'paymentScreenshot'),
//       isVisible:          false,
//     };

//     const biodata = new VyavahikBiodata(biodataData);
//     await biodata.save();

//    res.status(201).json({
//       success: true,
//       message: 'Biodata created successfully!',
//       data: biodata,
//     });

//   } catch (error) {
//     console.error('❌ Biodata Creation Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error creating biodata',
//       error: error.message,
//     });
//   }
// };


// Update API for details only
const updateBiodata = async (req, res) => {
  try {
    const { id } = req.params;

    // Update text fields only (images not included here)
    let updateData = { ...req.body };

    const updatedBiodata = await VyavahikBiodata.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!updatedBiodata) {
      return res.status(404).json({
        success: false,
        message: "Biodata not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Biodata details updated successfully!",
      data: updatedBiodata,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating biodata details",
      error: error.message,
    });
  }
};
// Update API for images only
const updateBiodataImages = async (req, res) => {
  try {
    const { id } = req.params;

    // Extract ONLY 3 images from Multer-S3 response
    const passportPhotoS3 = req.files?.passportPhoto?.[0]?.location || null;
    const fullPhotoS3 = req.files?.fullPhoto?.[0]?.location || null;
    const familyPhotoS3 = req.files?.familyPhoto?.[0]?.location || null;

    // Convert S3 URL → CDN URL
    const passportPhoto = passportPhotoS3 ? convertS3UrlToCDN(passportPhotoS3) : undefined;
    const fullPhoto = fullPhotoS3 ? convertS3UrlToCDN(fullPhotoS3) : undefined;
    const familyPhoto = familyPhotoS3 ? convertS3UrlToCDN(familyPhotoS3) : undefined;

    // Prepare update object
    let updateData = {};

    // Insert only new uploaded photos
    if (passportPhoto) updateData.passportPhoto = passportPhoto;
    if (fullPhoto) updateData.fullPhoto = fullPhoto;
    if (familyPhoto) updateData.familyPhoto = familyPhoto;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No images uploaded",
      });
    }

    // Update the biodata
    const updatedBiodata = await VyavahikBiodata.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!updatedBiodata) {
      return res.status(404).json({
        success: false,
        message: "Biodata not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Biodata images updated successfully!",
      data: updatedBiodata,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating biodata images",
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
  deleteBiodata,
  updateBiodataImages
};
