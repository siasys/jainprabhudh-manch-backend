const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');

const User = require('../../model/UserRegistrationModels/userModel');
const SanghPayment = require('../../model/SanghModels/Payment');
const JainAadharApplication = require('../../model/UserRegistrationModels/jainAadharModel');
const asyncHandler = require('express-async-handler');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const { s3Client, DeleteObjectCommand } = require('../../config/s3Config');
const { generateSanghToken,generateToken } = require('../../helpers/authHelpers');
const { extractS3KeyFromUrl } = require('../../utils/s3Utils');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const { createCanvas, loadImage } = require('canvas');
const path = require('path');
  const fs = require('fs');
const { default: axios } = require('axios');
// Helper Functions
const formatFullName = (firstName, lastName) => {
    return lastName.toLowerCase() === 'jain'
        ? `${firstName} Jain`
        : `${firstName} Jain (${lastName})`;
};

const validateOfficeBearers = async (officeBearers) => {
    for (const role of ['president', 'secretary', 'treasurer']) {
        const user = await User.findOne({
            jainAadharNumber: officeBearers[role].jainAadharNumber,
            jainAadharStatus: 'verified'
        });
        if (!user) {
            throw new Error(`${role}'s Jain Aadhar is not verified`);
        }
        // Check if user is already an office bearer in another active Sangh
        const existingSangh = await HierarchicalSangh.findOne({
            'officeBearers': {
                $elemMatch: {
                    'userId': user._id,
                    'status': 'active'
                }
            },
            'status': 'active'
        });

        if (existingSangh) {
            throw new Error(`${role} is already an office bearer in another Sangh`);
        }
    }
};
const switchToUserToken = asyncHandler(async (req, res) => {
  try {
    const decoded = req.jwtPayload;

    if (decoded.type !== "sangh" || !decoded.originalUserId) {
      return res.status(400).json({ message: "Invalid sangh token" });
    }

    const user = await User.findById(decoded.originalUserId);
    if (!user) {
      return res.status(404).json({ message: "Original user not found" });
    }

    const newToken = generateToken(user);
    res.json({ token: newToken, userId: user._id });

  } catch (err) {
    console.error("Switch to user failed:", err);
    res.status(500).json({ message: "Switch to user failed", error: err.message });
  }
});

const switchToSanghToken = asyncHandler(async (req, res) => {
  const { sanghId } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "User not found" });

  const matchedRole = user.sanghRoles.find(role =>
    role.sanghId.toString() === sanghId.toString()
  );

  if (!matchedRole) {
    return res.status(403).json({ message: "You don't have access to this Sangh" });
  }

  //  Use helper function
  const token = generateSanghToken(user, sanghId);

  return res.status(200).json({ token });
});

// Create new Sangh
const createHierarchicalSangh = asyncHandler(async (req, res) => {
  const coverImage = req.files?.coverImage ? convertS3UrlToCDN(req.files.coverImage[0].location) : null;
  const sanghImage = req.files?.sanghImage ? convertS3UrlToCDN(req.files.sanghImage[0].location) : null;
    try {
        const {
            name,
            level,
            location,
           officeAddress,
            parentSanghId,
            contact,
            establishedDate,
            description,
            socialMedia,
            parentSanghAccessId,
            sanghType = 'main'
        } = req.body;
        console.log("parentSanghId in request:", req.body);
        console.log("Received parentSanghId:", req.body.parentSanghId);

         // Validate required fields
        // if (!name || !level || !location || !officeBearers) {
            if (!name || !level || !location || !officeAddress) {
            return errorResponse(res, 'Missing required fields', 400);
        }
        // Validate sanghType
        if (!['main', 'women', 'youth'].includes(sanghType)) {
            return errorResponse(res, 'Invalid Sangh type. Must be "main", "women", or "youth"', 400);
        }
         // If creating a specialized Sangh, ensure it inherits the type from parent
         let resolvedSanghType = sanghType;
         let parentMainSanghId = null;

         if (parentSanghId) {
             const parentSangh = await HierarchicalSangh.findById(parentSanghId);
             if (!parentSangh) {
                 return errorResponse(res, 'Parent Sangh not found', 404);
             }

             // If parent is specialized, child must be the same type
             if (parentSangh.sanghType !== 'main') {
                 resolvedSanghType = parentSangh.sanghType;
             }

             // Track the top-level main Sangh for specialized Sanghs
             if (resolvedSanghType !== 'main') {
              parentMainSanghId = parentSangh.parentMainSangh
                  ? parentSangh.parentMainSangh
                  : parentSangh.sanghType === 'main'
                      ? parentSangh._id 
                      : null;
          }

         }
        // Validate location hierarchy based on level
        if (level === 'area' && (!location.country || !location.state || !location.district || !location.city || !location.area)) {
            return errorResponse(res, 'Area level Sangh requires complete location hierarchy (country, state, district, city, area)', 400);
        }

        // Additional area-specific validation
        if (level === 'area') {
            const existingAreaSangh = await HierarchicalSangh.findOne({
                level: 'area',
                'location.country': location.country,
                'location.state': location.state,
                'location.district': location.district,
                'location.city': location.city,
                'location.area': location.area,
                status: 'active'
            });
            if (existingAreaSangh) {
                return errorResponse(res, 'An active Sangh already exists for this area', 400);
            }
        }
        // Validate hierarchy level before creation
        const parentSangh = parentSanghId ? await HierarchicalSangh.findById(parentSanghId) : null;
        if (parentSangh) {
            const levelHierarchy = ['foundation','country', 'state', 'district', 'city', 'area'];
            const parentIndex = levelHierarchy.indexOf(parentSangh.level);
            const currentIndex = levelHierarchy.indexOf(level);
           const isSameLevelAllowed = (
            currentIndex === parentIndex &&
            parentSangh.sanghType === 'main' &&
            ['women', 'youth'].includes(sanghType)
        );

       if (currentIndex <= parentIndex && !isSameLevelAllowed) {
    return errorResponse(
        res,
        `Invalid hierarchy: ${level} level (${sanghType}) cannot be directly under ${parentSangh.level} (${parentSangh.sanghType})`,
        400
    );
}

        }
        // Create Sangh
        const sangh = await HierarchicalSangh.create({
            name,
            level,
            location,
            officeAddress,
            parentSangh: parentSanghId,
            description,
            contact,
            socialMedia,
            sanghType: resolvedSanghType,
            parentMainSangh: parentMainSanghId,
            createdBy: req.user._id,
            coverImage,
            sanghImage
        });
        await sangh.validateHierarchy();
        // Automatically create SanghAccess entry
        const SanghAccess = require('../../model/SanghModels/sanghAccessModel');
        const mongoose = require('mongoose');
        // Check if access already exists
        const existingAccess = await SanghAccess.findOne({ 
            sanghId: sangh._id,
            status: 'active'
        });
        let sanghAccess;
        let resolvedParentSanghAccessId = null;

        // Resolve parentSanghAccessId if provided
        if (parentSanghAccessId) {
            if (mongoose.Types.ObjectId.isValid(parentSanghAccessId)) {
                // It's already a valid ObjectId
                resolvedParentSanghAccessId = parentSanghAccessId;
            } else {
                // It might be an access code string
                const parentAccess = await SanghAccess.findOne({
                    accessId: parentSanghAccessId,
                    status: 'active'
                });

                if (parentAccess) {
                    resolvedParentSanghAccessId = parentAccess._id;
                }
            }
        }
        if (!existingAccess) {
            // Create new Sangh access
            sanghAccess = await SanghAccess.create({
                sanghId: sangh._id,
                level,
                location,
                createdBy: req.user._id,
                parentSanghAccess: resolvedParentSanghAccessId
            });
            // Update the Sangh with the sanghAccessId
            await HierarchicalSangh.findByIdAndUpdate(sangh._id, {
                sanghAccessId: sanghAccess._id
            });
            // Update the local sangh object for response
            sangh.sanghAccessId = sanghAccess._id;
            return successResponse(res, {
                sangh,
                accessId: sangh.accessId,
                sanghAccessId: sanghAccess._id,
                sanghAccessCode: sanghAccess.accessId
            }, 'Sangh created successfully with access', 201);
        } else {
            // If access already exists, ensure sanghAccessId is set
            if (!sangh.sanghAccessId) {
                await HierarchicalSangh.findByIdAndUpdate(sangh._id, {
                    sanghAccessId: existingAccess._id
                });
                sangh.sanghAccessId = existingAccess._id;
            }
            return successResponse(res, {
                sangh,
                accessId: sangh.accessId,
                sanghAccessId: existingAccess._id,
                sanghAccessCode: existingAccess.accessId
            }, 'Sangh created successfully with existing access', 201);
        }
    } catch (error) {
        if (req.files) {
            await deleteS3Files(req.files);
        }
        return errorResponse(res, error.message, 500);
    }
});

const getAllSangh = asyncHandler(async (req, res) => {
  try {
    const { district, state, city } = req.query;

    const query = {};
    if (district) {
      query['location.district'] = district;
      query['level'] = 'district'; // ✅ Only District level Sangh
    }
    if (state) query['location.state'] = state;
    if (city) query['location.city'] = city;

    const sanghs = await HierarchicalSangh.find(query);

    if (!sanghs.length) {
      return errorResponse(res, 'No Sangh found', 404);
    }

    // Convert photo URLs to CDN
    const updatedSanghs = sanghs.map((sangh) => {
      const updatedOfficeBearers = sangh.officeBearers.map((bearer) => ({
        ...bearer,
        photo: bearer.photo ? convertS3UrlToCDN(bearer.photo) : null,
      }));

      return {
        ...sangh._doc,
        officeBearers: updatedOfficeBearers,
      };
    });

    return successResponse(res, updatedSanghs, 'Filtered Sangh retrieved successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});


const getAllSanghs = asyncHandler(async (req, res) => {
    try {
        const { query } = req.query; // Fetch the query from request

        // If there's a search query, filter based on the query in name or location (country, state, etc.)
       const searchCriteria = query
            ? {
                  $or: [
                      { name: { $regex: query, $options: 'i' } }, // Match name with case insensitive regex
                      { 
                        'location': {
                            $or: [
                                { country: { $regex: query, $options: 'i' } },
                                { state: { $regex: query, $options: 'i' } },
                                { district: { $regex: query, $options: 'i' } },
                                { city: { $regex: query, $options: 'i' } },
                                { area: { $regex: query, $options: 'i' } }
                            ]
                        }
                      }
                  ]
              }
            : {}; // If no query, return all

        const sanghs = await HierarchicalSangh.find(searchCriteria);

        if (!sanghs.length) {
            return errorResponse(res, 'No Sangh found', 404);
        }

        // Convert S3 URLs to CDN URLs for each officeBearer's photo
        sanghs.forEach((sangh) => {
            if (sangh.officeBearers && sangh.officeBearers.length > 0) {
                sangh.officeBearers.forEach((bearer) => {
                    if (bearer.photo) {
                        bearer.photo = convertS3UrlToCDN(bearer.photo); // Apply the conversion function here
                    }
                });
            }
        });

        // Sort the Sanghs to bring matching results first
        sanghs.sort((a, b) => {
            const queryLower = query ? query.toLowerCase() : ''; // Lowercased query for comparison

            // Check if 'a' or 'b' has relevant fields to search
            const aMatch =
                (a.name && a.name.toLowerCase().includes(queryLower)) ||
                (a.location && a.location.country && a.location.country.toLowerCase().includes(queryLower)) ||
                (a.location && a.location.state && a.location.state.toLowerCase().includes(queryLower)) ||
                (a.location && a.location.district && a.location.district.toLowerCase().includes(queryLower)) ||
                (a.location && a.location.city && a.location.city.toLowerCase().includes(queryLower)) ||
                (a.location && a.location.area && a.location.area.toLowerCase().includes(queryLower));

            const bMatch =
                (b.name && b.name.toLowerCase().includes(queryLower)) ||
                (b.location && b.location.country && b.location.country.toLowerCase().includes(queryLower)) ||
                (b.location && b.location.state && b.location.state.toLowerCase().includes(queryLower)) ||
                (b.location && b.location.district && b.location.district.toLowerCase().includes(queryLower)) ||
                (b.location && b.location.city && b.location.city.toLowerCase().includes(queryLower)) ||
                (b.location && b.location.area && b.location.area.toLowerCase().includes(queryLower));

            // Prioritize matches
            if (aMatch && !bMatch) return -1;
            if (!aMatch && bMatch) return 1;
            return 0;
        });

        return successResponse(res, sanghs, 'All Sangh retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});


const getHierarchy = asyncHandler(async (req, res) => {
    try {
        const sangh = await HierarchicalSangh.findById(req.params.id);
        if (!sangh) {
            return errorResponse(res, 'Sangh not found', 404);
        }

        const hierarchy = await sangh.getHierarchy();

        // Convert URLs in officeBearers
        if (hierarchy?.current?.officeBearers?.length) {
            hierarchy.current.officeBearers = hierarchy.current.officeBearers.map((bearer) => ({
                ...bearer,
                photo: bearer.photo ? convertS3UrlToCDN(bearer.photo) : '',
            }));
        }

        // ✅ Add sanghImage to hierarchy response
        hierarchy.sanghImage = sangh.sanghImage ? convertS3UrlToCDN(sangh.sanghImage) : null;

        return successResponse(res, hierarchy, 'Hierarchy retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});
const updateSanghDetails = async (req, res) => {
  try {
    const { sanghId } = req.params;
    const { name, officeAddress, officeBearers } = req.body;

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) return res.status(404).json({ success: false, message: 'Sangh not found' });

    if (name) sangh.name = name;

    if (officeAddress) {
      sangh.officeAddress = {
        ...sangh.officeAddress,
        ...officeAddress
      };
    }
    if (Array.isArray(officeBearers)) {
      sangh.officeBearers = [];
      for (const ob of officeBearers) {
        if (!ob?.role || !ob?.userId) continue;
      const addr = ob.address || {};
      const bearerData = {
        role: ob.role,
        userId: ob.userId,
        name: ob.name,
        jainAadharNumber: ob.jainAadharNumber,
        mobileNumber: ob.phoneNumber,
        email: ob.email || '',
        userImage: ob.userImage,
        paymentStatus: ob.paymentStatus || 'pending',
        status: 'active',
        description: ob.description || '',
        appointmentDate: new Date(),
        termEndDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
        level: sangh.level,
        sanghType: sangh.sanghType || 'main',
        address: {
          street: ob.address?.street || '',
          city: ob.address?.city || '',
          district: ob.address?.district || '',
          state: ob.address?.state || '',
          pincode: ob.address?.pincode || ''
        }
      };


        // ✅ Update User's sanghRoles as well
        const user = await User.findById(ob.userId);
        if (user) {
          const roleIndex = user.sanghRoles.findIndex(
            (r) => r.sanghId?.toString() === sanghId
          );

          if (roleIndex !== -1) {
            user.sanghRoles[roleIndex].role = ob.role; // ✅ role change: 'member' => 'president' etc.
          } else {
            // if not present, add new
            user.sanghRoles.push({
              sanghId,
              role: ob.role,
              level: sangh.level,
              sanghType: sangh.sanghType || 'main'
            });
          }

          await user.save();
        }

        sangh.officeBearers.push(bearerData);
      }
    }

    await sangh.save();

    return res.json({
      success: true,
      message: 'Sangh updated successfully',
      data: sangh
    });

  } catch (error) {
    console.error("❌ Error updating sangh:", error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const updatePanchMembers = async (req, res) => {
  try {
    const { sanghId } = req.params;
    const { panches } = req.body;

    console.log("📥 Received Panches:", panches);

    if (!Array.isArray(panches)) {
      return res.status(400).json({ success: false, message: 'Panch members must be an array' });
    }

    if (panches.length > 5) {
      return res.status(400).json({ success: false, message: 'Only 5 Panch members allowed' });
    }

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) {
      return res.status(404).json({ success: false, message: 'Sangh not found' });
    }

    sangh.panches = [];

    const addedUserIds = new Set();

    for (const pm of panches) {
      if (!pm.userId || !pm.jainAadharNumber) {
        console.warn("⚠️ Skipping invalid member:", pm);
        continue;
      }

      if (addedUserIds.has(pm.userId)) {
        console.warn("⚠️ Duplicate userId skipped:", pm.userId);
        continue;
      }

      sangh.panches.push({
        userId: pm.userId,
        name: pm.name,
        jainAadharNumber: pm.jainAadharNumber,
        level: pm.level || sangh.level,
        sanghType: pm.sanghType || sangh.sanghType || 'main',
        postMember: pm.postMember || '',
        email: pm.email || '',
        phoneNumber: pm.phoneNumber || '',
        document: pm.document || '',
        userImage: pm.userImage || '',
        address: {
          street: pm.address?.street || '',
          city: pm.address?.city || '',
          district: pm.address?.district || '',
          state: pm.address?.state || '',
          pincode: pm.address?.pincode || '',
        },
        status: 'active',
        paymentStatus: pm.paymentStatus || 'pending',
      });

      addedUserIds.add(pm.userId);

      const user = await User.findById(pm.userId);
      if (user) {
        const roleIndex = user.sanghRoles.findIndex(
          r => r.sanghId?.toString() === sanghId
        );
        if (roleIndex !== -1) {
          user.sanghRoles[roleIndex].role = 'panchMember';
        } else {
          user.sanghRoles.push({
            sanghId,
            role: 'panch',
            level: sangh.level,
            sanghType: sangh.sanghType || 'main',
          });
        }
        await user.save();
      }
    }

    await sangh.save();

    return res.json({
      success: true,
      message: 'Panch members updated successfully',
      data: sangh.panches,
    });

  } catch (error) {
    console.error("❌ Error updating panch members:", error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


// Get Sanghs by level and location
const getSanghsByLevelAndLocation = asyncHandler(async (req, res) => {
    try {
        const { level, country, state, district, city, page = 1, limit = 10 } = req.query;
        const query = { status: 'active' };
        if (level) query.level = level;
        if (country) query['location.country'] = country;
        if (state) query['location.state'] = state;
        if (district) query['location.district'] = district;
        if (city) query['location.city'] = city;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sanghs = await HierarchicalSangh.find(query)
            .populate('parentSangh', 'name level location')
            .populate('officeBearers.userId', 'name email phoneNumber')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const total = await HierarchicalSangh.countDocuments(query);
        return successResponse(res, {
            sanghs,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit))
            }
        }, 'Sanghs retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});

// Get child Sanghs
const getChildSanghs = asyncHandler(async (req, res) => {
    try {
        const sangh = await HierarchicalSangh.findById(req.params.id);
        if (!sangh) {
            return errorResponse(res, 'Sangh not found', 404);
        }
        const children = await sangh.getChildSanghs();
        return successResponse(res, children, 'Child Sanghs retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});
const updateSanghById = asyncHandler(async (req, res) => {
  const sanghId = req.params.id;

  try {
    const existingSangh = await HierarchicalSangh.findById(sanghId);
    if (!existingSangh) {
      return errorResponse(res, 'Sangh not found', 404);
    }
    // ✅ Optional uploaded images
    const coverImage =
      req.files?.coverImage && req.files.coverImage.length > 0
        ? convertS3UrlToCDN(req.files.coverImage[0].location)
        : existingSangh.coverImage;

    const sanghImage =
      req.files?.sanghImage && req.files.sanghImage.length > 0
        ? convertS3UrlToCDN(req.files.sanghImage[0].location)
        : existingSangh.sanghImage;

    // ✅ Fields to update
    const fieldsToUpdate = {
      name: req.body.name ?? existingSangh.name,
      description: req.body.description ?? existingSangh.description,
      contact: req.body.contact ?? existingSangh.contact,
      socialMedia: req.body.socialMedia ?? existingSangh.socialMedia,
      coverImage,
      sanghImage,
    };

    const updatedSangh = await HierarchicalSangh.findByIdAndUpdate(
      sanghId,
      { $set: fieldsToUpdate },
      { new: true }
    );

    return successResponse(res, updatedSangh, 'Sangh updated successfully');
  } catch (error) {
    if (req.files) {
      await deleteS3Files(req.files); // Optional cleanup
    }
    return errorResponse(res, error.message || 'Something went wrong', 500);
  }
});

// Update Sangh
const updateHierarchicalSangh = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { role, name, mobileNumber, address, pinCode, paymentStatus } = req.body;

    if (!role) return errorResponse(res, 'Role is required', 400);

    const sangh = await HierarchicalSangh.findById(id);
    if (!sangh) return errorResponse(res, 'Sangh not found', 404);

    // Only current user's role allowed
    const userRole = req.user.sanghRoles.find(r =>
      r.sanghId.toString() === id &&
      r.role === role
    );

    if (!userRole && req.user.role !== 'superadmin') {
      return errorResponse(res, 'Not authorized to update this Sangh', 403);
    }

    // Build update fields
    const updateFields = {};
    if (name) updateFields['officeBearers.$[elemTarget].name'] = name;
    if (mobileNumber) updateFields['officeBearers.$[elemTarget].mobileNumber'] = mobileNumber;
    if (address) updateFields['officeBearers.$[elemTarget].address'] = address;
    if (pinCode) updateFields['officeBearers.$[elemTarget].pinCode'] = pinCode;
    if (paymentStatus) updateFields['officeBearers.$[elemTarget].paymentStatus'] = paymentStatus;
    if (req.body.description) updateFields['officeBearers.$[elemTarget].description'] = req.body.description;
    if (req.files?.[`${role}Photo`]) {
      const photo = convertS3UrlToCDN(req.files[`${role}Photo`][0].location);
      updateFields['officeBearers.$[elemTarget].photo'] = photo;
    }

    // if (req.files?.[`${role}JainAadhar`]) {
    //   const document = convertS3UrlToCDN(req.files[`${role}JainAadhar`][0].location);
    //   updateFields['officeBearers.$[elemTarget].document'] = document;
    // }

    const updated = await HierarchicalSangh.findByIdAndUpdate(
      id,
      { $set: updateFields },
      {
        new: true,
        runValidators: true,
        arrayFilters: [{ 'elemTarget.role': role }],
      }
    ).populate('officeBearers.userId', 'name email phoneNumber');

    return successResponse(res, updated, 'Updated successfully');
  } catch (error) {
    console.error(error);
    return errorResponse(res, error.message, 500);
  }
});


// Helper function to delete S3 file
const deleteS3File = async (fileUrl) => {
    try {
        const key = extractS3KeyFromUrl(fileUrl);
        if (key) {
            const deleteParams = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: key
            };
            await s3Client.send(new DeleteObjectCommand(deleteParams));
        }
    } catch (error) {
        console.error(`Error deleting file from S3: ${fileUrl}`, error);
    }
};

// Helper function to delete multiple S3 files
const deleteS3Files = async (files) => {
    const deletePromises = [];
    for (const [role, roleFiles] of Object.entries(files)) {
        if (Array.isArray(roleFiles)) {
            roleFiles.forEach(file => {
                if (file.location) {
                    deletePromises.push(deleteS3File(file.location));
                }
            });
        }
    }
    await Promise.all(deletePromises);
};

// Check office bearer terms
const checkOfficeBearerTerms = asyncHandler(async (req, res) => {
    try {
        const { sanghId } = req.params;

        const sangh = await HierarchicalSangh.findById(sanghId);
        if (!sangh) {
            return errorResponse(res, 'Sangh not found', 404);
        }

        const currentDate = new Date();
        const expiredBearers = sangh.officeBearers.filter(bearer => 
            bearer.status === 'active' && bearer.termEndDate < currentDate
        );

        if (expiredBearers.length > 0) {
            // Mark expired bearers as inactive
            await HierarchicalSangh.updateOne(
                { _id: sanghId },
                { 
                    $set: {
                        'officeBearers.$[elem].status': 'inactive'
                    }
                },
                {
                    arrayFilters: [{ 
                        'elem.status': 'active',
                        'elem.termEndDate': { $lt: currentDate }
                    }]
                }
            );

            return successResponse(res, {
                message: 'Office bearer terms checked',
                expiredBearers: expiredBearers.map(b => ({
                    role: b.role,
                    name: b.name,
                    termEndDate: b.termEndDate
                }))
            });
        }

        return successResponse(res, {
            message: 'No expired terms found'
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});
const getUserByJainAadhar = asyncHandler(async (req, res) => {
   const { aadharNumber } = req.params;

  const user = await User.findOne({
    jainAadharNumber: aadharNumber,
    jainAadharStatus: 'verified',
  }).select('email phoneNumber gender fullName location');

  if (!user) {
    return res.status(404).json({ message: 'User not found or unverified' });
  }

  return res.status(200).json(user);
});


// Add member(s) to Sangh
const addSanghMember = asyncHandler(async (req, res) => {
  try {
    const sanghId = req.params.sanghId;
    const MAX_BULK_MEMBERS = 50;

     const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) return errorResponse(res, 'Sangh not found', 404);

    const isBulk = req.body.members && Array.isArray(req.body.members);

    if (isBulk) {
      const { members } = req.body;
      if (members.length === 0)
        return errorResponse(res, 'Members array cannot be empty', 400);

      if (members.length > MAX_BULK_MEMBERS)
        return errorResponse(res, `Cannot add more than ${MAX_BULK_MEMBERS} members at once`, 400);

      const results = { success: [], failed: [] };

      for (const member of members) {
        if (!member.jainAadharNumber) {
          results.failed.push({ jainAadharNumber: 'unknown', reason: 'Missing Jain Aadhar number' });
          continue;
        }

        try {
          const user = await User.findOne({
            jainAadharNumber: member.jainAadharNumber,
            jainAadharStatus: 'verified'
          }).populate('jainAadharApplication');

          if (!user) {
            results.failed.push({
              jainAadharNumber: member.jainAadharNumber,
              reason: 'Invalid or unverified Jain Aadhar number'
            });
            continue;
          }

          if (sangh.members.some(m => m.jainAadharNumber === member.jainAadharNumber)) {
            results.failed.push({
              jainAadharNumber: member.jainAadharNumber,
              reason: 'Already a member'
            });
            continue;
          }

          const location = user?.jainAadharApplication?.location || {};
          const contact = user?.jainAadharApplication?.contactDetails || {};
         const rawImage =
            (req.file?.location || req.file?.path) ||
            user?.jainAadharApplication?.photo ||
            user?.profileImage || '';

            const userImage = rawImage ? convertS3UrlToCDN(rawImage) : '';
          const newMember = {
            userId: user._id,
            name: user?.jainAadharApplication?.name || 'Unknown',
            jainAadharNumber: member.jainAadharNumber,
            email: contact.email || user.email,
            phoneNumber: contact.number || user.phoneNumber,
            postMember: member.postMember || '',
            userImage,
            address: {
              street: location.address || '',
              city: location.city || '',
              district: location.district || '',
              state: location.state || '',
              pincode: location.pinCode || ''
            },
            addedBy: req.user._id,
            addedAt: new Date(),
            status: 'Inactive',
            localSangh: member.localSangh?.sanghId ? {
            state: member.localSangh.state || '',
            district: member.localSangh.district || '',
            sanghId: member.localSangh.sanghId,
            name: member.localSangh.name || ''
          } : undefined
          };

          sangh.members.push(newMember);
          results.success.push({ jainAadharNumber: member.jainAadharNumber, name: newMember.name });

          await User.findByIdAndUpdate(user._id, {
            $push: {
              sanghRoles: {
                sanghId: sangh._id,
                role: 'member',
                level: sangh.level,
                sanghType: sangh.sanghType || 'main',
                addedAt: new Date()
              }
            }
          });

        } catch (error) {
          results.failed.push({ jainAadharNumber: member.jainAadharNumber, reason: error.message });
        }
      }

      if (results.success.length > 0) await sangh.save();

      return successResponse(res, {
        sangh: {
          _id: sangh._id,
          name: sangh.name,
          level: sangh.level,
          totalMembers: sangh.members.length
        },
        results
      }, `Added ${results.success.length} members, ${results.failed.length} failed`);
    }

    // ======= SINGLE MEMBER ADDITION =======
    const { jainAadharNumber, postMember,level, sanghType } = req.body;

    // ✅ Parse localSangh if needed
    if (req.body.localSangh && typeof req.body.localSangh === 'string') {
      try {
        req.body.localSangh = JSON.parse(req.body.localSangh);
      } catch (err) {
        console.error('❌ Error parsing localSangh:', err.message);
        req.body.localSangh = undefined;
      }
    }

    if (!jainAadharNumber) return errorResponse(res, 'Jain Aadhar number is required', 400);

    const user = await User.findOne({
      jainAadharNumber,
      jainAadharStatus: 'verified'
    }).populate('jainAadharApplication');

    if (!user) return errorResponse(res, 'Invalid or unverified Jain Aadhar number', 400);

    if (sangh.members.some(m => m.jainAadharNumber === jainAadharNumber))
      return errorResponse(res, 'Already a member of this Sangh', 400);

    const location = user?.jainAadharApplication?.location || {};
    const contact = user?.jainAadharApplication?.contactDetails || {};
    const rawImage =
    (req.file?.location || req.file?.path) ||
    user?.jainAadharApplication?.photo ||
    user?.profileImage || '';
    const paidRecord = await SanghPayment.findOne({
      memberId: user._id,
      sanghId: sangh._id,
      status: 'paid'
    });
    const userImage = rawImage ? convertS3UrlToCDN(rawImage) : '';
    const newMember = {
      userId: user._id,
      name: user?.jainAadharApplication?.name || 'Unknown',
      jainAadharNumber,
      email: contact.email || user.email,
      phoneNumber: contact.number || user.phoneNumber,
      postMember: postMember || '',
      level: level || '',
      sanghType: sanghType || 'main',
      userImage,
      address: {
        street: location.address || '',
        city: location.city || '',
        district: location.district || '',
        state: location.state || '',
        pincode: location.pinCode || ''
      },
      paymentStatus: paidRecord ? 'paid' : 'pending',
      localSangh: req.body.localSangh?.sanghId ? {
            state: req.body.localSangh.state || '',
            district: req.body.localSangh.district || '',
            sanghId: req.body.localSangh.sanghId,
            name: req.body.localSangh.name || ''
          } : undefined,
      addedBy: req.user._id,
      addedAt: new Date(),
      status: 'inactive',
    };

    sangh.members.push(newMember);

    await User.findByIdAndUpdate(user._id, {
      $push: {
        sanghRoles: {
          sanghId: sangh._id,
          role: 'member',
          level: sangh.level,
          sanghType: sangh.sanghType || 'main',
          addedAt: new Date()
        }
      }
    });

    await sangh.save();

    return successResponse(res, {
      member: newMember,
      sangh: {
        _id: sangh._id,
        name: sangh.name,
        level: sangh.level,
        totalMembers: sangh.members.length
      }
    }, 'Member added successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});



// Remove member from Sangh
const removeSanghMember = asyncHandler(async (req, res) => {
    try {
        const { sanghId, memberId } = req.params;
        const sangh = await HierarchicalSangh.findById(sanghId);
        if (!sangh) {
            return errorResponse(res, 'Sangh not found', 404);
        }
        // For city Sanghs, maintain minimum 3 members
        if (sangh.level === 'city' && sangh.members.length <= 3) {
            return errorResponse(res, 'City Sangh must maintain at least 3 members', 400);
        }
        const memberToRemove = sangh.members.find(
            member => member._id.toString() === memberId
        );
        if (!memberToRemove) {
            return errorResponse(res, 'Member not found', 404);
        }
        // Remove member's role from User document
        await User.findByIdAndUpdate(memberToRemove.userId, {
            $pull: {
                sanghRoles: {
                    sanghId: sangh._id
                }
            }
        });
        sangh.members = sangh.members.filter(
            member => member._id.toString() !== memberId
        );
        await sangh.save();
        return successResponse(res, sangh, 'Member removed successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});

// // Update member details
// const updateMemberDetails = asyncHandler(async (req, res) => {
//     try {
//         const { sanghId, memberId } = req.params;
//         const updates = req.body;

//         const sangh = await HierarchicalSangh.findById(sanghId);
//         if (!sangh) {
//             return errorResponse(res, 'Sangh not found', 404);
//         }

//         const memberIndex = sangh.members.findIndex(
//             member => member._id.toString() === memberId
//         );

//         if (memberIndex === -1) {
//             return errorResponse(res, 'Member not found', 404);
//         }

//         // Handle document updates if files are provided
//         if (req.files) {
//             if (req.files['memberPhoto']) {
//                 // Delete old photo if exists
//                 if (sangh.members[memberIndex].photo) {
//                     await deleteS3File(sangh.members[memberIndex].photo);
//                 }
//                 updates.photo = req.files['memberPhoto'][0].location;
//             }
//         }

//         // Update member details
//         Object.assign(sangh.members[memberIndex], {
//             ...sangh.members[memberIndex].toObject(),
//             ...updates,
//             name: updates.firstName && updates.lastName ? 
//                 formatFullName(updates.firstName, updates.lastName) : 
//                 sangh.members[memberIndex].name
//         });

//         await sangh.save();
//         return successResponse(res, sangh, 'Member details updated successfully');
//     } catch (error) {
//         if (req.files) {
//             await deleteS3Files(req.files);
//         }
//         return errorResponse(res, error.message, 500);
//     }
// });

// Update member details

const updateMemberDetails = asyncHandler(async (req, res) => {
  try {
    const { sanghId, memberId } = req.params;
    const updates = req.body;

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) {
      return errorResponse(res, 'Sangh not found', 404);
    }

    const memberIndex = sangh.members.findIndex(
      (member) => member._id.toString() === memberId
    );

    if (memberIndex === -1) {
      return errorResponse(res, 'Member not found', 404);
    }

    // ===  Handle photo update with CDN conversion ===
    if (req.files && req.files['memberPhoto']) {
      if (sangh.members[memberIndex].userImage) {
        await deleteS3File(sangh.members[memberIndex].userImage);
      }

      const s3Url = req.files['memberPhoto'][0].location;
      updates.userImage = convertS3UrlToCDN(s3Url);
    }

    // === Update address fields ===
    sangh.members[memberIndex].address = {
      ...sangh.members[memberIndex].address,
      street: updates.street || sangh.members[memberIndex].address?.street,
      district: updates.district || sangh.members[memberIndex].address?.district,
      state: updates.state || sangh.members[memberIndex].address?.state,
      pincode: updates.pincode || sangh.members[memberIndex].address?.pincode,
    };

    // ===  Update main fields ===
    Object.assign(sangh.members[memberIndex], {
      ...sangh.members[memberIndex].toObject(),
      ...updates,
      name: updates.name || sangh.members[memberIndex].name,
    });

    await sangh.save();
    return successResponse(res, sangh, 'Member details updated successfully');
  } catch (error) {
    if (req.files) {
      await deleteS3Files(req.files);
    }
    return errorResponse(res, error.message, 500);
  }
});

// Get Sangh members
const getSanghMembers = asyncHandler(async (req, res) => {
    try {
        const { sanghId } = req.params;
        const { page = 1, limit = 10, search } = req.query;

        const sangh = await HierarchicalSangh.findById(sanghId)
            .populate({
                path: 'members.userId',
                select: 'email phoneNumber'
            });

        if (!sangh) {
            return errorResponse(res, 'Sangh not found', 404);
        }

        let members = sangh.members || [];

        // Apply search filter if provided
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            members = members.filter(member => 
                searchRegex.test(member.name) || 
                searchRegex.test(member.jainAadharNumber)
            );
        }

        // Apply pagination
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = parseInt(page) * parseInt(limit);
        const total = members.length;

        const paginatedMembers = members.slice(startIndex, endIndex);

        return successResponse(res, {
            members: paginatedMembers,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / parseInt(limit))
            }
        }, 'Members retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});

const addMultipleSanghMembers = asyncHandler(async (req, res) => {
    return addSanghMember(req, res);
});
// Create specialized Sangh (Women/Youth)
const createSpecializedSangh = asyncHandler(async (req, res) => {
    try {
        const parentSangh = req.parentSangh; // From canCreateSpecializedSangh middleware
        const {
            name,
            sanghType,
            level,
            officeBearers,
            description,
            contact,
            socialMedia
        } = req.body;
        console.log("Received Body:", req.body);
        console.log("SanghType:", req.body.sanghType);
        // Validate sanghType
if (!sanghType) {
    return errorResponse(res, 'Sangh type is required.', 400);
}
        // Validate sanghType
        if (!['women', 'youth'].includes(sanghType)) {
            return errorResponse(res, 'Invalid Sangh type. Must be "women" or "youth"', 400);
        }

        // If creating from a specialized Sangh, ensure the types match
if (parentSangh) {
    if (parentSangh.sanghType !== 'main' && parentSangh.sanghType !== sanghType) {
        return errorResponse(
            res,
            `You can only create a ${parentSangh.sanghType} Sangh as a ${parentSangh.sanghType} Sangh president`,
            400
        );
    }
}

// Determine the parent main Sangh
let parentMainSanghId = null;
if (parentSangh) {
    if (parentSangh.sanghType === 'main') {
        parentMainSanghId = parentSangh._id;
    } else {
        // If parent is already a specialized Sangh, use its parentMainSangh
        parentMainSanghId = parentSangh.parentMainSangh;
    }
}
        // Check if a specialized Sangh of this type already exists at this level
        let locationQuery = {};
        
        // Build location query based on the level
        if (level === 'state') {
            locationQuery = { 'location.state': req.body.location.state };
        } else if (level === 'district') {
            locationQuery = { 
                'location.state': req.body.location.state,
                'location.district': req.body.location.district 
            };
        } else if (level === 'city') {
            locationQuery = { 
                'location.state': req.body.location.state,
                'location.district': req.body.location.district,
                'location.city': req.body.location.city 
            };
        } else if (level === 'area') {
            locationQuery = { 
                'location.state': req.body.location.state,
                'location.district': req.body.location.district,
                'location.city': req.body.location.city,
                'location.area': req.body.location.area 
            };
        }
        
        const existingSpecializedSangh = await HierarchicalSangh.findOne({
            level: level,
            ...locationQuery,
            sanghType: sanghType,
            status: 'active'
        });

        if (existingSpecializedSangh) {
            return errorResponse(res, `A ${sanghType} Sangh already exists at this ${level} level in this location`, 400);
        }

        // Validate office bearers
        if (!officeBearers || !officeBearers.president || !officeBearers.secretary || !officeBearers.treasurer) {
            return errorResponse(res, 'All office bearer details are required', 400);
        }

        // Format office bearers data
        const formattedOfficeBearers = [];
        for (const role of ['president', 'secretary', 'treasurer']) {
            const bearer = officeBearers[role];   
            // Find the user by Jain Aadhar
            const user = await User.findOne({
                jainAadharNumber: bearer.jainAadharNumber,
                jainAadharStatus: 'verified'
            });

            if (!user) {
                return errorResponse(res, `${role}'s Jain Aadhar is not verified`, 400);
            }

            // Check if user is already an office bearer in another active Sangh
            const existingSangh = await HierarchicalSangh.findOne({
                'officeBearers': {
                    $elemMatch: {
                        'userId': user._id,
                        'status': 'active'
                    }
                },
                'status': 'active',
                   ...(parentSangh ? { '_id': { $ne: parentSangh._id } } : {}) 
            });
            if (existingSangh) {
                return errorResponse(res, `${role} is already an office bearer in another Sangh`, 400);
            }

            // Format the name
            const formattedName = formatFullName(bearer.firstName, bearer.lastName);
            const documentUrl = bearer.document ? convertS3UrlToCDN(bearer.document) : '';
            const photoUrl = bearer.photo ? convertS3UrlToCDN(bearer.photo) : '';
            // Add to formatted office bearers
            formattedOfficeBearers.push({
                role: role,
                userId: user._id,
                firstName: bearer.firstName,
                lastName: bearer.lastName,
                name: formattedName,
                mobileNumber: bearer.mobileNumber,
                jainAadharNumber: bearer.jainAadharNumber,
                address: bearer.address,
                pinCode: bearer.pinCode,
                document: documentUrl,
                photo: photoUrl,
                appointmentDate: new Date(),
                termEndDate: new Date(Date.now() + (2 * 365 * 24 * 60 * 60 * 1000)), // 2 years from now
                status: 'active'
            });
        }

        // Create the specialized Sangh
        const specializedSangh = new HierarchicalSangh({
            name,
            level: level, // Same level as parent Sangh
            location: req.body.location, // Same location as parent Sangh
            parentSangh: level === 'country' ? null : parentSangh._id, // Country level Sanghs don't have parent
            parentMainSangh: level === 'country' ? null : parentMainSanghId, // Country level Sanghs don't have parent
            sanghType: sanghType,
            officeBearers: formattedOfficeBearers,
            description,
            contact,
            socialMedia,
            createdBy: req.user._id
        });

        await specializedSangh.save();

        // Update the sanghRoles for each office bearer
        for (const officeBearer of formattedOfficeBearers) {
            await User.findByIdAndUpdate(officeBearer.userId, {
                $push: {
                    sanghRoles: {
                        sanghId: specializedSangh._id,
                        role: officeBearer.role,
                        level: specializedSangh.level,
                        sanghType: sanghType,
                        addedAt: new Date()
                    }
                }
            });
        }

        return successResponse(res, {
            message: `${sanghType.charAt(0).toUpperCase() + sanghType.slice(1)} Sangh created successfully`,
            sangh: specializedSangh
        });
    } catch (error) {
    console.error("Error in createSpecializedSangh:", error);
    if (req.files) {
        await deleteS3Files(req.files);
    }
    return errorResponse(res, error.message || "Something went wrong", 500);
}

});

// Get specialized Sanghs for a main Sangh
const getSpecializedSanghs = asyncHandler(async (req, res) => {
    try {
        const { sanghId } = req.params;

        // Verify the Sangh exists and is a main Sangh
        const mainSangh = await HierarchicalSangh.findOne({
            _id: sanghId,
            sanghType: 'main',
            status: 'active'
        });

        if (!mainSangh) {
            return errorResponse(res, 'Main Sangh not found', 404);
        }

        // Find specialized Sanghs
        const specializedSanghs = await HierarchicalSangh.find({
            parentMainSangh: sanghId,
            status: 'active'
        }).select('-__v');

        // Convert S3 files (if needed) for each specialized Sangh
        const convertedSanghs = await Promise.all(specializedSanghs.map(async (sangh) => {
            const convertedOfficeBearers = await Promise.all(sangh.officeBearers.map(async (bearer) => {
                if (bearer.document && bearer.document.startsWith('https://')) {
                    // Replace S3 link with a converted one if necessary
                    bearer.document = await convertS3File(bearer.document);
                }
                if (bearer.photo && bearer.photo.startsWith('https://')) {
                    // Replace S3 link with a converted one if necessary
                    bearer.photo = await convertS3File(bearer.photo);
                }
                return bearer;
            }));

            // Return the updated sangh object with converted office bearers
            return { ...sangh.toObject(), officeBearers: convertedOfficeBearers };
        }));

        return successResponse(res, {
            mainSangh: {
                _id: mainSangh._id,
                name: mainSangh.name,
                level: mainSangh.level,
                location: mainSangh.location
            },
            specializedSanghs: convertedSanghs
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
});


// Update specialized Sangh
const updateSpecializedSangh = asyncHandler(async (req, res) => {
    try {
        const sangh = req.sangh; // From canManageSpecializedSangh middleware
        const {
            name,
            description,
            contact,
            socialMedia,
            officeBearers
        } = req.body;

        // Create an updates object
        const updates = {};
        
        // Basic info updates
        if (name) updates.name = name;
        if (description) updates.description = description;
        if (contact) updates.contact = contact;
        if (socialMedia) updates.socialMedia = socialMedia;

        // Handle office bearer updates if provided
        if (officeBearers) {
            for (const role of ['president', 'secretary', 'treasurer']) {
                if (officeBearers[role]) {
                    const bearer = officeBearers[role];
                    const currentBearer = sangh.officeBearers.find(b => b.role === role);
                    // If changing the office bearer
                    if (bearer.jainAadharNumber && bearer.jainAadharNumber !== currentBearer.jainAadharNumber) {
                        // Find the user by Jain Aadhar
                        const user = await User.findOne({
                            jainAadharNumber: bearer.jainAadharNumber,
                            jainAadharStatus: 'verified'
                        });

                        if (!user) {
                            return errorResponse(res, `${role}'s Jain Aadhar is not verified`, 400);
                        }

                        // Check if user is already an office bearer in another active Sangh
                        const existingSangh = await HierarchicalSangh.findOne({
                            'officeBearers': {
                                $elemMatch: {
                                    'userId': user._id,
                                    'status': 'active'
                                }
                            },
                            'status': 'active',
                            '_id': { $ne: sangh._id }
                        });

                        if (existingSangh) {
                            return errorResponse(res, `${role} is already an office bearer in another Sangh`, 400);
                        }

                        // Format the name
                        const formattedName = formatFullName(bearer.firstName, bearer.lastName);

                        // Remove role from current office bearer's sanghRoles
                        if (currentBearer) {
                            await User.findByIdAndUpdate(currentBearer.userId, {
                                $pull: {
                                    sanghRoles: {
                                        sanghId: sangh._id,
                                        role: role
                                    }
                                }
                            });
                        }

                        // Add role to new office bearer's sanghRoles
                        await User.findByIdAndUpdate(user._id, {
                            $push: {
                                sanghRoles: {
                                    sanghId: sangh._id,
                                    role: role,
                                    level: sangh.level,
                                    sanghType: sangh.sanghType,
                                    addedAt: new Date()
                                }
                            }
                        });

                        // Update the office bearer in the Sangh
                        await HierarchicalSangh.updateOne(
                            { 
                                _id: sangh._id,
                                'officeBearers.role': role
                            },
                            {
                                $set: {
                                    'officeBearers.$.userId': user._id,
                                    'officeBearers.$.firstName': bearer.firstName,
                                    'officeBearers.$.lastName': bearer.lastName,
                                    'officeBearers.$.name': formattedName,
                                    'officeBearers.$.jainAadharNumber': bearer.jainAadharNumber,
                                    'officeBearers.$.appointmentDate': new Date(),
                                    'officeBearers.$.termEndDate': new Date(Date.now() + (2 * 365 * 24 * 60 * 60 * 1000)) // 2 years from now
                                }
                            }
                        );
                    } else {
                        // Just update the existing office bearer's details
                        if (bearer.firstName || bearer.lastName) {
                            const firstName = bearer.firstName || currentBearer.firstName;
                            const lastName = bearer.lastName || currentBearer.lastName;
                            const formattedName = formatFullName(firstName, lastName);
                            
                            await HierarchicalSangh.updateOne(
                                { 
                                    _id: sangh._id,
                                    'officeBearers.role': role
                                },
                                {
                                    $set: {
                                        'officeBearers.$.firstName': firstName,
                                        'officeBearers.$.lastName': lastName,
                                        'officeBearers.$.name': formattedName
                                    }
                                }
                            );
                        }
                    }

                    // Handle document uploads
                    if (req.files && req.files[`${role}JainAadhar`]) {
                        // Delete old document if it exists
                        if (currentBearer && currentBearer.document) {
                            await deleteS3File(currentBearer.document);
                        }
                        
                        await HierarchicalSangh.updateOne(
                            { 
                                _id: sangh._id,
                                'officeBearers.role': role
                            },
                            {
                                $set: {
                                    'officeBearers.$.document': req.files[`${role}JainAadhar`][0].location
                                }
                            }
                        );
                    }

                    // Handle photo uploads
                    if (req.files && req.files[`${role}Photo`]) {
                        // Delete old photo if it exists
                        if (currentBearer && currentBearer.photo) {
                            await deleteS3File(currentBearer.photo);
                        }
                        
                        await HierarchicalSangh.updateOne(
                            { 
                                _id: sangh._id,
                                'officeBearers.role': role
                            },
                            {
                                $set: {
                                    'officeBearers.$.photo': req.files[`${role}Photo`][0].location
                                }
                            }
                        );
                    }
                }
            }
        }

        // Get the updated Sangh
        const updatedSangh = await HierarchicalSangh.findById(sangh._id);

        return successResponse(res, {
            message: 'Specialized Sangh updated successfully',
            sangh: updatedSangh
        });
    } catch (error) {
        if (req.files) {
            await deleteS3Files(req.files);
        }
        return errorResponse(res, error.message, 500);
    }
});
const generateMemberCard = async (req, res) => {
  try {
    const { userId } = req.params;

    // 1. Find sangh with user
    const sangh = await HierarchicalSangh.findOne({
      $or: [
        { 'members.userId': userId }
      ]
    });

    if (!sangh) return res.status(404).json({ message: 'User not found in any sangh.' });

    // 2. Extract user from sangh
    const user = sangh.members.find(m => m.userId.toString() === userId);

    if (!user) return res.status(404).json({ message: 'User data not found.' });
     function getRandomThreeDigitNumber() {
      return Math.floor(100 + Math.random() * 900);
    }

    const level = sangh.level || 'unknown'; // level from sangh document
    const randomNum = getRandomThreeDigitNumber();

    const membershipNumber = `${level}/00${randomNum.toString().padStart(3, '0')}`;

    // 3. Set canvas dimensions (same for both sides)
    const width = 1011;
    const height = 639;
    const combinedCanvas = createCanvas(width, height * 2);
    const ctx = combinedCanvas.getContext('2d');

    // 4. Load templates
    const frontTemplate = await loadImage(path.join(__dirname, '../../Public/member_front.jpg'));
    const backTemplate = await loadImage(path.join(__dirname, '../../Public/member_back.jpg'));

    // === FRONT ===
    ctx.drawImage(frontTemplate, 0, 0, width, height);
    if (user.userImage) {
      try {
        const response = await axios.get(user.userImage, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data, 'binary');
        const userPhoto = await loadImage(imageBuffer);
        ctx.drawImage(userPhoto, 65, 180, 220, 260);
      } catch (err) {
        console.error('Error loading user photo:', err);
      }
    }

    ctx.fillStyle = 'black';
    ctx.font = '26px Georgia';
    ctx.fillText(`${user.name || ''}`, 570, 196);
    ctx.fillText(`${membershipNumber}`, 570, 260);
    ctx.fillText(`${user.postMember || ''}`, 570, 320);  
    if (user.jainAadharNumber) ctx.fillText(`${user.jainAadharNumber}`, 570, 379);
// Bottom center text: Created By
function getRandomFourDigitNumber() {
  return Math.floor(1000 + Math.random() * 9000);
}
const createdByText = `Created By: ${sangh.level || 'unknown'}/JA${getRandomFourDigitNumber()}`;

// Bold font and center alignment
ctx.font = 'bold 28px Georgia';
ctx.textAlign = 'center';
ctx.fillStyle = 'black';

// Adjust vertical position slightly higher (e.g., 70px from bottom)
ctx.fillText(createdByText, width / 2, height - 90);
// === BACK ===
ctx.drawImage(backTemplate, 0, height, width, height);

ctx.font = '26px Georgia';
ctx.fillStyle = 'black';

const addr = user.address || {};
const line1 = `${addr.street || ''}, ${addr.state || ''}`;
const line2 = `${addr.district || ''}, ${addr.pincode || ''}`;

ctx.fillText(line1, 320, height + 182);
ctx.fillText(line2, 320, height + 220);
    // === RESPONSE ===
    res.setHeader('Content-Type', 'image/jpeg');
    combinedCanvas.createJPEGStream().pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to generate member card', error: err.message });
  }
};
const generateMembersCard = async (req, res) => {
  try {
    const { userId } = req.params;

    const sangh = await HierarchicalSangh.findOne({
      'members.userId': userId
    });

    if (!sangh) return res.status(404).json({ message: 'User not found in any sangh members.' });

    const user = sangh.members.find(m => m.userId.toString() === userId);
    if (!user) return res.status(404).json({ message: 'Member data not found.' });

    // Generate 3-digit membership number
    function getRandomThreeDigitNumber() {
      return Math.floor(100 + Math.random() * 900);
    }
    const level = sangh.level || 'unknown';
    const randomNum = getRandomThreeDigitNumber();
    const membershipNumber = `${level}/00${randomNum.toString().padStart(3, '0')}`;

    // Canvas setup
    const width = 1011;
    const height = 639;
    const combinedCanvas = createCanvas(width, height * 2);
    const ctx = combinedCanvas.getContext('2d');

    const frontTemplate = await loadImage(path.join(__dirname, '../../Public/member_front.jpg'));
    const backTemplate = await loadImage(path.join(__dirname, '../../Public/member_back.jpg'));

    // === FRONT ===
    ctx.drawImage(frontTemplate, 0, 0, width, height);

    // Load photo
    if (user.photo) {
      try {
        const response = await axios.get(user.photo, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data, 'binary');
        const userPhoto = await loadImage(imageBuffer);
        ctx.drawImage(userPhoto, 65, 180, 220, 260);
      } catch (err) {
        console.error('Error loading user photo:', err);
      }
    }

    ctx.fillStyle = 'black';
    ctx.font = '26px Georgia';
    ctx.textAlign = 'left';
    ctx.fillText(`${user.firstName || ''} ${user.lastName || ''}`, 570, 196);
    ctx.fillText(`${membershipNumber}`, 570, 260);
    ctx.fillText(`${user.postMember}`, 570, 317); // Designation
    if (user.jainAadharNumber) ctx.fillText(`${user.jainAadharNumber}`, 570, 380);

    // Created By - bottom center
    function getRandomFourDigitNumber() {
      return Math.floor(1000 + Math.random() * 9000);
    }
    const createdByText = `Created By: ${level}/JA${getRandomFourDigitNumber()}`;

    ctx.font = 'bold 28px Georgia';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'black';
    ctx.fillText(createdByText, width / 2, height - 90);

    // === BACK ===
    ctx.drawImage(backTemplate, 0, height, width, height);
    ctx.font = '26px Georgia';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'black';

    // Address handling - CORRECTED VERSION
    console.log('User address:', user.address); // Debug log
    console.log('Address type:', typeof user.address); // Debug log
    
    if (user.address && typeof user.address === 'object') {
      // Make sure it's not an array and has the expected properties
      if (!Array.isArray(user.address) && user.address.street !== undefined) {
        const { street = '', city = '', district = '', state = '', pincode = '' } = user.address;
        
        const addressY = height + 182;
        let currentY = addressY;
        
        // Only show non-empty fields
        if (street && street.toString().trim()) {
          ctx.fillText(`${street}`, 100, currentY);
          currentY += 35;
        }
        
        if (city && city.toString().trim()) {
          ctx.fillText(`${city}`, 100, currentY);
          currentY += 35;
        }
        
        if (pincode && pincode.toString().trim()) {
          ctx.fillText(`${pincode}`, 100, currentY);
        }
      } else {
        console.log('Address object structure is invalid');
        ctx.fillText('Address: Invalid Format', 100, height + 182);
      }
    } else {
      console.log('Address is not an object or is null/undefined');
      ctx.fillText('Address: Not Available', 100, height + 182);
    }

    // Add phone and email if available
    let contactY = height + 350;
    if (user.phoneNumber) {
      ctx.fillText(`Phone: ${user.phoneNumber}`, 100, contactY);
      contactY += 35;
    }
    if (user.email) {
      ctx.fillText(`Email: ${user.email}`, 100, contactY);
    }

    res.setHeader('Content-Type', 'image/jpeg');
    combinedCanvas.createJPEGStream().pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to generate member card', error: err.message });
  }
};

// POST /api/hierarchical-sangh/:sanghId/follow
const followSangh = asyncHandler(async (req, res) => {
  const { sanghId } = req.params;
  const userId = req.user._id;

  const sangh = await HierarchicalSangh.findById(sanghId);
  if (!sangh) {
    return res.status(404).json({ message: 'Sangh not found' });
  }

  if (sangh.followers.includes(userId)) {
    return res.status(400).json({ message: 'Already following' });
  }

  // Add user to sangh's followers
  sangh.followers.push(userId);
  await sangh.save();

  // ✅ ALSO: Add sanghId to user's `followedSanghs` (or `friends` if you insist)
  await User.findByIdAndUpdate(userId, {
    $addToSet: { followedSanghs: sanghId }
  });

  res.status(200).json({
    message: 'Followed successfully',
    followersCount: sangh.followers.length
  });
});

const unfollowSangh = asyncHandler(async (req, res) => {
  const { sanghId } = req.params;
  const userId = req.user._id;

  const sangh = await HierarchicalSangh.findById(sanghId);
  if (!sangh) return res.status(404).json({ message: 'Sangh not found' });

  sangh.followers = sangh.followers.filter(id => id.toString() !== userId.toString());
  await sangh.save();

  res.status(200).json({ message: 'Unfollowed successfully', followersCount: sangh.followers.length });
});

module.exports = {
    createHierarchicalSangh,
    getHierarchy,
    updateSanghById,
    unfollowSangh,
    followSangh,
    updatePanchMembers,
    getUserByJainAadhar,
    getAllSangh,
    getSanghsByLevelAndLocation,
    getChildSanghs,
    updateHierarchicalSangh,
    addSanghMember,
    updateSanghDetails,
    removeSanghMember,
    updateMemberDetails,
    getSanghMembers,
    addMultipleSanghMembers,
    createSpecializedSangh,
    getSpecializedSanghs,
    updateSpecializedSangh,
    checkOfficeBearerTerms,
    getAllSanghs,
    generateMemberCard,
    generateMembersCard,
    switchToSanghToken,
    switchToUserToken
}; 