const JainVyapar = require('../../model/VyaparModels/vyaparModel');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const { s3Client, DeleteObjectCommand } = require('../../config/s3Config');
const { extractS3KeyFromUrl, convertS3UrlToCDN } = require('../../utils/s3Utils');
const User = require('../../model/UserRegistrationModels/userModel');

// Get available cities with active Sanghs
const getAvailableCities = async (req, res) => {
    try {
        const cities = await HierarchicalSangh.find(
            { level: 'city', status: 'active' },
            'location.city location.state location.district _id'
        ).sort({ 'location.city': 1 });

        return successResponse(res, cities);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};
const submitVyaparApplication = async (req, res) => {
  try {
    const body = req.body;

    // ✅ Parse location safely
    let location = body.location;
    if (typeof location === 'string') {
      location = JSON.parse(location);
    }

    const { country = 'India', state, district, city } = location || {};

    let applicationLevel = 'superadmin';
    let reviewingSanghId = null;

    // ================= SANGH ROUTING =================
    if (state && district && city) {
      const citySangh = await HierarchicalSangh.findOne({
        level: 'city',
        'location.state': state,
        'location.district': district,
        'location.city': city,
        status: 'active'
      });
      if (citySangh) {
        applicationLevel = 'city';
        reviewingSanghId = citySangh._id;
      }
    }

    if (!reviewingSanghId && state && district) {
      const districtSangh = await HierarchicalSangh.findOne({
        level: 'district',
        'location.state': state,
        'location.district': district,
        status: 'active'
      });
      if (districtSangh) {
        applicationLevel = 'district';
        reviewingSanghId = districtSangh._id;
      }
    }

    if (!reviewingSanghId && state) {
      const stateSangh = await HierarchicalSangh.findOne({
        level: 'state',
        'location.state': state,
        status: 'active'
      });
      if (stateSangh) {
        applicationLevel = 'state';
        reviewingSanghId = stateSangh._id;
      }
    }

    if (!reviewingSanghId && country) {
      const countrySangh = await HierarchicalSangh.findOne({
        level: 'country',
        'location.country': country,
        status: 'active'
      });
      if (countrySangh) {
        applicationLevel = 'country';
        reviewingSanghId = countrySangh._id;
      }
    }

    if (!reviewingSanghId) {
      applicationLevel = 'superadmin';
      reviewingSanghId = null;
    }

    // ================= FILE HANDLING =================
    // ✅ Business Logo (single file)
      let businessLogo = null;
      if (req.files?.businessLogo?.length > 0) {
        businessLogo = convertS3UrlToCDN(req.files.businessLogo[0].location);
      }

    const photos = (req.files?.entityPhoto || []).map(file => ({
      url: convertS3UrlToCDN(file.location),
      caption: body.photoCaption || ''
    }));

    const documents = (req.files?.entityDocuments || []).map(file => ({
      url: convertS3UrlToCDN(file.location),
      type: file.mimetype,
      name: file.originalname
    }));

    // ================= GENERATE UNIQUE BUSINESS CODE =================
    const generateBusinessCode = () => {
      const randomNumber = Math.floor(100000 + Math.random() * 900000); // 6 digits
      return `JAINBU${randomNumber}`;
    };
    const businessCode = generateBusinessCode();

    // ================= CREATE VYAPAR =================
    const vyapar = await JainVyapar.create({
      userId: req.user._id,
      businessName: body.businessName,
      businessCode, // ✅ add here
      incorporationYear: body.incorporationYear,
      businessType: body.businessType,
      businessCategory: body.businessCategory,
      description: body.description,
      specialOffer: body.specialOffer,
      location,
      ownerName: body.ownerName,
      contactPerson: body.contactPerson,
      alternativeNumber: body.alternativeNumber,
      email:body.email,
      photos,
      businessLogo,
      documents,
      legalLicences: body.legalLicences ? JSON.parse(body.legalLicences) : [],
      applicationLevel,
      reviewingSanghId,
      applicationStatus: 'pending',
      status: 'active'
    });

    // ================= USER ROLE UPDATE =================
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: {
        vyaparRoles: {
          vyaparId: vyapar._id,
          role: 'owner'
        }
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Vyapar application submitted successfully',
      data: {
        vyaparId: vyapar._id,
        businessCode, // ✅ return it in response
        applicationLevel,
        reviewingSanghId
      }
    });

  } catch (error) {
    console.error('submitVyaparApplication error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// Get pending applications for city president
const getPendingApplications = async (req, res) => {
    try {
        const { citySanghId } = req.params;
        const applications = await JainVyapar.find({
            citySanghId,
            applicationStatus: 'pending'
        }).sort({ createdAt: -1 });

        return successResponse(res, applications);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

// Review business application
// Allowed user IDs who can review
const ALLOWED_REVIEWERS = [
  "68837378f698f83ab109f019",
  "688378b981449c14306611d7",
  "6883812f016032eba93b4a0b",
  "68d52c7234c888afbdd2d355"
];

const reviewApplication = async (req, res) => {
  try {
    const { vyaparId } = req.params;
    const { status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return errorResponse(res, 'Invalid status', 400);
    }

    const vyapar = await JainVyapar.findById(vyaparId);
    if (!vyapar) {
      return errorResponse(res, 'Business application not found', 404);
    }

    // ✅ Check if current user is allowed to review
  // Current user id
const currentUserId = req.user._id.toString();

// 1️⃣ Direct allowed users (foundation / admin)
const isAllowedReviewer = ALLOWED_REVIEWERS.includes(currentUserId);

// 2️⃣ Sangh president check
const isPresidentOfReviewingSangh = Array.isArray(req.user.sanghRoles) &&
  req.user.sanghRoles.some(role =>
    role.role === 'president' &&
    String(role.sanghId?._id || role.sanghId) === String(vyapar.reviewingSanghId)
  );

if (!isAllowedReviewer && !isPresidentOfReviewingSangh) {
  return errorResponse(res, 'You are not authorized to review this application', 403);
}

    // Update application status
    vyapar.applicationStatus = status;
    vyapar.status = status === 'approved' ? 'active' : 'inactive';

    // Add review notes
    vyapar.reviewNotes = {
      text: req.body.reviewNotes?.text || `Application ${status}`,
      reviewedBy: req.user._id,
      reviewedAt: new Date()
    };

    await vyapar.save();

    // If approved, add Vyapar role to the owner's user account
    if (status === 'approved' && vyapar.owner && vyapar.owner.jainAadharNumber) {
      const user = await User.findOne({ jainAadharNumber: vyapar.owner.jainAadharNumber });
      if (user) {
        if (!user.vyaparRoles) user.vyaparRoles = [];

        const hasRole = user.vyaparRoles.some(role => role.vyaparId.toString() === vyapar._id.toString());
        if (!hasRole) {
          user.vyaparRoles.push({
            vyaparId: vyapar._id,
            role: 'owner',
            startDate: new Date()
          });
          await user.save();
        }
      }
    }

    return successResponse(res, {
      message: `Business application ${status}`,
      vyapar: {
        _id: vyapar._id,
        businessName: vyapar.businessName,
        applicationStatus: vyapar.applicationStatus,
        status: vyapar.status
      }
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// Vyapar login with JWT token
const vyaparLogin = async (req, res) => {
    try {
        // The user should already be authenticated via JWT token
        // We just need to verify they have the appropriate Vyapar role
        const userId = req.user._id;
        const { vyaparId } = req.params;

        const user = await User.findById(userId);

        if (!user) {
            return errorResponse(res, 'User not found', 404);
        }

        // Check if user has the role for this Vyapar
        const hasVyaparRole = user.vyaparRoles && user.vyaparRoles.some(role => 
            role.vyaparId.toString() === vyaparId
        );

        if (!hasVyaparRole) {
            return errorResponse(res, 'You do not have permission to access this business', 403);
        }

        // Get the Vyapar details
        const vyapar = await JainVyapar.findOne({
            _id: vyaparId,
            status: 'active'
        });

        if (!vyapar) {
            return errorResponse(res, 'Business not found or not active', 404);
        }

        return successResponse(res, {
            message: 'Access granted',
            vyaparId: vyapar._id,
            businessName: vyapar.businessName
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

// Get business details
const getVyaparDetails = async (req, res) => {
    try {
        const { vyaparId } = req.params;
        const vyapar = await JainVyapar.findById(vyaparId)
            .select('-accessCredentials.accessKey');

        if (!vyapar) {
            return errorResponse(res, 'Business not found', 404);
        }

        return successResponse(res, vyapar);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

// Update business details
const updateVyaparDetails = async (req, res) => {
    try {
        const { vyaparId } = req.params;
        const updateData = req.body;

        // Remove sensitive fields from update
        delete updateData.accessCredentials;
        delete updateData.status;
        delete updateData.payment;
        delete updateData.approvedBy;

        const vyapar = await JainVyapar.findById(vyaparId);
        if (!vyapar) {
            return errorResponse(res, 'Business not found', 404);
        }

        // Handle file updates if any
        if (req.files) {
            const deletePromises = [];
            
            if (req.files.entityPhoto) {
                // Delete old photos from S3
                vyapar.photos.forEach(photo => {
                    deletePromises.push(
                        s3Client.send(new DeleteObjectCommand({
                            Bucket: process.env.AWS_BUCKET_NAME,
                            Key: extractS3KeyFromUrl(photo.url)
                        }))
                    );
                });
                
                updateData.photos = req.files.entityPhoto.map(file => ({
                    url: file.location,
                    type: file.mimetype.startsWith('image/') ? 'image' : 'other'
                }));
            }

            if (req.files.entityDocuments) {
                // Delete old documents from S3
                vyapar.documents.forEach(doc => {
                    deletePromises.push(
                        s3Client.send(new DeleteObjectCommand({
                            Bucket: process.env.AWS_BUCKET_NAME,
                            Key: extractS3KeyFromUrl(doc.url)
                        }))
                    );
                });
                
                updateData.documents = req.files.entityDocuments.map(file => ({
                    url: file.location,
                    type: file.mimetype === 'application/pdf' ? 'pdf' : 'other'
                }));
            }

            await Promise.all(deletePromises);
        }

        Object.assign(vyapar, updateData);
        await vyapar.save();

        return successResponse(res, {
            message: 'Business details updated successfully',
            vyapar
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

// Get businesses by city
const getCityVyapars = async (req, res) => {
    try {
        const { citySanghId } = req.params;
        const vyapars = await JainVyapar.find({
            citySanghId,
            status: 'active'
        }).select('businessName businessType productCategory location photos');

        return successResponse(res, vyapars);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

// Get all businesses (public)
const getAllVyapars = async (req, res) => {
  try {
    const businesses = await JainVyapar
      .find({ status: 'active' }) // ✅ only active businesses
      .sort({ createdAt: -1 });   // ✅ latest first

    return successResponse(res, businesses);
  } catch (error) {
    console.error('Get all vyapars error:', error);
    return errorResponse(res, error.message, 500);
  }
};

const verifyBusiness = async (req, res) => {
  try {
    const { businessCode } = req.params;

    const business = await JainVyapar.findOne({ businessCode });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Invalid Business Code'
      });
    }

    return res.json({
      success: true,
      status: 'Verified',
      businessName: business.businessName,
      ownerName: business.ownerName,
      city: business.location?.city,
      district: business.location?.district,
      state: business.location?.state,
      applicationStatus: business.applicationStatus,
      verified:
        business.applicationStatus === 'approved' &&
        business.status === 'active'
    });

  } catch (error) {
    console.error('❌ verifyBusiness error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


const updateVyaparDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;

    // ✅ Find existing Vyapar
    const existingVyapar = await JainVyapar.findById(id);
    if (!existingVyapar) {
      return res.status(404).json({
        success: false,
        message: 'Vyapar not found'
      });
    }

    // ✅ Check if user is authorized (owner or admin)
    if (existingVyapar.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this business'
      });
    }

    // ✅ Parse location safely
    let location = body.location;
    if (typeof location === 'string') {
      location = JSON.parse(location);
    }

    // ================= BUSINESS LOGO UPDATE =================
    let businessLogo = existingVyapar.businessLogo;
    
    if (req.files?.businessLogo?.length > 0) {
      // Delete old logo from S3 if exists
      if (existingVyapar.businessLogo) {
        try {
          const oldLogoKey = extractS3KeyFromUrl(existingVyapar.businessLogo);
          if (oldLogoKey) {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: process.env.AWS_S3_BUCKET_NAME,
              Key: oldLogoKey
            }));
          }
        } catch (deleteError) {
          console.error('Error deleting old logo:', deleteError);
        }
      }
      
      // Upload new logo and convert to CDN URL
      businessLogo = convertS3UrlToCDN(req.files.businessLogo[0].location);
    }

    // ================= PHOTOS UPDATE - IMPROVED LOGIC =================
    let photos = existingVyapar.photos || [];
    
    if (req.files?.entityPhoto?.length > 0) {
      // Get existing photo URLs to preserve them
      const existingPhotoUrls = photos.map(p => p.url);
      
      // Parse photosToReplace if sent (array of indices to replace)
      let photosToReplace = [];
      if (body.photosToReplace) {
        photosToReplace = typeof body.photosToReplace === 'string' 
          ? JSON.parse(body.photosToReplace) 
          : body.photosToReplace;
      }

      // If specific photos to replace are mentioned
      if (photosToReplace.length > 0) {
        // Delete specific old photos that are being replaced
        for (const index of photosToReplace) {
          if (photos[index]) {
            try {
              const oldPhotoKey = extractS3KeyFromUrl(photos[index].url);
              if (oldPhotoKey) {
                await s3Client.send(new DeleteObjectCommand({
                  Bucket: process.env.AWS_S3_BUCKET_NAME,
                  Key: oldPhotoKey
                }));
              }
            } catch (deleteError) {
              console.error('Error deleting old photo:', deleteError);
            }
          }
        }

        // Replace photos at specific indices
        const newPhotoFiles = req.files.entityPhoto;
        photosToReplace.forEach((index, i) => {
          if (newPhotoFiles[i]) {
            photos[index] = {
              url: convertS3UrlToCDN(newPhotoFiles[i].location),
              caption: body.photoCaption || ''
            };
          }
        });
      } else {
        // Adding new photos (not replacing)
        const newPhotos = req.files.entityPhoto.map(file => ({
          url: convertS3UrlToCDN(file.location),
          caption: body.photoCaption || ''
        }));
        
        // Add new photos, maintain max 4
        photos = [...photos, ...newPhotos].slice(0, 4);
      }
    }

    // ================= DOCUMENTS UPDATE =================
    let documents = existingVyapar.documents || [];
    
    if (req.files?.entityDocuments?.length > 0) {
      const newDocuments = req.files.entityDocuments.map(file => ({
        url: convertS3UrlToCDN(file.location),
        type: file.mimetype,
        name: file.originalname
      }));
      documents = [...documents, ...newDocuments];
    }

    // ================= LEGAL LICENCES UPDATE =================
    let legalLicences = existingVyapar.legalLicences;
    if (body.legalLicences) {
      legalLicences = typeof body.legalLicences === 'string' 
        ? JSON.parse(body.legalLicences) 
        : body.legalLicences;
    }

    // ================= UPDATE FIELDS =================
    const updateData = {
      businessName: body.businessName || existingVyapar.businessName,
      incorporationYear: body.incorporationYear || existingVyapar.incorporationYear,
      businessType: body.businessType || existingVyapar.businessType,
      businessCategory: body.businessCategory || existingVyapar.businessCategory,
      description: body.description !== undefined ? body.description : existingVyapar.description,
      specialOffer: body.specialOffer !== undefined ? body.specialOffer : existingVyapar.specialOffer,
      location: location || existingVyapar.location,
      ownerName: body.ownerName || existingVyapar.ownerName,
      contactPerson: body.contactPerson || existingVyapar.contactPerson,
      alternativeNumber: body.alternativeNumber || existingVyapar.alternativeNumber,
      email: body.email || existingVyapar.email,
      businessLogo,
      photos,
      documents,
      legalLicences,
      updatedAt: Date.now()
    };

    // ================= UPDATE VYAPAR =================
    const updatedVyapar = await JainVyapar.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Vyapar details updated successfully',
      data: updatedVyapar
    });

  } catch (error) {
    console.error('updateVyaparDetails error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update vyapar details'
    });
  }
};

// ================= DELETE SPECIFIC PHOTO =================
const deleteVyaparPhoto = async (req, res) => {
  try {
    const { id, photoIndex } = req.params;

    const vyapar = await JainVyapar.findById(id);
    if (!vyapar) {
      return res.status(404).json({
        success: false,
        message: 'Vyapar not found'
      });
    }

    // Check authorization
    if (vyapar.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this photo'
      });
    }

    if (!vyapar.photos[photoIndex]) {
      return res.status(404).json({
        success: false,
        message: 'Photo not found'
      });
    }

    // Delete from S3
    try {
      const photoKey = extractS3KeyFromUrl(vyapar.photos[photoIndex].url);
      if (photoKey) {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: photoKey
        }));
      }
    } catch (deleteError) {
      console.error('Error deleting photo from S3:', deleteError);
    }

    // Remove from array
    vyapar.photos.splice(photoIndex, 1);
    await vyapar.save();

    return res.status(200).json({
      success: true,
      message: 'Photo deleted successfully',
      data: vyapar
    });

  } catch (error) {
    console.error('deleteVyaparPhoto error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete photo'
    });
  }
};

// ================= DELETE BUSINESS LOGO =================
const deleteVyaparLogo = async (req, res) => {
  try {
    const { id } = req.params;

    const vyapar = await JainVyapar.findById(id);
    if (!vyapar) {
      return res.status(404).json({
        success: false,
        message: 'Vyapar not found'
      });
    }

    // Check authorization
    if (vyapar.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this logo'
      });
    }

    if (!vyapar.businessLogo) {
      return res.status(404).json({
        success: false,
        message: 'No logo found to delete'
      });
    }

    // Delete from S3
    try {
      const logoKey = extractS3KeyFromUrl(vyapar.businessLogo);
      if (logoKey) {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: logoKey
        }));
      }
    } catch (deleteError) {
      console.error('Error deleting logo from S3:', deleteError);
    }

    // Remove from database
    vyapar.businessLogo = null;
    await vyapar.save();

    return res.status(200).json({
      success: true,
      message: 'Logo deleted successfully',
      data: vyapar
    });

  } catch (error) {
    console.error('deleteVyaparLogo error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete logo'
    });
  }
};

module.exports = {
    getAvailableCities,
    submitVyaparApplication,
    getPendingApplications,
    reviewApplication,
    vyaparLogin,
    getVyaparDetails,
    updateVyaparDetails,
    getCityVyapars,
    getAllVyapars,
    verifyBusiness,
    updateVyaparDetail,
    deleteVyaparPhoto,
    deleteVyaparLogo
};
