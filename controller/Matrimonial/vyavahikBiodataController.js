const { VyavahikBiodata } = require('../../model/Matrimonial/VyavahikBiodata');
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

const toCDN = (files, key) => {
  const loc = files?.[key]?.[0]?.location;
  return loc ? convertS3UrlToCDN(loc) : null;
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
const createBiodatas = async (req, res) => {
  try {
    const { body, files } = req;

    // ── File uploads → CDN URLs ──────────────────────────────────
    const educationCertificateUrl = toCDN(files, "educationCertificate");
    const divorceCertificateUrl = toCDN(files, "divorceCertificate");

    // ── Uploaded Photos (max 10) ─────────────────────────────────
    // Pehli 3 photos ke fixed labels, baad wali extra photos
    const labeledFields = [
      { key: "passportPhoto", label: "Passport Photo" },
      { key: "fullPhoto", label: "Full Photo" },
      { key: "familyPhoto", label: "Family Photo" },
    ];

    const uploadedPhotos = [];

    // Pehle 3 labeled photos process karo
    for (const { key, label } of labeledFields) {
      const fileArr = files?.[key];
      const f = Array.isArray(fileArr) ? fileArr[0] : fileArr;
      if (f?.location) {
        uploadedPhotos.push({
          label,
          url: convertS3UrlToCDN(f.location),
        });
      }
    }

    // Extra photos (photo_4 se photo_10 tak) process karo
    const extraPhotos = (files?.extraPhotos || [])
      .slice(0, 10 - uploadedPhotos.length) // total 10 se zyada nahi
      .map((f, i) => ({
        label: f.originalname || `Extra Photo ${i + 1}`,
        url: convertS3UrlToCDN(f.location),
      }))
      .filter((p) => p.url);

    uploadedPhotos.push(...extraPhotos);

    // ── DOB processing + Age calculation ─────────────────────────
    let processedDob = null;
    let age = null;
    if (body.dob) {
      const d = new Date(body.dob);
      if (!isNaN(d.getTime())) {
        processedDob = d;
        const today = new Date();
        age = today.getFullYear() - d.getFullYear();
        const m = today.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
      } else console.warn("⚠️ Invalid DOB:", body.dob);
    }

    // ── Marriage Info ────────────────────────────────────────────
    const marriageInfo = { marriageType: body.marriageType };

    if (body.marriageType === "Divorced") {
      marriageInfo.divorcedDetails = {
        isDivorceComplete: body.isDivorceComplete,
        reasonForDivorce: body.reasonForDivorce,
        divorceCertificate: divorceCertificateUrl,
        spouseName: body.spouseName,
        spouseFatherName: body.spouseFatherName,
        spouseMotherName: body.spouseMotherName,
        numberOfChildren: body.numberOfChildren,
      };
    }

    if (body.marriageType === "Widowed/widower") {
      marriageInfo.widowedDetails = {
        spouseName: body.spouseName,
        spouseFatherName: body.spouseFatherName,
        spouseMotherName: body.spouseMotherName,
        reasonSpouseDeath: body.reasonSpouseDeath,
        numberOfChildren: body.numberOfChildren,
      };
    }

    // ── Education ────────────────────────────────────────────────
    const education = {
      highestEducation: body.highestEducation,
      collegeUniversity: body.collegeUniversity,
      degreeName: body.degreeName,
      yearOfPassing: body.yearOfPassing,
      educationCertificate: educationCertificateUrl,
    };

    // ── Work Info ────────────────────────────────────────────────
    const workInfo = {
      workStatus: body.workStatus,
      companyName: body.companyName,
      businessName: body.businessName,
      workingIndustry: body.workingIndustry,
      workLocation: body.workLocation,
      annualIncome: body.annualIncome,
    };

    // ── Brothers / Sisters — FormData string → array parse ──────
    let brothers = body.brothers || [];
    let sisters = body.sisters || [];

    if (typeof brothers === "string") {
      try {
        brothers = JSON.parse(brothers);
      } catch {
        brothers = [];
      }
    }
    if (typeof sisters === "string") {
      try {
        sisters = JSON.parse(sisters);
      } catch {
        sisters = [];
      }
    }

    // ── Family Info ──────────────────────────────────────────────
    const familyInfo = {
      fatherName: body.fatherName,
      fatherOccupation: body.fatherOccupation,
      motherName: body.motherName,
      motherOccupation: body.motherOccupation,
      nativePlace: body.nativePlace,
      familyType: body.familyType,
      familyIncome: body.familyIncome,
      noOfBrothers: body.noOfBrothers,
      brothers, // ✅ parsed array
      noOfSisters: body.noOfSisters,
      sisters, // ✅ parsed array
    };
    // ── Community / Religion ─────────────────────────────────────
    const communityInfo = {
      mulJain: body.mulJain,
      panth: body.panth,
      gotra: body.gotra,
      subGotra: body.subGotra,
      caste: body.caste,
      subCaste: body.subCaste,
      mamaGotra: body.mamaGotra,
      manglik: body.manglik,
      motherTongue: body.motherTongue,
    };

    // ── Address ──────────────────────────────────────────────────
    const addressInfo = {
      country: body.country || "India",
      state: body.state,
      district: body.district,
      city: body.city,
      fullAddress: body.fullAddress,
    };

    // ── Contact ──────────────────────────────────────────────────
    const contactInfo = {
      mobileNumber: body.contactMobile || body.mobileNumber,
      contactPerson: body.contactPerson,
      email: body.email,

      addNumber: {
        name: body.addNumberName,
        number: body.addNumber,
        relation: body.addNumberRelation,
        address: body.addNumberAddress,
      },
    };

    // ── Partner Preference ───────────────────────────────────────
    const partnerPreference = {
      preferredAgeFrom: body.preferredAgeFrom,
      preferredAgeTo: body.preferredAgeTo,
      heightFrom: body.heightFrom,
      heightTo: body.heightTo,
      incomePreference: body.incomePreference,
      maritalStatus: body.partnerMaritalStatus,
      educationPreference: body.educationPreference,
      locationPreference: body.locationPreference,
      additionalPreference: body.additionalPreference,
    };

    // ── Membership / Payment ───────────────────────────────
    const membershipInfo = {
      amount: body.amount || 500,
      paymentStatus: "pending",

      startDate: new Date(),

      validityDate: (() => {
        const date = new Date();
        date.setFullYear(date.getFullYear() + 1);
        return date;
      })(),
    };
    // ── Assemble Document (schema ke exact fields) ────────────────
    const biodataData = {
      userId: req.user?._id,

      // profile
      profile: body.profile,
      relationWithCandidate: body.relationWithCandidate,
      creatorName: body.creatorName,

      // basic info — schema mein 'name' hai, 'fullName' nahi
      shravakId: body.shravakId,
      jainShravak: body.jainShravak,
      name: body.name,
      gender: body.gender,
      dob: processedDob,
      age: age, // calculated from dob
      timeOfBirth: body.timeOfBirth,
      birthPlace: body.birthPlace,

      // personal
      height: body.height,
      complexion: body.complexion,
      dietPreference: body.dietPreference,
      hobbies: body.hobbies,
      aboutMySelf: body.aboutMySelf,
      physicalCondition: body.physicalCondition,
      physicalConditionDescribe: body.physicalConditionDescribe,

      // nested — schema ke according exact match
      marriageInfo,
      education,
      workInfo,
      familyInfo,
      communityInfo,
      addressInfo,
      contactInfo,
      membershipInfo,
      uploadedPhotos,
      partnerPreference,

      isVisible: false,
    };

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
//─── GET ALL BIODATAS ─────────────────────────────────────────────────────────
const getAllBiodata = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      gender,
      city,
      state,
      mulJain,
      panth,
      caste,
      maritalStatus,
      ageFrom,
      ageTo,
      heightFrom,
      heightTo,
    } = req.query;

    const filter = { isVisible: true };

    // ── Filters ──────────────────────────────────────────────────
    if (gender)        filter.gender = gender;
    if (city)          filter["addressInfo.city"]         = new RegExp(city, "i");
    if (state)         filter["addressInfo.state"]        = new RegExp(state, "i");
    if (mulJain)       filter["communityInfo.mulJain"]    = new RegExp(mulJain, "i");
    if (panth)         filter["communityInfo.panth"]      = new RegExp(panth, "i");
    if (caste)         filter["communityInfo.caste"]      = new RegExp(caste, "i");
    if (maritalStatus) filter["marriageInfo.marriageType"]= maritalStatus;

    // age filter via dob range
    if (ageFrom || ageTo) {
      filter.dob = {};
      if (ageTo)   filter.dob.$gte = new Date(new Date().setFullYear(new Date().getFullYear() - ageTo));
      if (ageFrom) filter.dob.$lte = new Date(new Date().setFullYear(new Date().getFullYear() - ageFrom));
    }

    // height filter
    if (heightFrom || heightTo) {
      filter.height = {};
      if (heightFrom) filter.height.$gte = Number(heightFrom);
      if (heightTo)   filter.height.$lte = Number(heightTo);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [biodatas, total] = await Promise.all([
      VyavahikBiodata.find(filter)
        .select("-interestsSent -interestsReceived -contactInfo") // hide sensitive fields in listing
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      VyavahikBiodata.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      message: "Biodatas fetched successfully",
      data: biodatas,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get All Biodata Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching biodatas",
      error: error.message,
    });
  }
};

// ─── GET SINGLE BIODATA BY ID ─────────────────────────────────────────────────
const getBiodataById = async (req, res) => {
  try {
    const { id } = req.params;

    const biodata = await VyavahikBiodata.findOne({ _id: id, isVisible: true })
      .populate("likedProfiles", "name gender dob uploadedPhotos")
      .populate("interestsSent.profileId", "name gender dob uploadedPhotos")
      .populate("interestsReceived.profileId", "name gender dob uploadedPhotos")
      .lean();

    if (!biodata) {
      return res.status(404).json({
        success: false,
        message: "Biodata not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Biodata fetched successfully",
      data: biodata,
    });
  } catch (error) {
    console.error("❌ Get Biodata By ID Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching biodata",
      error: error.message,
    });
  }
};

// ─── GET MY OWN BIODATA (logged in user) ─────────────────────────
const getMyBiodata = async (req, res) => {
  try {
    const biodata = await VyavahikBiodata.findOne({ userId: req.user._id })
      .populate("likedProfiles", "name gender dob uploadedPhotos")
      .populate("interestsSent.profileId", "name gender dob uploadedPhotos")
      .populate("interestsReceived.profileId", "name gender dob uploadedPhotos")
      .lean();

    if (!biodata) {
      return res.status(404).json({
        success: false,
        message: "Biodata not found for this user",
      });
    }

    res.status(200).json({
      success: true,
      message: "My biodata fetched successfully",
      data: biodata,
    });
  } catch (error) {
    console.error("❌ Get My Biodata Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching your biodata",
      error: error.message,
    });
  }
};
// ─── LIKE A PROFILE ────────────────────────────
// POST /biodata/like/:targetId
const likeProfile = async (req, res) => {
  try {
    const { targetId } = req.params;

    // apna biodata dhundo
    const myBiodata = await VyavahikBiodata.findOne({ userId: req.user._id });
    if (!myBiodata) {
      return res.status(404).json({
        success: false,
        message: "Your biodata not found",
      });
    }
    // target exist karta he?
    const targetExists = await VyavahikBiodata.exists({ _id: targetId });
    if (!targetExists) {
      return res.status(404).json({
        success: false,
        message: "Target profile not found",
      });
    }

    // apne aap ko like nahi kar sakte
    if (myBiodata._id.toString() === targetId) {
      return res.status(400).json({
        success: false,
        message: "You cannot like your own profile",
      });
    }
    // pehle se liked he?
    const alreadyLiked = myBiodata.likedProfiles.some(
      (id) => id.toString() === targetId
    );
    if (alreadyLiked) {
      return res.status(400).json({
        success: false,
        message: "Profile already liked",
      });
    }
    // push karo
    myBiodata.likedProfiles.push(targetId);
    await myBiodata.save();

    res.status(200).json({
      success: true,
      message: "Profile liked successfully",
      totalLikes: myBiodata.likedProfiles.length,
    });
  } catch (error) {
    console.error("❌ Like Profile Error:", error);
    res.status(500).json({
      success: false,
      message: "Error liking profile",
      error: error.message,
    });
  }
};

// ─── UNLIKE A PROFILE ─────────────────────────────────────────────────────────
// DELETE /biodata/like/:targetId
const unlikeProfile = async (req, res) => {
  try {
    const { targetId } = req.params;

    const myBiodata = await VyavahikBiodata.findOne({ userId: req.user._id });
    if (!myBiodata) {
      return res.status(404).json({
        success: false,
        message: "Your biodata not found",
      });
    }

    // liked he?
    const likedIndex = myBiodata.likedProfiles.findIndex(
      (id) => id.toString() === targetId
    );
    if (likedIndex === -1) {
      return res.status(400).json({
        success: false,
        message: "Profile not in your liked list",
      });
    }

    // pull karo
    myBiodata.likedProfiles.splice(likedIndex, 1);
    await myBiodata.save();

    res.status(200).json({
      success: true,
      message: "Profile unliked successfully",
      totalLikes: myBiodata.likedProfiles.length,
    });
  } catch (error) {
    console.error("❌ Unlike Profile Error:", error);
    res.status(500).json({
      success: false,
      message: "Error unliking profile",
      error: error.message,
    });
  }
};

// ─── GET MY LIKED PROFILES ───────────────────────────────────
// GET /biodata/liked
const getLikedProfiles = async (req, res) => {
  try {
    const myBiodata = await VyavahikBiodata.findOne({ userId: req.user._id })
      .populate(
        "likedProfiles",
        "name gender dob height complexion addressInfo uploadedPhotos communityInfo marriageInfo"
      )
      .lean();

    if (!myBiodata) {
      return res.status(404).json({
        success: false,
        message: "Your biodata not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Liked profiles fetched successfully",
      total: myBiodata.likedProfiles.length,
      data: myBiodata.likedProfiles,
    });
  } catch (error) {
    console.error("❌ Get Liked Profiles Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching liked profiles",
      error: error.message,
    });
  }
};
 // ─── SEND INTEREST ────────────────────────────────────────────────────────────
// POST /biodata/interest/:targetId
const sendInterest = async (req, res) => {
  try {
    const { targetId } = req.params;
    const { message } = req.body;

    // apna biodata
    const myBiodata = await VyavahikBiodata.findOne({ userId: req.user._id });
    if (!myBiodata) {
      return res.status(404).json({ success: false, message: "Your biodata not found" });
    }

    // target exist?
    const targetBiodata = await VyavahikBiodata.findOne({ _id: targetId, isVisible: true });
    if (!targetBiodata) {
      return res.status(404).json({ success: false, message: "Target profile not found" });
    }

    // apne aap ko interest nahi
    if (myBiodata._id.toString() === targetId) {
      return res.status(400).json({ success: false, message: "Cannot send interest to yourself" });
    }

    // pehle se interest bheja?
    const alreadySent = myBiodata.interestsSent.some(
      (i) => i.profileId.toString() === targetId
    );
    if (alreadySent) {
      return res.status(400).json({ success: false, message: "Interest already sent to this profile" });
    }

    // sender ke interestsSent mein add
    myBiodata.interestsSent.push({
      profileId: targetId,
      status: "pending",
      message: message || "",
      sentAt: new Date(),
    });

    // receiver ke interestsReceived mein add
    targetBiodata.interestsReceived.push({
      profileId: myBiodata._id,
      status: "pending",
      message: message || "",
      receivedAt: new Date(),
    });

    await Promise.all([myBiodata.save(), targetBiodata.save()]);

    res.status(200).json({
      success: true,
      message: "Interest sent successfully",
    });
  } catch (error) {
    console.error("❌ Send Interest Error:", error);
    res.status(500).json({ success: false, message: "Error sending interest", error: error.message });
  }
};

// ─── RESPOND TO INTEREST (accept / reject) ───────────────────────────────────
// PATCH /biodata/interest/:senderBiodataId/respond
// body: { status: "accepted" | "rejected" }
const respondToInterest = async (req, res) => {
  try {
    const { senderBiodataId } = req.params;
    const { status } = req.body;

    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be 'accepted' or 'rejected'" });
    }

    // apna biodata (receiver)
    const myBiodata = await VyavahikBiodata.findOne({ userId: req.user._id });
    if (!myBiodata) {
      return res.status(404).json({ success: false, message: "Your biodata not found" });
    }

    // apne received mein entry dhundo
    const receivedEntry = myBiodata.interestsReceived.find(
      (i) => i.profileId.toString() === senderBiodataId
    );
    if (!receivedEntry) {
      return res.status(404).json({ success: false, message: "Interest request not found" });
    }

    if (receivedEntry.status !== "pending") {
      return res.status(400).json({ success: false, message: `Interest already ${receivedEntry.status}` });
    }

    // apna received update
    receivedEntry.status = status;

    // sender ke interestsSent mein bhi sync
    const senderBiodata = await VyavahikBiodata.findById(senderBiodataId);
    if (senderBiodata) {
      const sentEntry = senderBiodata.interestsSent.find(
        (i) => i.profileId.toString() === myBiodata._id.toString()
      );
      if (sentEntry) sentEntry.status = status;
      await senderBiodata.save();
    }

    await myBiodata.save();

    res.status(200).json({
      success: true,
      message: `Interest ${status} successfully`,
    });
  } catch (error) {
    console.error("❌ Respond Interest Error:", error);
    res.status(500).json({ success: false, message: "Error responding to interest", error: error.message });
  }
};

// ─── GET MY SENT INTERESTS ────────────────────────────────────────────────────
// GET /biodata/interests/sent
const getSentInterests = async (req, res) => {
  try {
    const myBiodata = await VyavahikBiodata.findOne({ userId: req.user._id })
      .populate("interestsSent.profileId", "name gender dob uploadedPhotos addressInfo")
      .lean();

    if (!myBiodata) {
      return res.status(404).json({ success: false, message: "Your biodata not found" });
    }

    res.status(200).json({
      success: true,
      message: "Sent interests fetched successfully",
      total: myBiodata.interestsSent.length,
      data: myBiodata.interestsSent,
    });
  } catch (error) {
    console.error("❌ Get Sent Interests Error:", error);
    res.status(500).json({ success: false, message: "Error fetching sent interests", error: error.message });
  }
};

// ─── GET MY RECEIVED INTERESTS ────────────────────────────────────────────────
// GET /biodata/interests/received
const getReceivedInterests = async (req, res) => {
  try {
    const myBiodata = await VyavahikBiodata.findOne({ userId: req.user._id })
      .populate("interestsReceived.profileId", "name gender dob uploadedPhotos addressInfo")
      .lean();

    if (!myBiodata) {
      return res.status(404).json({ success: false, message: "Your biodata not found" });
    }

    res.status(200).json({
      success: true,
      message: "Received interests fetched successfully",
      total: myBiodata.interestsReceived.length,
      data: myBiodata.interestsReceived,
    });
  } catch (error) {
    console.error("❌ Get Received Interests Error:", error);
    res.status(500).json({ success: false, message: "Error fetching received interests", error: error.message });
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
  updateBiodataImages,
  getMyBiodata,
  getAllBiodata,
  getBiodataById,
  createBiodatas,
  getLikedProfiles,
  unlikeProfile,
  likeProfile,
  sendInterest,
  respondToInterest,
  getSentInterests,
  getReceivedInterests,
};
