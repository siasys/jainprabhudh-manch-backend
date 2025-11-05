const Sadhu = require('../../model/SadhuModels/sadhuModel');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const User = require('../../model/UserRegistrationModels/userModel');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const { s3Client, DeleteObjectCommand } = require('../../config/s3Config');
const { extractS3KeyFromUrl } = require('../../utils/s3Utils');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

// Submit new sadhu info
const submitSadhuInfo = async (req, res) => {
  try {
    const sadhuData = { ...req.body };
    sadhuData.submittedBy = req.user._id;

    // ✅ Generate unique Sadhu ID (e.g., SADHU123456)
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    sadhuData.sadhuID = `SADHU${randomNum}`;

    // ✅ Parse upadhiList if present
    if (req.body.upadhiList) {
      try {
        sadhuData.upadhiList = JSON.parse(req.body.upadhiList);
      } catch (parseErr) {
        return errorResponse(res, 'Invalid upadhiList format');
      }
    }

    // ✅ Handle file uploads
    if (req.files) {
      if (req.files.entityPhoto) {
        const s3Url = req.files.entityPhoto[0].location;
        sadhuData.uploadImage = convertS3UrlToCDN(s3Url);
      }
      if (req.files.entityDocuments) {
        sadhuData.documents = req.files.entityDocuments.map(doc =>
          convertS3UrlToCDN(doc.location)
        );
      }
    }

    // ✅ Save Sadhu
    const sadhu = new Sadhu(sadhuData);
    await sadhu.save();

    // ✅ Add Sadhu reference to User
    const user = await User.findById(req.user._id);
    if (!user.sadhuRoles) user.sadhuRoles = [];
    user.sadhuRoles.push({
      sadhuId: sadhu._id,
      role: 'owner',
    });
    await user.save();

    // ✅ Send response with Sadhu ID
    return successResponse(
      res,
      'Sadhu information submitted successfully for review',
      {
        sadhuID: sadhu.sadhuID,
        sadhuData: sadhu,
      }
    );
  } catch (error) {
    return errorResponse(res, error.message);
  }
};





// Review sadhu submission
const reviewSadhuSubmission = async (req, res) => {
    try {
        const { sadhuId } = req.params;
        const { status } = req.body;

        const sadhu = await Sadhu.findById(sadhuId);
        if (!sadhu) {
            return errorResponse(res, 'Sadhu not found', 404);
        }

        sadhu.applicationStatus = status;
        sadhu.reviewInfo = {
            reviewedBy: {
                cityPresidentId: req.user._id,
                reviewDate: new Date(),
            }
        };

        if (status === 'approved') {
            // Find the user who submitted the sadhu application
            const submittedByUser = await User.findById(sadhu.submittedBy);
            if (submittedByUser) {
                // Add owner role to the user who submitted the application
                if (!submittedByUser.sadhuRoles) {
                    submittedByUser.sadhuRoles = [];
                }
                submittedByUser.sadhuRoles.push({
                    sadhuId: sadhu._id,
                    role: 'owner',
                    approvedAt: new Date()
                });
                await submittedByUser.save();
            }
            await sadhu.save();
            return successResponse(res, 'Sadhu approved and role assigned to user', {
                sadhu
            });
        }
        await sadhu.save();
        return successResponse(res, `Sadhu submission ${status}`, sadhu);
    } catch (error) {
        return errorResponse(res, error.message);
    }
};

// Update sadhu profile

const updateSadhuProfile = async (req, res) => {
  try {
    const { sadhuId } = req.params;
    const updates = req.body;
    const files = req.files;

    // 🧩 Find the Sadhu record
    const sadhu = await Sadhu.findById(sadhuId);
    if (!sadhu) {
      return errorResponse(res, 'Sadhu not found');
    }

    // 🖼️ Handle profile image update
    if (files?.entityPhoto) {
      if (sadhu.uploadImage) {
        const key = extractS3KeyFromUrl(sadhu.uploadImage);
        await s3Client.send(new DeleteObjectCommand({ Key: key }));
      }
      sadhu.uploadImage = files.entityPhoto[0].location;
    }

    // 🧾 Merge updates safely
    for (const key in updates) {
      // Nested objects ko handle karo
      if (typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        sadhu[key] = {
          ...(sadhu[key] || {}),
          ...updates[key],
        };
      } else {
        sadhu[key] = updates[key];
      }
    }

    // ✅ Save updated record
    await sadhu.save();

    return successResponse(res, 'Profile updated successfully', sadhu);
  } catch (error) {
    console.error('Sadhu Update Error:', error);
    return errorResponse(res, error.message);
  }
};

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

// Get pending sadhu applications for city president
const getPendingSadhuApplications = async (req, res) => {
    try {
        const { citySanghId } = req.params;

        const applications = await Sadhu.find({
            citySanghId,
            applicationStatus: 'pending'
        }).sort({ createdAt: -1 });

        return successResponse(res, applications);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

// Get all sadhus (public)
const getAllSadhus = async (req, res) => {
    try {
        const sadhus = await Sadhu.find({
            status: 'approved',
            isActive: true
        })
        .select('-accessCredentials');

        return successResponse(res, 'Sadhus retrieved successfully', sadhus);
    } catch (error) {
        return errorResponse(res, error.message);
    }
};
// Get all sadhus (public)
const getAllSadhu = async (req, res) => {
    try {
        const sadhus = await Sadhu.find({
           // isActive: true
        })
        .select('-accessCredentials'); // citySanghId ka sirf location fetch hoga

        return successResponse(res, 'Sadhus retrieved successfully', sadhus);
    } catch (error) {
        return errorResponse(res, error.message);
    }
};

// Get single sadhu (public)
const getSadhuById = async (req, res) => {
    try {
        const { sadhuId } = req.params;
        const sadhu = await Sadhu.findOne({
            _id: sadhuId,
            // status: 'approved',
            // isActive: true
        })
        .select('-accessCredentials');
        if (!sadhu) {
            return errorResponse(res, 'Sadhu not found', 404);
        }
        return successResponse(res, 'Sadhu retrieved successfully', sadhu);
    } catch (error) {
        return errorResponse(res, error.message);
    }
};

module.exports = {
    submitSadhuInfo,
    reviewSadhuSubmission,
    getAllSadhus,
    getAllSadhu,
    getSadhuById,
    updateSadhuProfile,
    getAvailableCities,
    getPendingSadhuApplications
};
