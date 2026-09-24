const HierarchicalSangh = require("../../model/SanghModels/hierarchicalSanghModel");

const User = require("../../model/UserRegistrationModels/userModel");
const SanghPayment = require("../../model/SanghModels/Payment");
const JainAadharApplication = require("../../model/UserRegistrationModels/jainAadharModel");
const asyncHandler = require("express-async-handler");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { s3Client, DeleteObjectCommand } = require("../../config/s3Config");
const {
  generateSanghToken,
  generateToken,
} = require("../../helpers/authHelpers");
const { extractS3KeyFromUrl } = require("../../utils/s3Utils");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
const { createCanvas, loadImage } = require("canvas");
const path = require("path");
const fs = require("fs");
const { default: axios } = require("axios");
const sharp = require("sharp");
const { toMemberAddress } = require("../../helpers/locationHelper");


// Helper Functions
const formatFullName = (firstName, lastName) => {
  return lastName.toLowerCase() === "jain"
    ? `${firstName} Jain`
    : `${firstName} Jain (${lastName})`;
};

const validateOfficeBearers = async (officeBearers) => {
  for (const role of ["president", "secretary", "treasurer"]) {
    const user = await User.findOne({
      jainAadharNumber: officeBearers[role].jainAadharNumber,
      jainAadharStatus: "verified",
    });
    if (!user) {
      throw new Error(`${role}'s Jain Aadhar is not verified`);
    }
    // Check if user is already an office bearer in another active Sangh
    const existingSangh = await HierarchicalSangh.findOne({
      officeBearers: {
        $elemMatch: {
          userId: user._id,
          status: "active",
        },
      },
      status: "active",
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
    res
      .status(500)
      .json({ message: "Switch to user failed", error: err.message });
  }
});

const switchToSanghToken = asyncHandler(async (req, res) => {
  const { sanghId } = req.body;
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "User not found" });
  const matchedRole = user.sanghRoles.find(
    (role) => role.sanghId.toString() === sanghId.toString(),
  );
  if (!matchedRole) {
    return res
      .status(403)
      .json({ message: "You don't have access to this Sangh" });
  }
  //  Use helper function
  const token = generateSanghToken(user, sanghId);
  return res.status(200).json({ token });
});

// Create new Sangh - FIXED VERSION (Only Line 117 changed)
const createHierarchicalSangh = asyncHandler(async (req, res) => {
  const coverImage = req.files?.coverImage
    ? convertS3UrlToCDN(req.files.coverImage[0].location)
    : null;
  const sanghImage = req.files?.sanghImage
    ? convertS3UrlToCDN(req.files.sanghImage[0].location)
    : null;
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
      sanghType = "main",
    } = req.body;
    // console.log("parentSanghId in request:", req.body);
    // console.log("Received parentSanghId:", req.body.parentSanghId);

    // Validate required fields
    // if (!name || !level || !location || !officeBearers) {
    if (!name || !level || !location || !officeAddress) {
      return errorResponse(res, "Missing required fields", 400);
    }
    // Validate sanghType
    if (!["main", "women", "youth", "veerSena"].includes(sanghType)) {
      return errorResponse(
        res,
        'Invalid Sangh type. Must be "main", "women", or "youth"',
        400,
      );
    }
    // If creating a specialized Sangh, ensure it inherits the type from parent
    let resolvedSanghType = sanghType;
    let parentMainSanghId = null;

    if (parentSanghId) {
      const parentSangh = await HierarchicalSangh.findById(parentSanghId);
      if (!parentSangh) {
        return errorResponse(res, "Parent Sangh not found", 404);
      }

      // If parent is specialized, child must be the same type
      if (parentSangh.sanghType !== "main") {
        resolvedSanghType = parentSangh.sanghType;
      }

      // Track the top-level main Sangh for specialized Sanghs
      if (resolvedSanghType !== "main") {
        parentMainSanghId = parentSangh.parentMainSangh
          ? parentSangh.parentMainSangh
          : parentSangh.sanghType === "main"
            ? parentSangh._id
            : null;
      }
    }
    // Validate location hierarchy based on level
    if (
      level === "area" &&
      (!location.country ||
        !location.state ||
        !location.district ||
        !location.city ||
        !location.area)
    ) {
      return errorResponse(
        res,
        "Area level Sangh requires complete location hierarchy (country, state, district, city, area)",
        400,
      );
    }

    // Additional area-specific validation
    if (level === "area") {
      const existingAreaSangh = await HierarchicalSangh.findOne({
        level: "area",
        "location.country": location.country,
        "location.state": location.state,
        "location.district": location.district,
        "location.city": location.city,
        "location.area": location.area,
        status: "active",
      });
      if (existingAreaSangh) {
        return errorResponse(
          res,
          "An active Sangh already exists for this area",
          400,
        );
      }
    }
    // Validate hierarchy level before creation
    const parentSangh = parentSanghId
      ? await HierarchicalSangh.findById(parentSanghId)
      : null;
    if (parentSangh) {
      const levelHierarchy = [
        "foundation",
        "country",
        "state",
        "district",
        "city",
        "area",
      ];
      const parentIndex = levelHierarchy.indexOf(parentSangh.level);
      const currentIndex = levelHierarchy.indexOf(level);
      const isSameLevelAllowed =
        currentIndex === parentIndex &&
        parentSangh.sanghType === "main" &&
        ["women", "youth", "veerSena"].includes(sanghType);

      if (currentIndex <= parentIndex && !isSameLevelAllowed) {
        return errorResponse(
          res,
          `Invalid hierarchy: ${level} level (${sanghType}) cannot be directly under ${parentSangh.level} (${parentSangh.sanghType})`,
          400,
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
      sanghImage,
    });

    // ✅ ONLY CHANGE: Line 117 - Add safety check for normal users
    // Original: await sangh.validateHierarchy();
    // Fixed: Skip validation if user has no sanghRoles (normal user)
    if (req.user?.sanghRoles && req.user.sanghRoles.length > 0) {
      await sangh.validateHierarchy();
    }

    // Automatically create SanghAccess entry
    const SanghAccess = require("../../model/SanghModels/sanghAccessModel");
    const mongoose = require("mongoose");
    // Check if access already exists
    const existingAccess = await SanghAccess.findOne({
      sanghId: sangh._id,
      status: "active",
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
          status: "active",
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
        parentSanghAccess: resolvedParentSanghAccessId,
      });
      // Update the Sangh with the sanghAccessId
      await HierarchicalSangh.findByIdAndUpdate(sangh._id, {
        sanghAccessId: sanghAccess._id,
      });
      // Update the local sangh object for response
      sangh.sanghAccessId = sanghAccess._id;
      return successResponse(
        res,
        {
          sangh,
          accessId: sangh.accessId,
          sanghAccessId: sanghAccess._id,
          sanghAccessCode: sanghAccess.accessId,
        },
        "Sangh created successfully with access",
        201,
      );
    } else {
      // If access already exists, ensure sanghAccessId is set
      if (!sangh.sanghAccessId) {
        await HierarchicalSangh.findByIdAndUpdate(sangh._id, {
          sanghAccessId: existingAccess._id,
        });
        sangh.sanghAccessId = existingAccess._id;
      }
      return successResponse(
        res,
        {
          sangh,
          accessId: sangh.accessId,
          sanghAccessId: existingAccess._id,
          sanghAccessCode: existingAccess.accessId,
        },
        "Sangh created successfully with existing access",
        201,
      );
    }
  } catch (error) {
    if (req.files) {
      await deleteS3Files(req.files);
    }
    return errorResponse(res, error.message, 500);
  }
});

// Normal admin create sangh
const createAdminSangh = asyncHandler(async (req, res) => {
  const coverImage = req.files?.coverImage
    ? convertS3UrlToCDN(req.files.coverImage[0].location)
    : null;
  const sanghImage = req.files?.sanghImage
    ? convertS3UrlToCDN(req.files.sanghImage[0].location)
    : null;
 
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
      sanghType = "main",
    } = req.body;
 
    // 1️⃣ Validate required fields
    if (!name || !level || !location || !officeAddress) {
      return errorResponse(res, "Missing required fields", 400);
    }
 
    // 2️⃣ Validate Sangh type
    if (!["main", "women", "youth", "veerSena"].includes(sanghType)) {
      return errorResponse(
        res,
        'Invalid Sangh type. Must be "main", "women", "youth", or "veerSena"',
        400,
      );
    }
 
    // 3️⃣ Validate location based on level
    // India me poora chain chahiye (state > district > city).
    // Dusri countries me beech ke levels hote hi nahi -- Country ke neeche
    // seedha City (Local) banta hai, isliye wahan sirf country + city.
    const isIndiaSangh = (location.country || "India") === "India";
 
    const requiredLocationFields = isIndiaSangh
      ? {
          foundation: ["country"],
          // International kisi ek country se bandha nahi hai -- koi location
          // field required nahi.
          international: [],
          country: ["country"],
          state: ["country", "state"],
          district: ["country", "state", "district"],
          city: ["country", "state", "district", "city"],
          area: ["country", "state", "district", "city", "area"],
        }
      : {
          foundation: ["country"],
          international: [],
          country: ["country"],
          state: ["country", "state"],
          district: ["country", "district"],
          city: ["country", "city"],
          area: ["country", "city", "area"],
        };
    const missingFields = requiredLocationFields[level]?.filter(
      (f) => !location[f],
    );
    if (missingFields && missingFields.length > 0) {
      return errorResponse(
        res,
        `Missing location fields: ${missingFields.join(", ")}`,
        400,
      );
    }
 
    // 4️⃣ Validate parent Sangh if provided
    let resolvedSanghType = sanghType;
    let parentMainSanghId = null;
 
    if (parentSanghId) {
      const parentSangh = await HierarchicalSangh.findById(parentSanghId);
      if (!parentSangh) {
        return errorResponse(res, "Parent Sangh not found", 404);
      }
 
      // Specialized Sangh inherits type from parent
      if (parentSangh.sanghType !== "main") {
        resolvedSanghType = parentSangh.sanghType;
      }
 
      if (resolvedSanghType !== "main") {
        parentMainSanghId =
          parentSangh.parentMainSangh ||
          (parentSangh.sanghType === "main" ? parentSangh._id : null);
      }
    }
 
    // 5️⃣ Area-specific uniqueness check
    if (level === "area") {
      const areaQuery = {
        level: "area",
        "location.country": location.country,
        "location.city": location.city,
        "location.area": location.area,
        status: "active",
      };
      // state/district sirf India me hote hain
      if (isIndiaSangh) {
        areaQuery["location.state"] = location.state;
        areaQuery["location.district"] = location.district;
      }
      const existingAreaSangh = await HierarchicalSangh.findOne(areaQuery);
      if (existingAreaSangh) {
        return errorResponse(
          res,
          "An active Sangh already exists for this area",
          400,
        );
      }
    }
 
    // 6️⃣ Create Sangh
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
      sanghImage,
    });
 
    // 7️⃣ Validate hierarchy for users with sanghRoles (optional safety)
    if (req.user?.sanghRoles && req.user.sanghRoles.length > 0) {
      await sangh.validateHierarchy();
    }
 
    // 8️⃣ Create SanghAccess
    const SanghAccess = require("../../model/SanghModels/sanghAccessModel");
    const mongoose = require("mongoose");
 
    let resolvedParentSanghAccessId = null;
    if (parentSanghAccessId) {
      if (mongoose.Types.ObjectId.isValid(parentSanghAccessId)) {
        resolvedParentSanghAccessId = parentSanghAccessId;
      } else {
        const parentAccess = await SanghAccess.findOne({
          accessId: parentSanghAccessId,
          status: "active",
        });
        if (parentAccess) resolvedParentSanghAccessId = parentAccess._id;
      }
    }
 
    let sanghAccess = await SanghAccess.findOne({
      sanghId: sangh._id,
      status: "active",
    });
    if (!sanghAccess) {
      sanghAccess = await SanghAccess.create({
        sanghId: sangh._id,
        level,
        location,
        createdBy: req.user._id,
        parentSanghAccess: resolvedParentSanghAccessId,
      });
      sangh.sanghAccessId = sanghAccess._id;
      await HierarchicalSangh.findByIdAndUpdate(sangh._id, {
        sanghAccessId: sanghAccess._id,
      });
    }
 
    return successResponse(
      res,
      {
        sangh,
        accessId: sangh.accessId,
        sanghAccessId: sanghAccess._id,
        sanghAccessCode: sanghAccess.accessId,
      },
      "Sangh created successfully",
      201,
    );
  } catch (error) {
    if (req.files) await deleteS3Files(req.files);
    return errorResponse(res, error.message, 500);
  }
});

const getAllSangh = asyncHandler(async (req, res) => {
  try {
    const { district, state, city, level } = req.query;

    const query = {};

    if (state) query["location.state"] = state;
    if (district) query["location.district"] = district;
    if (city) query["location.city"] = city;
    if (level) query["level"] = level; // Optional: level=city ya level=district aap query param se bhej sakte ho

    const sanghs = await HierarchicalSangh.find(query);

    if (!sanghs.length) {
      return errorResponse(res, "No Sangh found", 404);
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

    return successResponse(
      res,
      updatedSanghs,
      "Filtered Sangh retrieved successfully",
    );
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

const getAllSanghs = asyncHandler(async (req, res) => {
  try {
    const { query, level, sanghType, state, district, city } = req.query;

    // Base criteria — optional direct filters (sab optional, na aaye to ignore)
    const searchCriteria = {};

    if (level) searchCriteria.level = level;
    if (sanghType) searchCriteria.sanghType = sanghType;
    if (state) searchCriteria["location.state"] = new RegExp(`^${state}$`, "i");
    if (district)
      searchCriteria["location.district"] = new RegExp(`^${district}$`, "i");
    if (city) searchCriteria["location.city"] = new RegExp(`^${city}$`, "i");

    // Text search (jaisa pehle tha) — par ab location keys SAHI tarike se
    if (query) {
      searchCriteria.$or = [
        { name: { $regex: query, $options: "i" } },
        { "location.country": { $regex: query, $options: "i" } },
        { "location.state": { $regex: query, $options: "i" } },
        { "location.district": { $regex: query, $options: "i" } },
        { "location.city": { $regex: query, $options: "i" } },
        { "location.area": { $regex: query, $options: "i" } },
      ];
    }

    // .lean() -> plain JS objects, Mongoose overhead nahi -> fast & light
    const sanghs = await HierarchicalSangh.find(searchCriteria).lean();

    if (!sanghs.length) {
      return errorResponse(res, "No Sangh found", 404);
    }

    // Convert S3 URLs to CDN URLs for each officeBearer's photo (SAME as before)
    sanghs.forEach((sangh) => {
      if (sangh.officeBearers && sangh.officeBearers.length > 0) {
        sangh.officeBearers.forEach((bearer) => {
          if (bearer.photo) {
            bearer.photo = convertS3UrlToCDN(bearer.photo);
          }
        });
      }
    });

    // Sort the Sanghs to bring matching results first (SAME as before)
    sanghs.sort((a, b) => {
      const queryLower = query ? query.toLowerCase() : "";

      const aMatch =
        (a.name && a.name.toLowerCase().includes(queryLower)) ||
        (a.location &&
          a.location.country &&
          a.location.country.toLowerCase().includes(queryLower)) ||
        (a.location &&
          a.location.state &&
          a.location.state.toLowerCase().includes(queryLower)) ||
        (a.location &&
          a.location.district &&
          a.location.district.toLowerCase().includes(queryLower)) ||
        (a.location &&
          a.location.city &&
          a.location.city.toLowerCase().includes(queryLower)) ||
        (a.location &&
          a.location.area &&
          a.location.area.toLowerCase().includes(queryLower));

      const bMatch =
        (b.name && b.name.toLowerCase().includes(queryLower)) ||
        (b.location &&
          b.location.country &&
          b.location.country.toLowerCase().includes(queryLower)) ||
        (b.location &&
          b.location.state &&
          b.location.state.toLowerCase().includes(queryLower)) ||
        (b.location &&
          b.location.district &&
          b.location.district.toLowerCase().includes(queryLower)) ||
        (b.location &&
          b.location.city &&
          b.location.city.toLowerCase().includes(queryLower)) ||
        (b.location &&
          b.location.area &&
          b.location.area.toLowerCase().includes(queryLower));

      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });

    return successResponse(res, sanghs, "All Sangh retrieved successfully");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// New sangh managment api for admin

const getSanghsList = asyncHandler(async (req, res) => {
  try {
    const { parentSangh, sanghId } = req.query;

    const match = {};
    const or = [];
    if (parentSangh) {
      try {
        or.push({ parentSangh: new mongoose.Types.ObjectId(parentSangh) });
      } catch (e) {
        or.push({ parentSangh });
      }
    }
    if (sanghId) {
      try {
        or.push({ _id: new mongoose.Types.ObjectId(sanghId) });
      } catch (e) {
        or.push({ _id: sanghId });
      }
    }
    if (or.length) match.$or = or; // koi param nahi (super admin) -> sab, par lite

    const sanghs = await HierarchicalSangh.aggregate([
      { $match: match },
      {
        $project: {
          name: 1,
          image: 1,
          establishedDate: 1,
          createdAt: 1,
          parentSangh: 1,
          level: 1,
          sanghType: 1,
          location: 1,
          membersCount: { $size: { $ifNull: ["$members", []] } },
        },
      },
    ]);

    return successResponse(res, sanghs, "Sangh list retrieved successfully");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});
const getHierarchy = asyncHandler(async (req, res) => {
  try {
    const sangh = await HierarchicalSangh.findById(req.params.id);
    if (!sangh) {
      return errorResponse(res, "Sangh not found", 404);
    }

    // ===== FY RENEWAL LAZY-RESET (ADDITIVE) =====
    // Indian FY: 1 Apr - 31 Mar. System 2026-27 se START hota hai.
    // - Jo abhi paid hai (2025 ya baad me pay kiya) uska lastPaidFY null hai
    //   -> use START FY (2026-27) me baptize kar do, paid hi rehne do.
    // - FY 2027-28 se aage: jiska lastPaidFY current se purana ho jaye ->
    //   purana record paymentHistory me daal ke paymentStatus wapas "pending".
    // Isse poori app (jo paymentStatus par chalti hai) apne aap Pay Now dikha
    // deti hai. Koi aur logic change nahi.
    const START_FY_YEAR = 2026; // system yahi se start (FY 2026-27)

    const fyStartYear = (ref) => {
      const dd = ref ? new Date(ref) : new Date();
      if (isNaN(dd.getTime())) return null;
      return dd.getMonth() >= 3 ? dd.getFullYear() : dd.getFullYear() - 1;
    };
    const fyLabel = (startY) =>
      startY + "-" + String((startY + 1) % 100).padStart(2, "0");

    let curStartYear = fyStartYear(new Date());
    if (curStartYear < START_FY_YEAR) curStartYear = START_FY_YEAR; // 2026-27 se pehle nahi
    const currentFYLabelStr = fyLabel(curStartYear);

    let fyResetChanged = false;

    const resetIfExpired = (m) => {
      if (String(m.paymentStatus).toLowerCase() !== "paid") return;

      // lastPaidFY ka start-year (na ho to START FY assume karo)
      let paidStartYear;
      if (m.lastPaidFY) {
        paidStartYear = parseInt(String(m.lastPaidFY).split("-")[0], 10);
      } else {
        // Purana paid member (field hi nahi tha) -> START FY me baptize
        paidStartYear = START_FY_YEAR;
        m.lastPaidFY = fyLabel(START_FY_YEAR);
        fyResetChanged = true;
      }
      if (isNaN(paidStartYear)) paidStartYear = START_FY_YEAR;

      // Current FY abhi bhi paid FY ke barabar/andar hai -> kuch mat karo
      if (curStartYear <= paidStartYear) return;

      // FY aage badh gaya -> purana record history me, phir pending
      if (!Array.isArray(m.paymentHistory)) m.paymentHistory = [];
      m.paymentHistory.push({
        financialYear: fyLabel(paidStartYear),
        amount: m.amount || 0,
        paymentDate: m.paymentDate || null,
        paymentStatus: "paid",
      });
      m.paymentStatus = "pending";
      m.paymentDate = null;
      m.paymentDistributed = false; // renewal par dobara distribute ho sake
      m.status = "inactive";
      fyResetChanged = true;
    };

    if (Array.isArray(sangh.members)) sangh.members.forEach(resetIfExpired);
    if (Array.isArray(sangh.honoraryMembers))
      sangh.honoraryMembers.forEach(resetIfExpired);

    if (fyResetChanged) {
      sangh.markModified("members");
      sangh.markModified("honoraryMembers");
      await sangh.save();
    }

    const hierarchy = await sangh.getHierarchy();
    hierarchy.currentFinancialYear = currentFYLabelStr;

    // Convert URLs in officeBearers
    if (hierarchy?.current?.officeBearers?.length) {
      hierarchy.current.officeBearers = hierarchy.current.officeBearers.map(
        (bearer) => ({
          ...bearer,
          photo: bearer.photo ? convertS3UrlToCDN(bearer.photo) : "",
        }),
      );
    }

    // ✅ Add sanghImage to hierarchy response
    hierarchy.sanghImage = sangh.sanghImage
      ? convertS3UrlToCDN(sangh.sanghImage)
      : null;

    return successResponse(res, hierarchy, "Hierarchy retrieved successfully");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});
// const updateSanghDetails = async (req, res) => {
//   try {
//     const { sanghId } = req.params;
//     const { name, officeAddress, officeBearers } = req.body;

//     const sangh = await HierarchicalSangh.findById(sanghId);
//     if (!sangh) return res.status(404).json({ success: false, message: 'Sangh not found' });

//     if (name) sangh.name = name;

//     if (officeAddress) {
//       sangh.officeAddress = {
//         ...sangh.officeAddress,
//         ...officeAddress
//       };
//     }
//     if (Array.isArray(officeBearers)) {
//       sangh.officeBearers = [];
//       for (const ob of officeBearers) {
//         if (!ob?.role || !ob?.userId) continue;
//       const addr = ob.address || {};
//       const bearerData = {
//         role: ob.role,
//         userId: ob.userId,
//         name: ob.name,
//         jainAadharNumber: ob.jainAadharNumber,
//         mobileNumber: ob.phoneNumber,
//         email: ob.email || '',
//         userImage: ob.userImage,
//         paymentStatus: ob.paymentStatus || 'pending',
//         status: 'active',
//         description: ob.description || '',
//         appointmentDate: new Date(),
//         termEndDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
//         level: sangh.level,
//         sanghType: sangh.sanghType || 'main',
//         address: {
//           street: ob.address?.street || '',
//           city: ob.address?.city || '',
//           district: ob.address?.district || '',
//           state: ob.address?.state || '',
//           pincode: ob.address?.pincode || ''
//         }
//       };

//         // ✅ Update User's sanghRoles as well
//         const user = await User.findById(ob.userId);
//         if (user) {
//           const roleIndex = user.sanghRoles.findIndex(
//             (r) => r.sanghId?.toString() === sanghId
//           );

//           if (roleIndex !== -1) {
//             user.sanghRoles[roleIndex].role = ob.role; // ✅ role change: 'member' => 'president' etc.
//           } else {
//             // if not present, add new
//             user.sanghRoles.push({
//               sanghId,
//               role: ob.role,
//               level: sangh.level,
//               sanghType: sangh.sanghType || 'main'
//             });
//           }

//           await user.save();
//         }

//         sangh.officeBearers.push(bearerData);
//       }
//     }

//     await sangh.save();

//     return res.json({
//       success: true,
//       message: 'Sangh updated successfully',
//       data: sangh
//     });

//   } catch (error) {
//     console.error("❌ Error updating sangh:", error);
//     return res.status(500).json({ success: false, message: 'Internal server error' });
//   }
// };
const updateSanghDetails = async (req, res) => {
  try {
    const { sanghId } = req.params;
    const { name, officeAddress, officeBearers, sanghTeams } = req.body;

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh)
      return res
        .status(404)
        .json({ success: false, message: "Sangh not found" });

    if (name) sangh.name = name;

    if (officeAddress) {
      sangh.officeAddress = {
        ...sangh.officeAddress,
        ...officeAddress,
      };
    }

    // ── NEW: purane office bearers ka snapshot (sirf notification decide karne
    // ke liye). Neeche wala code har save par list reset karta hai, isliye bina
    // snapshot ke purane bearers ko bhi dobara notification chala jata.
    const prevBearerKeys = new Set(
      (sangh.officeBearers || []).map(
        (b) => `${b.role}_${b.userId ? b.userId.toString() : ""}`,
      ),
    );

    /** ========== Update Office Bearers ========== */
    if (Array.isArray(officeBearers)) {
      sangh.officeBearers = [];
      for (const ob of officeBearers) {
        if (!ob?.role || !ob?.userId) continue;
        const bearerData = {
          role: ob.role,
          userId: ob.userId,
          name: ob.name,
          jainAadharNumber: ob.jainAadharNumber,
          phoneNumber: ob.phoneNumber,
          email: ob.email || "",
          userImage: ob.userImage,
          paymentStatus: ob.paymentStatus || "pending",
          status: "active",
          description: ob.description || "",
          appointmentDate: new Date(),
          termEndDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
          level: sangh.level,
          sanghType: sangh.sanghType || "main",
          address: {
            street: ob.address?.street || "",
            city: ob.address?.city || "",
            district: ob.address?.district || "",
            state: ob.address?.state || "",
            pincode: ob.address?.pincode || "",
          },
        };

        // ✅ Update User sanghRoles
        await assignRoleToUser(
          ob.userId,
          sanghId,
          ob.role,
          sangh.level,
          sangh.sanghType,
        );

        sangh.officeBearers.push(bearerData);
      }
    }

    /** ========== Update Sangh Teams ========== */
    if (Array.isArray(sanghTeams)) {
      for (const st of sanghTeams) {
        if (!st?.role || !st?.userId) continue;

        const exists = sangh.sanghTeams.some(
          (team) =>
            team.role === st.role && String(team.userId) === String(st.userId),
        );

        if (exists) continue;

        const teamData = {
          role: st.role,
          userId: st.userId,
          name: st.name,
          jainAadharNumber: st.jainAadharNumber,
          phoneNumber: st.phoneNumber,
          email: st.email || "",
          userImage: st.userImage,
          paymentStatus: st.paymentStatus || "pending",
          status: "active",
          description: st.description || "",
          appointmentDate: new Date(),
          termEndDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
          level: sangh.level,
          sanghType: sangh.sanghType || "main",
          address: {
            street: st.address?.street || "",
            city: st.address?.city || "",
            district: st.address?.district || "",
            state: st.address?.state || "",
            pincode: st.address?.pincode || "",
          },
        };

        // ✅ Update User sanghRoles
        await assignRoleToUser(
          st.userId,
          sanghId,
          st.role,
          sangh.level,
          sangh.sanghType,
        );

        // Append new member
        sangh.sanghTeams.push(teamData);
      }
    }

    await sangh.save();

    // ── NEW: naye office bearers (president / secretary / treasurer) ko
    // in-app notification + FCM push. Push automatic hai — notificationModel ke
    // post("save") hook se. Fail hone par bhi main response affect nahi hoga.
    try {
      if (Array.isArray(officeBearers)) {
        const Notification = require("../../model/SocialMediaModels/notificationModel");
        const senderId =
          req.user?._id || req.user?.id || req.body?.updatedBy || null;
        const roleLabel = {
          president: "President",
          secretary: "Secretary",
          treasurer: "Treasurer",
        };

        if (senderId) {
          for (const b of sangh.officeBearers) {
            if (!b?.userId || !roleLabel[b.role]) continue;

            const key = `${b.role}_${b.userId.toString()}`;
            // pehle se isi role par tha -> dobara notify mat karo
            if (prevBearerKeys.has(key)) continue;
            // khud ko notification nahi
            if (b.userId.toString() === senderId.toString()) continue;

            await Notification.create({
              senderId,
              receiverId: b.userId,
              type: "sangh_office_bearer",
              sanghId: sangh._id,
              sanghRole: b.role,
              message: `appointed you as ${roleLabel[b.role]} of ${sangh.name}`,
            });
          }
        } else {
          console.log("⚠️ office bearer notif skip: senderId missing");
        }
      }
    } catch (e) {
      console.log("⚠️ office bearer notification failed:", e.message);
    }

    return res.json({
      success: true,
      message: "Sangh updated successfully",
      data: sangh,
    });
  } catch (error) {
    console.error("❌ Error updating sangh:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

/** 🔹 Helper function: Assign role to User */
const assignRoleToUser = async (userId, sanghId, role, level, sanghType) => {
  const user = await User.findById(userId);
  if (user) {
    const roleIndex = user.sanghRoles.findIndex(
      (r) => r.sanghId?.toString() === sanghId,
    );

    if (roleIndex !== -1) {
      user.sanghRoles[roleIndex].role = role;
    } else {
      user.sanghRoles.push({
        sanghId,
        role,
        level,
        sanghType: sanghType || "main",
      });
    }

    await user.save();
  }
};
const deleteSanghTeamMember = async (req, res) => {
  try {
    const { sanghId, memberId } = req.params;

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh)
      return res
        .status(404)
        .json({ success: false, message: "Sangh not found" });

    // Find member by _id or userId
    const memberIndex = sangh.sanghTeams.findIndex(
      (m) =>
        String(m._id) === String(memberId) ||
        String(m.userId) === String(memberId),
    );

    if (memberIndex === -1) {
      return res
        .status(404)
        .json({ success: false, message: "Member not found in Sangh Team" });
    }

    const removedMember = sangh.sanghTeams.splice(memberIndex, 1)[0];

    const user = await User.findById(removedMember.userId);
    if (user) {
      user.sanghRoles = user.sanghRoles.map((r) => {
        if (
          r.sanghId &&
          r.sanghId.toString() === sanghId &&
          r.role === removedMember.role
        ) {
          return { ...r, role: "member" };
        }
        return r;
      });
      await user.save();
    }

    await sangh.save();

    return res.json({
      success: true,
      message:
        "Member removed from Sangh Team and role updated to member in user",
      data: sangh.sanghTeams,
    });
  } catch (error) {
    console.error("❌ Error deleting Sangh Team member:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// PATCH /api/hierarchical-sangh/member-status
const updateMemberStatus = asyncHandler(async (req, res) => {
  const { sanghId, userId, status } = req.body;

  if (!sanghId || !userId) {
    return errorResponse(res, "sanghId and userId are required", 400);
  }

  const sangh = await HierarchicalSangh.findById(sanghId);
  if (!sangh) {
    return errorResponse(res, "Sangh not found", 404);
  }

  // Find index of member inside the sangh.members array
  const memberIndex = sangh.members.findIndex(
    (m) => m.userId.toString() === userId,
  );

  if (memberIndex === -1) {
    return errorResponse(res, "Member not found in hierarchy", 404);
  }

  // Update member status
  sangh.members[memberIndex].status = status || "active";

  await sangh.save();

  return successResponse(
    res,
    sangh.members[memberIndex],
    "Member status updated successfully",
  );
});

const SUPER_ADMIN_ID = "688378b981449c14306611d7";

const updatePanchMembers = async (req, res) => {
  try {
    const { sanghId } = req.params;
    const { panches } = req.body;
    const requester = req.user;

    if (!Array.isArray(panches)) {
      return res
        .status(400)
        .json({ success: false, message: "Panch members must be an array" });
    }

    if (panches.length > 5) {
      return res.status(400).json({
        success: false,
        message: "Only 5 Panch members allowed at a time",
      });
    }

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) {
      return res
        .status(404)
        .json({ success: false, message: "Sangh not found" });
    }

    // ✅ FIXED: superadmin _id se check + role se check + sanghRoles se check
    const isSuperAdmin =
      String(requester._id || requester.id) === SUPER_ADMIN_ID ||
      requester.role === "superadmin";

    const hasSanghAccess = requester.sanghRoles?.some(
      (role) => String(role.sanghId) === String(sanghId),
    );

    if (!isSuperAdmin && !hasSanghAccess) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to update this sangh",
      });
    }

    const existingUserIds = new Set(sangh.panches.map((p) => String(p.userId)));
    const addedUserIds = new Set();

    for (const pm of panches) {
      if (!pm.userId || !pm.jainAadharNumber) {
        console.warn("⚠️ Skipping invalid member:", pm);
        continue;
      }

      const userIdStr = String(pm.userId);
      if (existingUserIds.has(userIdStr)) {
        console.warn("⚠️ Skipping already existing user:", userIdStr);
        continue;
      }

      if (addedUserIds.has(userIdStr)) {
        console.warn("⚠️ Duplicate in current request skipped:", userIdStr);
        continue;
      }

      sangh.panches.push({
        userId: pm.userId,
        name: pm.name,
        jainAadharNumber: pm.jainAadharNumber,
        level: pm.level || sangh.level,
        sanghType: pm.sanghType || sangh.sanghType || "main",
        postMember: pm.postMember || "",
        email: pm.email || "",
        phoneNumber: pm.phoneNumber || "",
        document: pm.document || "",
        userImage: pm.userImage || "",
        address: {
          street: pm.address?.street || "",
          city: pm.address?.city || "",
          district: pm.address?.district || "",
          state: pm.address?.state || "",
          pincode: pm.address?.pincode || "",
        },
        status: "active",
        paymentStatus: pm.paymentStatus || "pending",
      });

      addedUserIds.add(userIdStr);

      const user = await User.findById(pm.userId);
      if (user) {
        const roleIndex = user.sanghRoles.findIndex(
          (r) => String(r.sanghId) === sanghId,
        );
        if (roleIndex !== -1) {
          user.sanghRoles[roleIndex].role = "panchMember";
        } else {
          user.sanghRoles.push({
            sanghId,
            role: "panchMember",
            level: sangh.level,
            sanghType: sangh.sanghType || "main",
          });
        }
        await user.save();
      }
    }

    await sangh.save();

    return res.json({
      success: true,
      message: "Panch members updated (merged) successfully",
      data: sangh.panches,
    });
  } catch (error) {
    console.error("❌ Error updating panch members:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
// Get Sanghs by level and location
const getSanghsByLevelAndLocation = asyncHandler(async (req, res) => {
  try {
    const {
      level,
      country,
      state,
      district,
      city,
      page = 1,
      limit = 10,
    } = req.query;
    const query = { status: "active" };
    if (level) query.level = level;
    if (country) query["location.country"] = country;
    if (state) query["location.state"] = state;
    if (district) query["location.district"] = district;
    if (city) query["location.city"] = city;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sanghs = await HierarchicalSangh.find(query)
      .populate("parentSangh", "name level location")
      .populate("officeBearers.userId", "name email phoneNumber")
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await HierarchicalSangh.countDocuments(query);
    return successResponse(
      res,
      {
        sanghs,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
      "Sanghs retrieved successfully",
    );
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// Get child Sanghs
const getChildSanghs = asyncHandler(async (req, res) => {
  try {
    const sangh = await HierarchicalSangh.findById(req.params.id);
    if (!sangh) {
      return errorResponse(res, "Sangh not found", 404);
    }
    const children = await sangh.getChildSanghs();
    return successResponse(
      res,
      children,
      "Child Sanghs retrieved successfully",
    );
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});
const updateSanghById = asyncHandler(async (req, res) => {
  const sanghId = req.params.id;

  try {
    const existingSangh = await HierarchicalSangh.findById(sanghId);
    if (!existingSangh) {
      return errorResponse(res, "Sangh not found", 404);
    }
    // Optional uploaded images
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
      { new: true },
    );

    return successResponse(res, updatedSangh, "Sangh updated successfully");
  } catch (error) {
    if (req.files) {
      await deleteS3Files(req.files); // Optional cleanup
    }
    return errorResponse(res, error.message || "Something went wrong", 500);
  }
});

// Update Sangh
const updateHierarchicalSangh = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { role, name, mobileNumber, address, pinCode, paymentStatus } =
      req.body;

    if (!role) return errorResponse(res, "Role is required", 400);

    const sangh = await HierarchicalSangh.findById(id);
    if (!sangh) return errorResponse(res, "Sangh not found", 404);

    // Only current user's role allowed
    const userRole = req.user.sanghRoles.find(
      (r) => r.sanghId.toString() === id && r.role === role,
    );

    if (!userRole && req.user.role !== "superadmin") {
      return errorResponse(res, "Not authorized to update this Sangh", 403);
    }

    // Build update fields
    const updateFields = {};
    if (name) updateFields["officeBearers.$[elemTarget].name"] = name;
    if (mobileNumber)
      updateFields["officeBearers.$[elemTarget].mobileNumber"] = mobileNumber;
    if (address) updateFields["officeBearers.$[elemTarget].address"] = address;
    if (pinCode) updateFields["officeBearers.$[elemTarget].pinCode"] = pinCode;
    if (paymentStatus)
      updateFields["officeBearers.$[elemTarget].paymentStatus"] = paymentStatus;
    if (req.body.description)
      updateFields["officeBearers.$[elemTarget].description"] =
        req.body.description;
    if (req.files?.[`${role}Photo`]) {
      const photo = convertS3UrlToCDN(req.files[`${role}Photo`][0].location);
      updateFields["officeBearers.$[elemTarget].photo"] = photo;
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
        arrayFilters: [{ "elemTarget.role": role }],
      },
    ).populate("officeBearers.userId", "name email phoneNumber");

    return successResponse(res, updated, "Updated successfully");
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
        Key: key,
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
      roleFiles.forEach((file) => {
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
      return errorResponse(res, "Sangh not found", 404);
    }

    const currentDate = new Date();
    const expiredBearers = sangh.officeBearers.filter(
      (bearer) =>
        bearer.status === "active" && bearer.termEndDate < currentDate,
    );

    if (expiredBearers.length > 0) {
      // Mark expired bearers as inactive
      await HierarchicalSangh.updateOne(
        { _id: sanghId },
        {
          $set: {
            "officeBearers.$[elem].status": "inactive",
          },
        },
        {
          arrayFilters: [
            {
              "elem.status": "active",
              "elem.termEndDate": { $lt: currentDate },
            },
          ],
        },
      );

      return successResponse(res, {
        message: "Office bearer terms checked",
        expiredBearers: expiredBearers.map((b) => ({
          role: b.role,
          name: b.name,
          termEndDate: b.termEndDate,
        })),
      });
    }

    return successResponse(res, {
      message: "No expired terms found",
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});
const getUserByJainAadhar = asyncHandler(async (req, res) => {
  const { aadharNumber } = req.params;

  const jainAadhar = await JainAadharApplication.findOne({
    jainAadharNumber: aadharNumber.trim(),
    status: "verified",
  })
    .select(
      "name dob age gender jainAadharNumber location userProfile profileImage status",
    )
    .lean();

  if (!jainAadhar) {
    return res.status(404).json({
      success: false,
      message: "Jain Aadhar not found or unverified",
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      _id: jainAadhar._id,
      name: jainAadhar.name,
      dob: jainAadhar.dob || "",
      age: jainAadhar.age || null,
      gender: jainAadhar.gender || "",
      jainAadharNumber: jainAadhar.jainAadharNumber,
      location: jainAadhar.location || {},
      profileImage: jainAadhar.userProfile || jainAadhar.profileImage || "",
    },
  });
});

const distributeMemberPayment = async ({ member, user, sourceSangh }) => {
  const FOUNDATION_PERCENT = 20;
  const SOURCE_PERCENT = 50;
  const OTHER_PERCENT = 10;

  // India ke bahar beech ke levels (state/district) hote hi nahi, isliye
  // wahan 10%-10% baantne ko koi sangh nahi hota. Poora amount do hisson me:
  const OVERSEAS_FOUNDATION_PERCENT = 30;
  const OVERSEAS_SOURCE_PERCENT = 70;

  const userLocation = user?.jainAadharApplication?.location || {};
  const sanghType = member.sanghType || "main";

  const resolvedMemberLevel =
    member.level ||
    (member.localSangh?.sanghId ? "local" : null) ||
    sourceSangh.level;

  const ALL_LEVELS = ["country", "state", "district", "city"];
  const sanghCountry = sourceSangh.location?.country || "India";
  const useOverseasSplit =
    sourceSangh.level === "international" || sanghCountry !== "India";

  if (useOverseasSplit) {
    // Non-India location me province/county/prefecture hote hain --
    // receivedPayments.location ke state/district me sahi value bhejo
    const mappedLocation = toMemberAddress(userLocation);

    const basePayment = {
      fromMemberId: member.userId,
      memberName: member.name,
      jainAadharNumber: member.jainAadharNumber,
      fromMemberLevel: resolvedMemberLevel,
      sanghType,
      location: mappedLocation,
      sourceSanghId: sourceSangh._id,
      sourceSanghLevel: sourceSangh.level,
    };

    /* ---------------- FOUNDATION (30%) ---------------- */
    const foundationSangh = await HierarchicalSangh.findOne({
      level: "foundation",
    });

    if (foundationSangh) {
      const foundationAmount =
        (member.amount * OVERSEAS_FOUNDATION_PERCENT) / 100;

      foundationSangh.receivedPayments.push({
        ...basePayment,
        percentage: OVERSEAS_FOUNDATION_PERCENT,
        amount: foundationAmount,
      });

      foundationSangh.totalAvailableAmount += foundationAmount;
      await foundationSangh.save();
    }

    /* ---------------- SOURCE SANGH (70%) ---------------- */
    const overseasSourceAmount =
      (member.amount * OVERSEAS_SOURCE_PERCENT) / 100;

    sourceSangh.receivedPayments.push({
      ...basePayment,
      percentage: OVERSEAS_SOURCE_PERCENT,
      amount: overseasSourceAmount,
    });

    sourceSangh.totalAvailableAmount += overseasSourceAmount;
    await sourceSangh.save();

    member.paymentDistributed = true;
    return;
  }

  /* ---------------- FOUNDATION (20%) ---------------- */
  const foundation = await HierarchicalSangh.findOne({ level: "foundation" });

  if (foundation) {
    const amount = (member.amount * FOUNDATION_PERCENT) / 100;

    foundation.receivedPayments.push({
      fromMemberId: member.userId,
      memberName: member.name,
      jainAadharNumber: member.jainAadharNumber,
      fromMemberLevel: resolvedMemberLevel,
      percentage: FOUNDATION_PERCENT,
      amount,
      sanghType,
      location: userLocation,
      sourceSanghId: sourceSangh._id,
      sourceSanghLevel: sourceSangh.level,
    });

    foundation.totalAvailableAmount += amount;
    await foundation.save();
  }

  /* ---------------- SOURCE SANGH (50%) ---------------- */
  const sourceAmount = (member.amount * SOURCE_PERCENT) / 100;

  sourceSangh.receivedPayments.push({
    fromMemberId: member.userId,
    memberName: member.name,
    jainAadharNumber: member.jainAadharNumber,
    fromMemberLevel: resolvedMemberLevel,
    percentage: SOURCE_PERCENT,
    amount: sourceAmount,
    sanghType,
    location: userLocation,
    sourceSanghId: sourceSangh._id,
    sourceSanghLevel: sourceSangh.level,
  });

  sourceSangh.totalAvailableAmount += sourceAmount;
  await sourceSangh.save();

  /* ---------------- OTHER SANGHS (10% EACH) ---------------- */
  for (const level of ALL_LEVELS) {
    if (level === sourceSangh.level) continue;

    let targetSangh = null;

    /* ---------- CITY (honorary priority) ---------- */
    if (level === "city") {
      targetSangh = await HierarchicalSangh.findOne({
        level: "city",
        sanghType,
        "honoraryMembers.userId": member.userId,
      });

      if (!targetSangh) {
        targetSangh = await HierarchicalSangh.findOne({
          level: "city",
          sanghType,
          "location.city": userLocation.city,
        });
      }
    } else {
      /* ---------- COUNTRY / STATE / DISTRICT (USER LOCATION BASED) ---------- */
      let query = { level, sanghType };

      if (level === "country") query["location.country"] = userLocation.country;

      if (level === "state") query["location.state"] = userLocation.state;

      if (level === "district")
        query["location.district"] = userLocation.district;

      targetSangh = await HierarchicalSangh.findOne(query);
    }

    if (!targetSangh) continue;

    const amount = (member.amount * OTHER_PERCENT) / 100;

    targetSangh.receivedPayments.push({
      fromMemberId: member.userId,
      memberName: member.name,
      jainAadharNumber: member.jainAadharNumber,
      fromMemberLevel: resolvedMemberLevel,
      percentage: OTHER_PERCENT,
      amount,
      sanghType,
      location: userLocation,
      sourceSanghId: sourceSangh._id,
      sourceSanghLevel: sourceSangh.level,
      via:
        level === "city" &&
        targetSangh.honoraryMembers?.some(
          (h) => String(h.userId) === String(member.userId),
        )
          ? "honorary"
          : "location",
    });

    targetSangh.totalAvailableAmount += amount;
    await targetSangh.save();
  }
  member.paymentDistributed = true;
};

// ✅ NEW HELPER

const findJainAadharUser = async (jainAadharNumber) => {
  if (!jainAadharNumber) return null;

  const num = String(jainAadharNumber).trim();
  if (!num) return null;

  // exact match, case ignore (JAIN82506968 / jain82506968 dono)
  const numberRegex = new RegExp(
    `^${num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i",
  );

  // ── 1) Purana tareeka (status ab "approved" bhi accept karta hai) ──
  let user = await User.findOne({
    jainAadharNumber: numberRegex,
    jainAadharStatus: { $in: ["verified", "approved"] },
  }).populate("jainAadharApplication");

  if (user && user.jainAadharApplication) return user;

  // ── 2) Seedha JainAadhar application se resolve karo ──
  const app = await JainAadharApplication.findOne({
    jainAadharNumber: numberRegex,
    status: { $in: ["approved", "verified"] },
  }).lean();

  if (!app) return user || null;

  const linkedUserId = app.userId || app.createdBy;
  if (!linkedUserId) return user || null;

  if (!user) {
    user = await User.findById(linkedUserId).populate("jainAadharApplication");
  }
  if (!user) return null;

  // populate khali aaya to application manually attach karo
  // (defineProperty se mongoose ObjectId me cast nahi karega)
  if (!user.jainAadharApplication) {
    Object.defineProperty(user, "jainAadharApplication", {
      value: app,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  return user;
};
// Add member(s) to Sangh
const addSanghMember = asyncHandler(async (req, res) => {
  try {
    const sanghId = req.params.sanghId;
    const MAX_BULK_MEMBERS = 50;
 
    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) return errorResponse(res, "Sangh not found", 404);
 
    const isBulk = req.body.members && Array.isArray(req.body.members);
 
    if (isBulk) {
      const { members } = req.body;
      if (members.length === 0)
        return errorResponse(res, "Members array cannot be empty", 400);
 
      if (members.length > MAX_BULK_MEMBERS)
        return errorResponse(
          res,
          `Cannot add more than ${MAX_BULK_MEMBERS} members at once`,
          400,
        );
 
      const results = { success: [], failed: [] };
 
      for (const member of members) {
        if (!member.jainAadharNumber) {
          results.failed.push({
            jainAadharNumber: "unknown",
            reason: "Missing Jain Aadhar number",
          });
          continue;
        }
 
        try {
          // ✅ CHANGED: helper se lookup
          const user = await findJainAadharUser(member.jainAadharNumber);
 
          if (!user) {
            results.failed.push({
              jainAadharNumber: member.jainAadharNumber,
              reason: "Invalid or unverified Jain Aadhar number",
            });
            continue;
          }
 
          const location = user?.jainAadharApplication?.location || {};
          const contact = user?.jainAadharApplication?.contactDetails || {};
          const rawImage =
            req.file?.location ||
            req.file?.path ||
            user?.jainAadharApplication?.userProfile ||
            user?.profileImage ||
            "";
          const rawScreenshot =
            req.files?.memberScreenshot?.[0]?.location ||
            req.files?.memberScreenshot?.[0]?.path ||
            "";
          const memberScreenshot = rawScreenshot
            ? convertS3UrlToCDN(rawScreenshot)
            : "";
          const userImage = rawImage ? convertS3UrlToCDN(rawImage) : "";
          const paymentStatus = member.paymentStatus || "pending";
          const isPaid = paymentStatus === "paid";
 
          const membershipStartDate = new Date();
          const membershipEndDate = new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000,
          );
 
          // Duplicate guard -- yahi userId is sangh me pehle se member hai?
          const alreadyMember = sangh.members.some(
            (m) => m?.userId?.toString() === user._id.toString(),
          );
 
          if (alreadyMember) {
            results.failed.push({
              jainAadharNumber: member.jainAadharNumber,
              reason: "Already a member of this Sangh",
            });
            continue;
          }
 
          const paymentDate = isPaid ? new Date() : null;
          const newMember = {
            userId: user._id,
            name: user?.jainAadharApplication?.name || "Unknown",
            jainAadharNumber: member.jainAadharNumber,
            email: contact.email || user.email,
            phoneNumber: contact.number || user.phoneNumber,
            postMember: member.postMember || "",
            userImage,
            memberScreenshot,
            amount: member.amount || 0,
            paymentStatus,
            paymentDate,
            membershipStartDate,
            membershipEndDate,
            status: isPaid ? "active" : "inactive",
            // Country-aware address (India ka natija bilkul pehle jaisa)
            address: toMemberAddress(location),
            addedBy: req.user._id,
            addedAt: new Date(),
            localSangh: member.localSangh?.sanghId
              ? {
                  state: member.localSangh.state || "",
                  district: member.localSangh.district || "",
                  sanghId: member.localSangh.sanghId,
                  name: member.localSangh.name || "",
                }
              : undefined,
          };
 
          sangh.members.push(newMember);
          results.success.push({
            jainAadharNumber: member.jainAadharNumber,
            name: newMember.name,
          });
 
          // STEP 1: Add MEMBER role first (Index 0)
          // Isi sangh ka member role dobara na jude
          await User.updateOne(
            {
              _id: user._id,
              sanghRoles: {
                $not: { $elemMatch: { sanghId: sangh._id, role: "member" } },
              },
            },
            {
              $push: {
                sanghRoles: {
                  sanghId: sangh._id,
                  role: "member",
                  level: sangh.level,
                  sanghType: sangh.sanghType || "main",
                  addedAt: new Date(),
                },
              },
            },
          );
 
          // STEP 2: Add HONORARY MEMBER role if applicable (Index 1)
          if (
            (member.isHonorary === "true" || member.isHonorary === true) &&
            member.localSangh?.sanghId
          ) {
            const localSangh = await HierarchicalSangh.findById(
              member.localSangh.sanghId,
            );
 
            if (localSangh) {
              const honoraryMember = {
                userId: user._id,
                name: newMember.name,
                jainAadharNumber: newMember.jainAadharNumber,
                email: newMember.email,
                phoneNumber: newMember.phoneNumber,
                postMember: member.postMember || "Honorary Member",
                level: "city",
                sanghType: member.sanghType || "main",
                userImage: newMember.userImage,
                memberScreenshot: newMember.memberScreenshot,
                amount: member.amount || 0,
                // ✅ FIXED: yahan `finalPaymentStatus` tha jo bulk scope me
                // define hi nahi hota — ReferenceError aata tha
                paymentStatus,
                paymentDate: isPaid ? new Date() : null,
                membershipStartDate,
                membershipEndDate,
                status: isPaid ? "active" : "inactive",
                address: newMember.address,
                isHonorary: true,
                addedBy: req.user._id,
                addedAt: new Date(),
              };
 
              if (!localSangh.honoraryMembers) {
                localSangh.honoraryMembers = [];
              }
 
              const exists = localSangh.honoraryMembers.some(
                (h) => h.jainAadharNumber === member.jainAadharNumber,
              );
 
              if (!exists) {
                localSangh.honoraryMembers.push(honoraryMember);
                await localSangh.save();
              }
 
              // Add honoraryMember role AFTER member role
              await User.findByIdAndUpdate(user._id, {
                $push: {
                  sanghRoles: {
                    sanghId: localSangh._id,
                    role: "honoraryMember",
                    level: "city",
                    sanghType: localSangh.sanghType,
                    addedAt: new Date(),
                  },
                },
              });
            }
          }
        } catch (error) {
          results.failed.push({
            jainAadharNumber: member.jainAadharNumber,
            reason: error.message,
          });
        }
      }
 
      if (results.success.length > 0) await sangh.save();
 
      return successResponse(
        res,
        {
          sangh: {
            _id: sangh._id,
            name: sangh.name,
            level: sangh.level,
            totalMembers: sangh.members.length,
          },
          results,
        },
        `Added ${results.success.length} members, ${results.failed.length} failed`,
      );
    }
 
    // ======= SINGLE MEMBER ADDITION =======
    const {
      jainAadharNumber,
      postMember,
      level,
      sanghType,
      paymentStatus,
      amount,
      isHonorary,
    } = req.body;
 
    // ✅ Parse localSangh if needed
    if (req.body.localSangh && typeof req.body.localSangh === "string") {
      try {
        req.body.localSangh = JSON.parse(req.body.localSangh);
      } catch (err) {
        console.error("❌ Error parsing localSangh:", err.message);
        req.body.localSangh = undefined;
      }
    }
 
    if (!jainAadharNumber)
      return errorResponse(res, "Jain Aadhar number is required", 400);
 
    // ✅ CHANGED: helper se lookup
    const user = await findJainAadharUser(jainAadharNumber);
 
    if (!user)
      return errorResponse(
        res,
        "Invalid or unverified Jain Aadhar number",
        400,
      );
 
    // Duplicate guard -- double submit se do baar member ban jaata tha.
    // Yahi userId is sangh me pehle se hai to aage badhna hi nahi hai.
    const alreadyMember = sangh.members.some(
      (m) => m?.userId?.toString() === user._id.toString(),
    );
 
    if (alreadyMember) {
      return errorResponse(res, "Already a member of this Sangh", 400);
    }
 
    const location = user?.jainAadharApplication?.location || {};
    const contact = user?.jainAadharApplication?.contactDetails || {};
    const manualImage = req.file?.location || req.file?.path;
 
    const rawImage =
      manualImage ||
      user?.jainAadharApplication?.userProfile ||
      user?.profileImage ||
      "";
    const userImage = rawImage ? convertS3UrlToCDN(rawImage) : "";
    const rawScreenshot =
      req.files?.memberScreenshot?.[0]?.location ||
      req.files?.memberScreenshot?.[0]?.path ||
      "";
 
    const memberScreenshot = rawScreenshot
      ? convertS3UrlToCDN(rawScreenshot)
      : "";
    const finalPaymentStatus = paymentStatus || "pending";
    const isPaid = finalPaymentStatus === "paid";
    const membershipStartDate = new Date();
    const membershipEndDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
 
    const newMember = {
      userId: user._id,
      name: user?.jainAadharApplication?.name || "Unknown",
      jainAadharNumber,
      email: contact.email || user.email,
      phoneNumber: contact.number || user.phoneNumber,
      postMember: postMember || "",
      level: level || "",
      sanghType: sanghType || "main",
      userImage,
      memberScreenshot,
      amount: amount || 0,
      // Country-aware address (India ka natija bilkul pehle jaisa)
      address: toMemberAddress(location),
      paymentStatus: finalPaymentStatus,
      paymentDate: isPaid ? new Date() : null,
      membershipStartDate,
      membershipEndDate,
      status: isPaid ? "active" : "inactive",
      paymentDistributed: false,
      localSangh: req.body.localSangh?.sanghId
        ? {
            state: req.body.localSangh.state || "",
            district: req.body.localSangh.district || "",
            sanghId: req.body.localSangh.sanghId,
            name: req.body.localSangh.name || "",
          }
        : undefined,
      addedBy: req.user._id,
      addedAt: new Date(),
    };
 
    sangh.members.push(newMember);
    await sangh.save();
 
    // STEP 1: UPDATE USER SANGH ROLES - MEMBER ROLE FIRST (Index 0)
    // Isi sangh ka member role dobara na jude
    await User.updateOne(
      {
        _id: user._id,
        sanghRoles: {
          $not: { $elemMatch: { sanghId: sangh._id, role: "member" } },
        },
      },
      {
        $push: {
          sanghRoles: {
            sanghId: sangh._id,
            role: "member",
            level: sangh.level,
            sanghType: sangh.sanghType || "main",
            addedAt: new Date(),
          },
        },
      },
    );
 
    // ✅ STEP 2: HONORARY MEMBER ROLE ADDITION (Index 1) - Only if isHonorary is true
    if (
      (isHonorary === "true" || isHonorary === true) &&
      req.body.localSangh?.sanghId
    ) {
      const localSangh = await HierarchicalSangh.findById(
        req.body.localSangh.sanghId,
      );
 
      if (localSangh) {
        const honoraryMember = {
          userId: user._id,
          name: newMember.name,
          jainAadharNumber: newMember.jainAadharNumber,
          email: newMember.email,
          phoneNumber: newMember.phoneNumber,
          postMember: postMember || "Honorary Member",
          level: "city",
          sanghType: sanghType || "main",
          userImage: newMember.userImage,
          memberScreenshot: newMember.memberScreenshot,
          amount: amount || 0,
          paymentStatus: finalPaymentStatus,
          paymentDate: isPaid ? new Date() : null,
          membershipStartDate,
          membershipEndDate,
          status: "inactive",
          address: newMember.address,
          isHonorary: true,
          addedBy: req.user._id,
          addedAt: new Date(),
        };
 
        if (!localSangh.honoraryMembers) {
          localSangh.honoraryMembers = [];
        }
 
        // prevent duplicate
        const exists = localSangh.honoraryMembers.some(
          (h) => h.jainAadharNumber === jainAadharNumber,
        );
 
        if (!exists) {
          localSangh.honoraryMembers.push(honoraryMember);
          await localSangh.save();
        }
 
        // ✅ Add honoraryMember role AFTER member role (ensures proper order)
        await User.findByIdAndUpdate(user._id, {
          $push: {
            sanghRoles: {
              sanghId: localSangh._id,
              role: "honoraryMember",
              level: "city",
              sanghType: localSangh.sanghType,
              addedAt: new Date(),
            },
          },
        });
      }
    }
 
    // =================================================
    // ✅ PAYMENT DISTRIBUTION (ONLY IF PAID)
    // =================================================
    if (isPaid && !newMember.paymentDistributed) {
      await distributeMemberPayment({
        member: newMember,
        user,
        sourceSangh: sangh,
      });
 
      // flag update
      newMember.paymentDistributed = true;
      await sangh.save();
    }
 
    return successResponse(
      res,
      {
        member: newMember,
        sangh: {
          _id: sangh._id,
          name: sangh.name,
          level: sangh.level,
          totalMembers: sangh.members.length,
          totalHonoraryMembers: sangh.honoraryMembers?.length || 0,
        },
      },
      "Member added successfully",
    );
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});
 
 
// Add Honorary Member to Sangh (SINGLE ONLY)
const addHonoraryMember = asyncHandler(async (req, res) => {
  try {
    const { sanghId } = req.params;
    const { jainAadharNumber, postMember, level, sanghType, description } =
      req.body;

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) return errorResponse(res, "Sangh not found", 404);

    if (!jainAadharNumber)
      return errorResponse(res, "Jain Aadhar number is required", 400);

    // 🔹 Jain Aadhar verified user
    // ✅ CHANGED: helper se lookup
    const user = await findJainAadharUser(jainAadharNumber);

    if (!user)
      return errorResponse(
        res,
        "Invalid or unverified Jain Aadhar number",
        400,
      );

    // 🔹 Duplicate honorary check
    if (
      sangh.honoraryMembers?.some(
        (m) => m.jainAadharNumber === jainAadharNumber,
      )
    ) {
      return errorResponse(
        res,
        "Already an honorary member of this Sangh",
        400,
      );
    }

    // 🔹 Find existing MEMBER entry (IMPORTANT FIX)
    const existingMember = sangh.members?.find(
      (m) => String(m.userId) === String(user._id),
    );

    const location = user?.jainAadharApplication?.location || {};
    const contact = user?.jainAadharApplication?.contactDetails || {};

    // 🔹 IMAGE FIX (member → request → aadhar → profile)
    const rawImage =
      existingMember?.userImage ||
      req.file?.location ||
      req.file?.path ||
      user?.jainAadharApplication?.userProfile ||
      user?.profileImage ||
      "";

    const userImage = rawImage ? convertS3UrlToCDN(rawImage) : "";

    const rawScreenshot =
      req.files?.memberScreenshot?.[0]?.location ||
      req.files?.memberScreenshot?.[0]?.path ||
      "";

    const memberScreenshot = rawScreenshot
      ? convertS3UrlToCDN(rawScreenshot)
      : "";

    // 🔹 PAYMENT & STATUS inherit from member
    const isPaidMember = existingMember?.paymentStatus === "paid";

    const membershipStartDate = new Date();
    const membershipEndDate = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000, // ✅ 1 year
    );

    // 🔹 Honorary Member Object (FINAL)
    const honoraryMember = {
      userId: user._id,
      name: user?.jainAadharApplication?.name || "Unknown",
      jainAadharNumber,
      email: contact.email || user.email,
      phoneNumber: contact.number || user.phoneNumber,

      postMember: postMember || "Honorary Member",
      level: level || sangh.level,
      sanghType: sanghType || sangh.sanghType || "main",

      userImage,
      memberScreenshot,
      description: description || "",

      amount: isPaidMember ? existingMember.amount || 0 : 0,
      paymentStatus: isPaidMember ? "paid" : "pending",
      paymentDate: isPaidMember ? existingMember.paymentDate : null,

      membershipStartDate,
      membershipEndDate,

      status: isPaidMember ? "active" : "inactive",
      isHonorary: true,

      address: {
        street: location.address || "",
        city: location.city || "",
        district: location.district || "",
        state: location.state || "",
        pincode: location.pinCode || "",
      },

      addedBy: req.user._id,
      addedAt: new Date(),
    };

    // 🔹 Push to honoraryMembers
    sangh.honoraryMembers.push(honoraryMember);

    // 🔹 Update user sanghRoles
    await User.findByIdAndUpdate(user._id, {
      $push: {
        sanghRoles: {
          sanghId: sangh._id,
          role: "honoraryMember",
          level: sangh.level,
          sanghType: sangh.sanghType || "main",
          addedAt: new Date(),
        },
      },
    });

    await sangh.save();

    return successResponse(
      res,
      {
        honoraryMember,
        sangh: {
          _id: sangh._id,
          name: sangh.name,
          level: sangh.level,
          totalHonoraryMembers: sangh.honoraryMembers.length,
        },
      },
      "Honorary member added successfully",
    );
  } catch (error) {
    console.error("Honorary member error:", error);
    return errorResponse(res, error.message, 500);
  }
});

const updateMemberDetails = asyncHandler(async (req, res) => {
  try {
    const { sanghId, memberId } = req.params;
    const updates = req.body;

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) {
      return errorResponse(res, "Sangh not found", 404);
    }

    const memberIndex = sangh.members.findIndex(
      (member) => member._id.toString() === memberId,
    );

    if (memberIndex === -1) {
      return errorResponse(res, "Member not found", 404);
    }

    const member = sangh.members[memberIndex];

    /* =======================
       ✅ MEMBER PHOTO UPDATE
    ======================= */
    if (req.files?.memberPhoto) {
      if (member.userImage) {
        await deleteS3File(member.userImage);
      }

      const s3Url = req.files.memberPhoto[0].location;
      updates.userImage = convertS3UrlToCDN(s3Url);
    }

    /* =======================
       ✅ PAYMENT SCREENSHOT UPDATE
    ======================= */
    if (req.files?.memberScreenshot) {
      if (member.memberScreenshot) {
        await deleteS3File(member.memberScreenshot);
      }

      const screenshotS3Url = req.files.memberScreenshot[0].location;
      updates.memberScreenshot = convertS3UrlToCDN(screenshotS3Url);
    }

    /* =======================
       ✅ ADDRESS UPDATE
    ======================= */
    member.address = {
      ...member.address,
      street: updates.street ?? member.address?.street,
      district: updates.district ?? member.address?.district,
      state: updates.state ?? member.address?.state,
      pincode: updates.pincode ?? member.address?.pincode,
    };

    /* =======================
       ✅ PAYMENT STATUS LOGIC
    ======================= */
    let newPaymentStatus = updates.paymentStatus;

    // frontend se array aa jaye to
    if (Array.isArray(newPaymentStatus)) {
      newPaymentStatus = newPaymentStatus[newPaymentStatus.length - 1];
    }

    const wasPaidBefore = member.paymentStatus === "paid";
    const isPaidNow = newPaymentStatus === "paid";

    // ✅ pehli baar paid hua
    if (isPaidNow && !wasPaidBefore) {
      member.paymentDate = new Date();
      member.status = "active";
      // ✅ FY renewal (additive): kis FY ka payment hua wo mark karo, taaki
      // agle FY me lazy-reset ise renewal ke liye pending kar sake.
      const _pd = member.paymentDate;
      const _sy =
        _pd.getMonth() >= 3 ? _pd.getFullYear() : _pd.getFullYear() - 1;
      const _startY = _sy < 2026 ? 2026 : _sy; // system 2026-27 se start
      member.lastPaidFY =
        _startY + "-" + String((_startY + 1) % 100).padStart(2, "0");
    }

    /* =======================
       ✅ MAIN FIELD UPDATE
    ======================= */
    Object.assign(member, {
      name: updates.name ?? member.name,
      email: updates.email ?? member.email,
      phoneNumber: updates.phoneNumber ?? member.phoneNumber,
      postMember: updates.postMember ?? member.postMember,
      level: updates.level ?? member.level,
      sanghType: updates.sanghType ?? member.sanghType,
      userImage: updates.userImage ?? member.userImage,
      memberScreenshot: updates.memberScreenshot ?? member.memberScreenshot,
      paymentStatus: newPaymentStatus ?? member.paymentStatus,
    });

    /* ==================================================
       ✅ NEW: SYNC HONORARY MEMBER PAYMENT STATUS
    ================================================== */
    if (isPaidNow && !wasPaidBefore && member.localSangh?.sanghId) {
      const localSangh = await HierarchicalSangh.findById(
        member.localSangh.sanghId,
      );

      if (localSangh && localSangh.honoraryMembers) {
        const honoraryIndex = localSangh.honoraryMembers.findIndex(
          (h) => h.jainAadharNumber === member.jainAadharNumber,
        );

        if (honoraryIndex !== -1) {
          // ✅ Update honorary member payment status
          localSangh.honoraryMembers[honoraryIndex].paymentStatus = "paid";
          localSangh.honoraryMembers[honoraryIndex].paymentDate = new Date();
          localSangh.honoraryMembers[honoraryIndex].status = "active";

          await localSangh.save();
          console.log("✅ Honorary member payment status synced in city sangh");
        }
      }
    }

    /* ==================================================
       ✅ PAYMENT DISTRIBUTION (pending → paid)
    ================================================== */
    if (isPaidNow && !wasPaidBefore && !member.paymentDistributed) {
      const user = await User.findById(member.userId).populate(
        "jainAadharApplication",
      );

      await distributeMemberPayment({
        member,
        user,
        sourceSangh: sangh,
      });

      member.paymentDistributed = true;
    }

    await sangh.save();

    return successResponse(res, member, "Member details updated successfully");
  } catch (error) {
    if (req.files) {
      await deleteS3Files(req.files);
    }
    return errorResponse(res, error.message, 500);
  }
});
// Remove member from Sangh
const removeSanghMember = asyncHandler(async (req, res) => {
  try {
    const { sanghId, memberId } = req.params;
    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) {
      return errorResponse(res, "Sangh not found", 404);
    }
    // For city Sanghs, maintain minimum 3 members
    if (sangh.level === "city" && sangh.members.length <= 3) {
      return errorResponse(
        res,
        "City Sangh must maintain at least 3 members",
        400,
      );
    }
    const memberToRemove = sangh.members.find(
      (member) => member._id.toString() === memberId,
    );
    if (!memberToRemove) {
      return errorResponse(res, "Member not found", 404);
    }
    // Remove member's role from User document
    await User.findByIdAndUpdate(memberToRemove.userId, {
      $pull: {
        sanghRoles: {
          sanghId: sangh._id,
        },
      },
    });
    sangh.members = sangh.members.filter(
      (member) => member._id.toString() !== memberId,
    );
    await sangh.save();
    return successResponse(res, sangh, "Member removed successfully");
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

// Get Sangh members
const getSanghMembers = asyncHandler(async (req, res) => {
  try {
    const { sanghId } = req.params;
    const { page = 1, limit = 10, search } = req.query;

    const sangh = await HierarchicalSangh.findById(sanghId).populate({
      path: "members.userId",
      select: "email phoneNumber",
    });

    if (!sangh) {
      return errorResponse(res, "Sangh not found", 404);
    }

    let members = sangh.members || [];

    // Apply search filter if provided
    if (search) {
      const searchRegex = new RegExp(search, "i");
      members = members.filter(
        (member) =>
          searchRegex.test(member.name) ||
          searchRegex.test(member.jainAadharNumber),
      );
    }

    // Apply pagination
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = parseInt(page) * parseInt(limit);
    const total = members.length;

    const paginatedMembers = members.slice(startIndex, endIndex);

    return successResponse(
      res,
      {
        members: paginatedMembers,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
      "Members retrieved successfully",
    );
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
      socialMedia,
    } = req.body;
    // console.log("Received Body:", req.body);
    // console.log("SanghType:", req.body.sanghType);
    // Validate sanghType
    if (!sanghType) {
      return errorResponse(res, "Sangh type is required.", 400);
    }
    // Validate sanghType
    if (!["women", "youth", "veerSena"].includes(sanghType)) {
      return errorResponse(
        res,
        'Invalid Sangh type. Must be "women", "youth", or "veerSena"',
        400,
      );
    }

    // If creating from a specialized Sangh, ensure the types match
    if (parentSangh) {
      if (
        parentSangh.sanghType !== "main" &&
        parentSangh.sanghType !== sanghType
      ) {
        return errorResponse(
          res,
          `You can only create a ${parentSangh.sanghType} Sangh as a ${parentSangh.sanghType} Sangh president`,
          400,
        );
      }
    }

    // Determine the parent main Sangh
    let parentMainSanghId = null;
    if (parentSangh) {
      if (parentSangh.sanghType === "main") {
        parentMainSanghId = parentSangh._id;
      } else {
        // If parent is already a specialized Sangh, use its parentMainSangh
        parentMainSanghId = parentSangh.parentMainSangh;
      }
    }
    // Check if a specialized Sangh of this type already exists at this level
    let locationQuery = {};

    // Build location query based on the level
    if (level === "state") {
      locationQuery = { "location.state": req.body.location.state };
    } else if (level === "district") {
      locationQuery = {
        "location.state": req.body.location.state,
        "location.district": req.body.location.district,
      };
    } else if (level === "city") {
      locationQuery = {
        "location.state": req.body.location.state,
        "location.district": req.body.location.district,
        "location.city": req.body.location.city,
      };
    } else if (level === "area") {
      locationQuery = {
        "location.state": req.body.location.state,
        "location.district": req.body.location.district,
        "location.city": req.body.location.city,
        "location.area": req.body.location.area,
      };
    }

    const existingSpecializedSangh = await HierarchicalSangh.findOne({
      level: level,
      ...locationQuery,
      sanghType: sanghType,
      status: "active",
    });

    if (existingSpecializedSangh) {
      return errorResponse(
        res,
        `A ${sanghType} Sangh already exists at this ${level} level in this location`,
        400,
      );
    }

    // Validate office bearers
    if (
      !officeBearers ||
      !officeBearers.president ||
      !officeBearers.secretary ||
      !officeBearers.treasurer
    ) {
      return errorResponse(res, "All office bearer details are required", 400);
    }

    // Format office bearers data
    const formattedOfficeBearers = [];
    for (const role of ["president", "secretary", "treasurer"]) {
      const bearer = officeBearers[role];
      // Find the user by Jain Aadhar
      const user = await User.findOne({
        jainAadharNumber: bearer.jainAadharNumber,
        jainAadharStatus: "verified",
      });

      if (!user) {
        return errorResponse(res, `${role}'s Jain Aadhar is not verified`, 400);
      }

      // Check if user is already an office bearer in another active Sangh
      const existingSangh = await HierarchicalSangh.findOne({
        officeBearers: {
          $elemMatch: {
            userId: user._id,
            status: "active",
          },
        },
        status: "active",
        ...(parentSangh ? { _id: { $ne: parentSangh._id } } : {}),
      });
      if (existingSangh) {
        return errorResponse(
          res,
          `${role} is already an office bearer in another Sangh`,
          400,
        );
      }

      // Format the name
      const formattedName = formatFullName(bearer.firstName, bearer.lastName);
      const documentUrl = bearer.document
        ? convertS3UrlToCDN(bearer.document)
        : "";
      const photoUrl = bearer.photo ? convertS3UrlToCDN(bearer.photo) : "";
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
        termEndDate: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000), // 2 years from now
        status: "active",
      });
    }

    // Create the specialized Sangh
    const specializedSangh = new HierarchicalSangh({
      name,
      level: level, // Same level as parent Sangh
      location: req.body.location, // Same location as parent Sangh
      parentSangh: level === "country" ? null : parentSangh._id, // Country level Sanghs don't have parent
      parentMainSangh: level === "country" ? null : parentMainSanghId, // Country level Sanghs don't have parent
      sanghType: sanghType,
      officeBearers: formattedOfficeBearers,
      description,
      contact,
      socialMedia,
      createdBy: req.user._id,
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
            addedAt: new Date(),
          },
        },
      });
    }

    return successResponse(res, {
      message: `${sanghType.charAt(0).toUpperCase() + sanghType.slice(1)} Sangh created successfully`,
      sangh: specializedSangh,
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
      sanghType: "main",
      status: "active",
    });

    if (!mainSangh) {
      return errorResponse(res, "Main Sangh not found", 404);
    }

    // Find specialized Sanghs
    const specializedSanghs = await HierarchicalSangh.find({
      parentMainSangh: sanghId,
      status: "active",
    }).select("-__v");

    // Convert S3 files (if needed) for each specialized Sangh
    const convertedSanghs = await Promise.all(
      specializedSanghs.map(async (sangh) => {
        const convertedOfficeBearers = await Promise.all(
          sangh.officeBearers.map(async (bearer) => {
            if (bearer.document && bearer.document.startsWith("https://")) {
              // Replace S3 link with a converted one if necessary
              bearer.document = await convertS3File(bearer.document);
            }
            if (bearer.photo && bearer.photo.startsWith("https://")) {
              // Replace S3 link with a converted one if necessary
              bearer.photo = await convertS3File(bearer.photo);
            }
            return bearer;
          }),
        );

        // Return the updated sangh object with converted office bearers
        return { ...sangh.toObject(), officeBearers: convertedOfficeBearers };
      }),
    );

    return successResponse(res, {
      mainSangh: {
        _id: mainSangh._id,
        name: mainSangh.name,
        level: mainSangh.level,
        location: mainSangh.location,
      },
      specializedSanghs: convertedSanghs,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// Update specialized Sangh
const updateSpecializedSangh = asyncHandler(async (req, res) => {
  try {
    const sangh = req.sangh; // From canManageSpecializedSangh middleware
    const { name, description, contact, socialMedia, officeBearers } = req.body;

    // Create an updates object
    const updates = {};

    // Basic info updates
    if (name) updates.name = name;
    if (description) updates.description = description;
    if (contact) updates.contact = contact;
    if (socialMedia) updates.socialMedia = socialMedia;

    // Handle office bearer updates if provided
    if (officeBearers) {
      for (const role of ["president", "secretary", "treasurer"]) {
        if (officeBearers[role]) {
          const bearer = officeBearers[role];
          const currentBearer = sangh.officeBearers.find(
            (b) => b.role === role,
          );
          // If changing the office bearer
          if (
            bearer.jainAadharNumber &&
            bearer.jainAadharNumber !== currentBearer.jainAadharNumber
          ) {
            // Find the user by Jain Aadhar
            const user = await User.findOne({
              jainAadharNumber: bearer.jainAadharNumber,
              jainAadharStatus: "verified",
            });

            if (!user) {
              return errorResponse(
                res,
                `${role}'s Jain Aadhar is not verified`,
                400,
              );
            }

            // Check if user is already an office bearer in another active Sangh
            const existingSangh = await HierarchicalSangh.findOne({
              officeBearers: {
                $elemMatch: {
                  userId: user._id,
                  status: "active",
                },
              },
              status: "active",
              _id: { $ne: sangh._id },
            });

            if (existingSangh) {
              return errorResponse(
                res,
                `${role} is already an office bearer in another Sangh`,
                400,
              );
            }

            // Format the name
            const formattedName = formatFullName(
              bearer.firstName,
              bearer.lastName,
            );

            // Remove role from current office bearer's sanghRoles
            if (currentBearer) {
              await User.findByIdAndUpdate(currentBearer.userId, {
                $pull: {
                  sanghRoles: {
                    sanghId: sangh._id,
                    role: role,
                  },
                },
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
                  addedAt: new Date(),
                },
              },
            });

            // Update the office bearer in the Sangh
            await HierarchicalSangh.updateOne(
              {
                _id: sangh._id,
                "officeBearers.role": role,
              },
              {
                $set: {
                  "officeBearers.$.userId": user._id,
                  "officeBearers.$.firstName": bearer.firstName,
                  "officeBearers.$.lastName": bearer.lastName,
                  "officeBearers.$.name": formattedName,
                  "officeBearers.$.jainAadharNumber": bearer.jainAadharNumber,
                  "officeBearers.$.appointmentDate": new Date(),
                  "officeBearers.$.termEndDate": new Date(
                    Date.now() + 2 * 365 * 24 * 60 * 60 * 1000,
                  ), // 2 years from now
                },
              },
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
                  "officeBearers.role": role,
                },
                {
                  $set: {
                    "officeBearers.$.firstName": firstName,
                    "officeBearers.$.lastName": lastName,
                    "officeBearers.$.name": formattedName,
                  },
                },
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
                "officeBearers.role": role,
              },
              {
                $set: {
                  "officeBearers.$.document":
                    req.files[`${role}JainAadhar`][0].location,
                },
              },
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
                "officeBearers.role": role,
              },
              {
                $set: {
                  "officeBearers.$.photo":
                    req.files[`${role}Photo`][0].location,
                },
              },
            );
          }
        }
      }
    }

    // Get the updated Sangh
    const updatedSangh = await HierarchicalSangh.findById(sangh._id);

    return successResponse(res, {
      message: "Specialized Sangh updated successfully",
      sangh: updatedSangh,
    });
  } catch (error) {
    if (req.files) {
      await deleteS3Files(req.files);
    }
    return errorResponse(res, error.message, 500);
  }
});

let memberFrontTemplate;
let memberBackTemplate;

// ===== Preload Templates =====
async function loadMemberTemplates() {
  try {
    memberFrontTemplate = await loadImage(
      path.join(__dirname, "../../Public/member_1.png"),
    );

    memberBackTemplate = await loadImage(
      path.join(__dirname, "../../Public/member_2.png"),
    );

    //console.log("✅ Member card templates loaded");
  } catch (err) {
    console.error("❌ Template load error:", err);
  }
}

loadMemberTemplates();

// ================= GENERATE MEMBER CARD =================

const generateMemberCard = async (req, res) => {
  try {
    const { userId } = req.params;

    let user;
    let sangh;

    // ===== Check in regular members =====
    sangh = await HierarchicalSangh.findOne({ "members.userId": userId });

    if (sangh) {
      user = sangh.members.find((m) => m.userId.toString() === userId);
    }

    // ===== If not found check officeBearers =====
    if (!user) {
      sangh = await HierarchicalSangh.findOne({
        "officeBearers.userId": userId,
      });

      if (sangh) {
        user = sangh.officeBearers.find((m) => m.userId.toString() === userId);
      }
    }

    // ===== If still not found =====
    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found in members or officeBearers." });
    }

    // ===== Membership Number =====
    function getRandomThreeDigitNumber() {
      return Math.floor(100 + Math.random() * 900);
    }

    const level = sangh.level || "unknown";
    const randomNum = getRandomThreeDigitNumber();

    const membershipNumber = `${level}/00${randomNum
      .toString()
      .padStart(3, "0")}`;

    // ===== Canvas setup =====
    const width = 1011;
    const height = 639;

    const combinedCanvas = createCanvas(width, height * 2);
    const ctx = combinedCanvas.getContext("2d");

    // ===== FRONT TEMPLATE =====
    ctx.drawImage(memberFrontTemplate, 0, 0, width, height);

    // ===== USER IMAGE =====
    if (user.userImage) {
      try {
        const response = await axios.get(user.userImage, {
          responseType: "arraybuffer",
          timeout: 5000,
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        });

        const resizedBuffer = await sharp(response.data)
          .resize(220, 260)
          .jpeg({ quality: 80 })
          .toBuffer();

        const userPhoto = await loadImage(resizedBuffer);

        ctx.drawImage(userPhoto, 60, 210, 225, 280);
      } catch (err) {
        console.error("Error loading user photo:", err.message);
      }
    }

    ctx.fillStyle = "#0F2A4A";
    ctx.font = "25px Georgia";

    ctx.fillText(`${user.name || ""}`, 670, 243);
    ctx.fillText(`${membershipNumber}`, 670, 315);

    // ===== postMember logic =====
    let postText = user.postMember || user.description || "";

    // agar member ka userId officeBearers me bhi hai to postMember ki jagah role
    const officeBearerEntry = sangh.officeBearers?.find(
      (ob) => ob.userId.toString() === userId,
    );

    if (officeBearerEntry && officeBearerEntry.role) {
      postText =
        officeBearerEntry.role.charAt(0).toUpperCase() +
        officeBearerEntry.role.slice(1);
    }

    ctx.fillText(`${postText}`, 670, 388);

    if (user.jainAadharNumber)
      ctx.fillText(`${user.jainAadharNumber}`, 670, 460);

    // ===== Bottom Created By =====
    ctx.font = "bold 24px Georgia";
    ctx.textAlign = "center";
    ctx.fillStyle = "#0F2A4A";

    ctx.fillText(`Reg. No: DL/2025/0487190`, width / 2, height - 122);

    // ===== Issue Date & Valid Upto (member ki membership dates) =====
    const memberEntry = sangh.members?.find(
      (m) => m.userId.toString() === userId,
    );

    const formatDate = (d) => {
      if (!d) return "";
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return "";
      const dd = String(dt.getDate()).padStart(2, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const yyyy = dt.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    const issueDate = formatDate(memberEntry?.membershipStartDate);
    const validUpto = formatDate(memberEntry?.membershipEndDate);

    ctx.font = "22px Georgia";
    ctx.textAlign = "left";
    ctx.fillStyle = "#FFFFFF";

    ctx.fillText(issueDate, 135, 610); // Issue Date label ke neeche
    ctx.fillText(validUpto, 325, 610); // Valid Upto label ke neeche

    // ===== BACK TEMPLATE =====
    ctx.drawImage(memberBackTemplate, 0, height, width, height);

    ctx.font = "23px Georgia";
    ctx.fillStyle = "black";
    ctx.textAlign = "left";

    const addr = user.address || {};

    const line1 = addr.street || "";
    const line2 = `${addr.city || ""} ${addr.state || ""},  ${
      addr.pincode || ""
    }`;

    ctx.fillText(line1, 422, height + 260);
    ctx.fillText(line2, 422, height + 290);

    // ===== RESPONSE =====
    res.setHeader("Content-Type", "image/jpeg");

    combinedCanvas.createJPEGStream().pipe(res);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Failed to generate member card",
      error: err.message,
    });
  }
};
const generateMembersCard = async (req, res) => {
  try {
    const { userId } = req.params;

    let user;
    let sangh;

    // ===== Check in regular members =====
    sangh = await HierarchicalSangh.findOne({ "members.userId": userId });
    if (sangh) {
      user = sangh.members.find((m) => m.userId.toString() === userId);
    }

    // ===== If not found, check in foundation officeBearers =====
    if (!user) {
      sangh = await HierarchicalSangh.findOne({
        "officeBearers.userId": userId,
      });
      if (sangh) {
        user = sangh.officeBearers.find((m) => m.userId.toString() === userId);
      }
    }

    // ===== If still not found, return 404 =====
    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found in members or officeBearers." });
    }

    // Generate membership number
    function getRandomThreeDigitNumber() {
      return Math.floor(100 + Math.random() * 900);
    }
    const level = sangh.level || "unknown";
    const randomNum = getRandomThreeDigitNumber();
    const membershipNumber = `${level}/00${randomNum.toString().padStart(3, "0")}`;

    // ===== Canvas setup =====
    const width = 1011;
    const height = 639;
    const combinedCanvas = createCanvas(width, height * 2);
    const ctx = combinedCanvas.getContext("2d");

    const frontTemplate = await loadImage(
      path.join(__dirname, "../../Public/member_front.jpg"),
    );
    const backTemplate = await loadImage(
      path.join(__dirname, "../../Public/member_back.jpg"),
    );

    // ===== FRONT =====
    ctx.drawImage(frontTemplate, 0, 0, width, height);

    // Load photo if exists
    if (user.photo) {
      try {
        const response = await axios.get(user.photo, {
          responseType: "arraybuffer",
        });
        const imageBuffer = Buffer.from(response.data, "binary");
        const userPhoto = await loadImage(imageBuffer);
        ctx.drawImage(userPhoto, 65, 180, 220, 260);
      } catch (err) {
        console.error("Error loading user photo:", err);
      }
    }

    ctx.fillStyle = "black";
    ctx.font = "26px Georgia";
    ctx.textAlign = "left";
    const fullName = `${user.firstName || user.name || ""} ${user.lastName || ""}`;
    ctx.fillText(fullName, 570, 196);
    ctx.fillText(membershipNumber, 570, 260);
    ctx.fillText(user.postMember || "", 570, 317);
    if (user.jainAadharNumber) ctx.fillText(user.jainAadharNumber, 570, 380);

    // Created By - bottom center
    function getRandomFourDigitNumber() {
      return Math.floor(1000 + Math.random() * 9000);
    }
    const createdByText = `Created By: ${level}/JA${getRandomFourDigitNumber()}`;
    ctx.font = "bold 28px Georgia";
    ctx.textAlign = "center";
    ctx.fillStyle = "black";
    ctx.fillText(createdByText, width / 2, height - 90);

    // ===== BACK =====
    ctx.drawImage(backTemplate, 0, height, width, height);
    ctx.font = "26px Georgia";
    ctx.textAlign = "left";
    ctx.fillStyle = "black";

    // Address
    if (
      user.address &&
      typeof user.address === "object" &&
      !Array.isArray(user.address)
    ) {
      const {
        street = "",
        city = "",
        district = "",
        state = "",
        pincode = "",
      } = user.address;
      let currentY = height + 182;

      if (street) {
        ctx.fillText(street, 100, currentY);
        currentY += 35;
      }
      if (city) {
        ctx.fillText(city, 100, currentY);
        currentY += 35;
      }
      if (district) {
        ctx.fillText(district, 100, currentY);
        currentY += 35;
      }
      if (state) {
        ctx.fillText(state, 100, currentY);
        currentY += 35;
      }
      if (pincode) {
        ctx.fillText(pincode, 100, currentY);
      }
    } else {
      ctx.fillText("Address: Not Available", 100, height + 182);
    }

    // Contact info
    // let contactY = height + 350;
    // if (user.phoneNumber) { ctx.fillText(`Phone: ${user.phoneNumber}`, 100, contactY); contactY += 35; }
    // if (user.email) { ctx.fillText(`Email: ${user.email}`, 100, contactY); }

    // ===== Send image response =====
    res.setHeader("Content-Type", "image/jpeg");
    combinedCanvas.createJPEGStream().pipe(res);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to generate member card", error: err.message });
  }
};

// POST /api/hierarchical-sangh/:sanghId/follow
const followSangh = asyncHandler(async (req, res) => {
  const { sanghId } = req.params;
  const userId = req.user._id;

  const sangh = await HierarchicalSangh.findById(sanghId);
  if (!sangh) {
    return res.status(404).json({ message: "Sangh not found" });
  }

  if (sangh.followers.includes(userId)) {
    return res.status(400).json({ message: "Already following" });
  }

  // Add user to sangh's followers
  sangh.followers.push(userId);
  await sangh.save();

  // ✅ ALSO: Add sanghId to user's `followedSanghs` (or `friends` if you insist)
  await User.findByIdAndUpdate(userId, {
    $addToSet: { followedSanghs: sanghId },
  });

  res.status(200).json({
    message: "Followed successfully",
    followersCount: sangh.followers.length,
  });
});

const unfollowSangh = asyncHandler(async (req, res) => {
  const { sanghId } = req.params;
  const userId = req.user._id;

  const sangh = await HierarchicalSangh.findById(sanghId);
  if (!sangh) return res.status(404).json({ message: "Sangh not found" });

  sangh.followers = sangh.followers.filter(
    (id) => id.toString() !== userId.toString(),
  );
  await sangh.save();

  res.status(200).json({
    message: "Unfollowed successfully",
    followersCount: sangh.followers.length,
  });
});

let letterheadTemplate;
let letterheadFont = "Georgia";

async function loadLetterheadTemplate() {
  try {
    // Blank letterhead template (1414 x 2000)
    letterheadTemplate = await loadImage(
      path.join(__dirname, "../../Public/letterhead_blank.jpeg"),
    );

    // Optional Devanagari font (needed if name/role/sangh name is in Hindi)
    try {
      const { registerFont } = require("canvas");
      const devFontPath = path.join(
        __dirname,
        "../../Public/fonts/NotoSansDevanagari-Bold.ttf",
      );
      if (fs.existsSync(devFontPath)) {
        registerFont(devFontPath, { family: "NotoDev" });
        letterheadFont = "NotoDev";
      }
    } catch (fontErr) {
      console.error("Letterhead font load skipped:", fontErr.message);
    }
  } catch (err) {
    console.error("Letterhead template load error:", err);
  }
}

loadLetterheadTemplate();

// wrap text into lines that fit maxWidth
function lhWrapText(ctx, text, maxWidth, maxLines) {
  if (!text) return [];
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (maxLines && lines.length === maxLines) return lines;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return maxLines ? lines.slice(0, maxLines) : lines;
}

const generateLetterhead = async (req, res) => {
  try {
    const { userId } = req.params;

    let user;
    let sangh;

    // ===== Check in officeBearers first (letterhead is for post holders) =====
    sangh = await HierarchicalSangh.findOne({ "officeBearers.userId": userId });

    if (sangh) {
      user = sangh.officeBearers.find((m) => m.userId.toString() === userId);
    }

    // ===== Fallback: regular members =====
    if (!user) {
      sangh = await HierarchicalSangh.findOne({ "members.userId": userId });
      if (sangh) {
        user = sangh.members.find((m) => m.userId.toString() === userId);
      }
    }

    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found in members or officeBearers." });
    }
    // ===== Fill missing contact details from User collection =====
    let dbUser = null;
    if (!user.email || !user.phoneNumber || !user.userImage) {
      try {
        dbUser = await User.findById(userId).select(
          "fullName email phoneNumber profilePicture city district state",
        );
      } catch (e) {
        console.error("Letterhead user lookup failed:", e.message);
      }
    }

    const name = user.name || dbUser?.fullName || "";
    const email = user.email || dbUser?.email || "";
    const phone = user.phoneNumber || dbUser?.phoneNumber || "";
    const photoUrl = user.userImage || dbUser?.profilePicture || "";

    // ===== Role text =====
    const officeBearerEntry = sangh.officeBearers?.find(
      (ob) => ob.userId.toString() === userId,
    );

    let roleText = user.postMember || user.description || "Member";
    if (officeBearerEntry && officeBearerEntry.role) {
      roleText =
        officeBearerEntry.role.charAt(0).toUpperCase() +
        officeBearerEntry.role.slice(1);
    }

    const sanghName = sangh.name || "";

    // ===== Address =====
    const addr = user.address || {};
    const addressParts = [
      addr.street,
      addr.city || dbUser?.city,
      addr.district || dbUser?.district,
      addr.state || dbUser?.state,
      addr.pincode,
    ].filter(Boolean);
    const addressText = addressParts.join(", ");

    // ===== Canvas setup =====
    const width = 1414;
    const height = 2000;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    if (letterheadTemplate) {
      ctx.drawImage(letterheadTemplate, 0, 0, width, height);
    } else {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
    }

    // ================= TOP RIGHT CONTACT BLOCK (white on red) =================
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";

    // Address (max 2 lines, next to the location icon)
    ctx.font = `bold 24px ${letterheadFont}`;
    const addrLines = lhWrapText(ctx, addressText, 250, 2);
    let addrY = 88;
    for (const line of addrLines) {
      ctx.fillText(line, 1145, addrY);
      addrY += 34;
    }

    // Phone (next to the phone icon)
    if (phone) {
      ctx.font = `bold 26px ${letterheadFont}`;
      ctx.fillText(String(phone), 1145, 182);
    }

    // Email
    if (email) {
      ctx.font = `20px ${letterheadFont}`;
      ctx.fillText(String(email), 1119, 228);
    }

    // ================= LEFT SIDEBAR (photo + name + role + sangh) =================
    const photoCx = 123;
    const photoCy = 368;
    const photoR = 97;

    if (photoUrl) {
      try {
        const response = await axios.get(photoUrl, {
          responseType: "arraybuffer",
          timeout: 5000,
          headers: { "User-Agent": "Mozilla/5.0" },
        });

        const resizedBuffer = await sharp(response.data)
          .resize(photoR * 2, photoR * 2, { fit: "cover" })
          .jpeg({ quality: 85 })
          .toBuffer();

        const userPhoto = await loadImage(resizedBuffer);

        ctx.save();
        ctx.beginPath();
        ctx.arc(photoCx, photoCy, photoR, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(
          userPhoto,
          photoCx - photoR,
          photoCy - photoR,
          photoR * 2,
          photoR * 2,
        );
        ctx.restore();
      } catch (err) {
        console.error("Letterhead photo load error:", err.message);
      }
    }

    ctx.textAlign = "center";

    // Name (red)
    ctx.fillStyle = "#E53935";
    ctx.font = `bold 30px ${letterheadFont}`;
    ctx.fillText(name, 120, 515);

    // Role
    ctx.fillStyle = "#1A1A1A";
    ctx.font = `bold 25px ${letterheadFont}`;
    ctx.fillText(roleText, 120, 549);

    // Sangh name (wraps up to 2 lines)
    ctx.font = `bold 23px ${letterheadFont}`;
    const sanghLines = lhWrapText(ctx, sanghName, 215, 2);
    let sanghY = 580;
    for (const line of sanghLines) {
      ctx.fillText(line, 120, sanghY);
      sanghY += 28;
    }

    // ===== RESPONSE =====
    res.setHeader("Content-Type", "image/jpeg");
    canvas.createJPEGStream({ quality: 0.92 }).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to generate letterhead",
      error: err.message,
    });
  }
};


const { registerFont } = require("canvas");

const AL_FONT = "Noto Sans Devanagari"; // font ka ASLI family name

const AL_FONT_DIRS = [
  path.join(__dirname, "../../public/fonts"),
  path.join(__dirname, "../../fonts"),
  path.join(__dirname, "../fonts"),
  path.join(__dirname, "fonts"),
  path.join(process.cwd(), "public/fonts"),
  path.join(process.cwd(), "fonts"),
  path.join(process.cwd(), "assets/fonts"),
];

/** Diye gaye file names me se jo pehle mil jaye, uska poora path do */
const alFindFont = (...fileNames) => {
  for (const dir of AL_FONT_DIRS) {
    for (const file of fileNames) {
      const full = path.join(dir, file);
      try {
        if (fs.existsSync(full)) return full;
      } catch (e) {
        // ignore
      }
    }
  }
  return null;
};

(() => {
  const regularPath = alFindFont(
    "NotoSansDevanagari-Regular.ttf",
    "NotoSansDevanagari.ttf",
  );
  const boldPath = alFindFont("NotoSansDevanagari-Bold.ttf");

  if (!regularPath) {
    console.error(
      "❌ NotoSansDevanagari-Regular.ttf nahi mili. Ye folders check kiye:\n" +
        AL_FONT_DIRS.join("\n"),
    );
    return;
  }

  // Regular
  try {
    registerFont(regularPath, { family: AL_FONT, weight: "normal" });
    console.log("✅ Devanagari regular registered:", regularPath);
  } catch (e) {
    console.error("❌ Devanagari regular register failed:", e.message);
  }

  /**
   * Bold.
   * ⚠️ Zaroori: agar Bold file na ho to bhi bold weight par REGULAR file
   * hi register kar dete hain. Warna `bold 24px NotoDev` wale saare
   * headings default font par chale jate hain aur dobara □□□ dikhne
   * lagte hain — bold text me Hindi tootne ka yahi karan hota hai.
   */
  try {
    registerFont(boldPath || regularPath, { family: AL_FONT, weight: "bold" });
    // console.log(
    //   boldPath
    //     ? "✅ Devanagari bold registered: " + boldPath
    //     : "⚠️ Bold file nahi mili — bold ke liye Regular hi use hogi (Hindi phir bhi sahi dikhegi)",
    // );
  } catch (e) {
    console.error("❌ Devanagari bold register failed:", e.message);
  }
})();

const AL_SIGN_DIRS = [
  path.join(__dirname, "../../public"),
  path.join(__dirname, "../../public/images"),
  path.join(__dirname, "../../public/signature"),
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "public/images"),
];

/**
 * Fixed naam ki list ki jagah ab FOLDER SCAN karte hain.
 *
 * Kyun: Windows extensions chhupa deta hai, isliye "signature.png"
 * dikhne wali file asal me "signature.png.png" ya "signature.jpg" ho
 * sakti hai. Folder scan karne se ye chakkar hi khatam.
 */
const alFindSign = () => {
  const imgExt = [".png", ".jpg", ".jpeg", ".webp"];

  for (const dir of AL_SIGN_DIRS) {
    let files = [];
    try {
      if (!fs.existsSync(dir)) continue;
      files = fs.readdirSync(dir);
    } catch (e) {
      continue;
    }

    // debug: folder me kya-kya image files hain
    const images = files.filter((f) =>
      imgExt.includes(path.extname(f).toLowerCase()),
    );
    if (images.length) {
      console.log(`📁 ${dir} me images:`, images.join(", "));
    }

    // "sign" ya "vivek" wala koi bhi image file chalega (case-insensitive)
    const match = images.find((f) => {
      const lower = f.toLowerCase();
      return lower.includes("sign") || lower.includes("vivek");
    });

    if (match) return path.join(dir, match);
  }
  return null;
};

let appointmentSignImage = null;

const loadAppointmentSign = async () => {
  if (appointmentSignImage) return appointmentSignImage;
  // Pehle yahan ek "tried" flag tha jo fail hone par dobara koshish nahi
  // karta tha. Usse file baad me daalne par server restart karna padta.
  // Ab har baar retry hota hai (mil jane par cache ho jata hai).

  const signPath = alFindSign();
  if (!signPath) {
    console.error(
      "⚠️ Signature image nahi mili. Ye folders check kiye:\n" +
        AL_SIGN_DIRS.join("\n"),
    );
    return null;
  }

  try {
    appointmentSignImage = await loadImage(signPath);
    console.log("✅ Signature loaded:", signPath);
  } catch (e) {
    console.error("❌ Signature load failed:", e.message);
    appointmentSignImage = null;
  }
  return appointmentSignImage;
};

const AL = {
  bodyX: 268, // left sidebar / vertical line ke baad
  bodyMaxW: 1080,
  startY: 330, // template ki date line ke NEECHE se shuru
  lineH: 36,
  pointLineH: 32,
  fontSize: 24,
  labelSize: 25,
  // Template me "दिनांक-" already chhapa hua hai (canvas y ~294).
  // Value uske aage right-aligned rakhi hai taaki canvas se bahar na jaye.
  dateX: 1405,
  dateY: 294,
  dateSize: 20,
  // Top-right contact block (letterhead ke same coordinates)
  addrX: 1145,
  addrY: 88,
  addrMaxW: 250,
  phoneY: 182,
  emailX: 1119,
  emailY: 228,
  // Left sidebar photo
  photoCx: 123,
  photoCy: 368,
  photoR: 97,
  signW: 210,
  signH: 100,
  footerSafeY: 1740, // isse niche kuch draw nahi karna
};

/** Text ko maxWidth me todkar lines ka array deta hai */
const alWrapText = (ctx, text, maxWidth) => {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
};

/** Wrapped paragraph draw karke nayi y return karta hai */
const alDrawParagraph = (ctx, text, x, y, maxWidth, lineH, indent = 0) => {
  const lines = alWrapText(ctx, text, maxWidth - indent);
  let curY = y;
  for (let i = 0; i < lines.length; i++) {
    if (curY > AL.footerSafeY) break; // footer par overflow na ho
    ctx.fillText(lines[i], i === 0 ? x : x + indent, curY);
    curY += lineH;
  }
  return curY;
};

/** dd-mm-yyyy */
const alFormatDate = (d = new Date()) =>
  `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(
    2,
    "0",
  )}-${d.getFullYear()}`;

const generateAppointmentLetter = async (req, res) => {
  try {
    const { userId } = req.params;

    let user;
    let sangh;

    // ===== officeBearers me dhoondo =====
    sangh = await HierarchicalSangh.findOne({ "officeBearers.userId": userId });
    if (sangh) {
      user = sangh.officeBearers.find((m) => m.userId.toString() === userId);
    }

    // ===== Fallback: regular members =====
    if (!user) {
      sangh = await HierarchicalSangh.findOne({ "members.userId": userId });
      if (sangh) {
        user = sangh.members.find((m) => m.userId.toString() === userId);
      }
    }

    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found in members or officeBearers." });
    }

    // ===== User collection se missing details =====
    let dbUser = null;
    try {
      dbUser = await User.findById(userId).select(
        "fullName email phoneNumber profilePicture gender location",
      );
    } catch (e) {
      console.error("Appointment letter user lookup failed:", e.message);
    }

    const name = user.name || dbUser?.fullName || "";
    const email = user.email || dbUser?.email || "";
    const phone = user.phoneNumber || dbUser?.phoneNumber || "";
    const photoUrl = user.userImage || dbUser?.profilePicture || "";
    const gender = String(dbUser?.gender || "").toLowerCase();
    const salutation = gender === "female" ? "श्रीमती/सुश्री" : "श्री";

    // ===== Role =====
    const officeBearerEntry = sangh.officeBearers?.find(
      (ob) => ob.userId.toString() === userId,
    );

    let roleText = user.postMember || user.description || "Member";
    if (officeBearerEntry && officeBearerEntry.role) {
      roleText =
        officeBearerEntry.role.charAt(0).toUpperCase() +
        officeBearerEntry.role.slice(1);
    }

    const sanghName = sangh.name || "";

    // ===== Address =====
    const addr = user.address || {};
    const loc = dbUser?.location || {};
    const residence = addr.street || "";
    const cityText = addr.city || loc.city || "";
    const districtText = addr.district || loc.district || "";
    const stateText = addr.state || loc.state || "";

    // ===== Canvas =====
    const width = 1414;
    const height = 2000;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    if (letterheadTemplate) {
      ctx.drawImage(letterheadTemplate, 0, 0, width, height);
    } else {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
    }

    // ================= DATE =================
    // Template me "दिनांक-" pehle se chhapa hai, isliye sirf VALUE draw
    // karte hain — uske theek aage, right-aligned.
    ctx.fillStyle = "#1A1A1A";
    ctx.textAlign = "right";
    ctx.font = `bold ${AL.dateSize}px ${AL_FONT}`;
    ctx.fillText(alFormatDate(), AL.dateX, AL.dateY);

    // ========== TOP RIGHT CONTACT BLOCK (icons ke aage, white text) ==========
    // Ye block generateLetterhead se copy kiya gaya hai — wahi coordinates.
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";

    const addressText = [
      addr.street,
      cityText,
      districtText,
      stateText,
      addr.pincode,
    ]
      .filter(Boolean)
      .join(", ");

    ctx.font = `bold 24px ${AL_FONT}`;
    const addrLines = alWrapText(ctx, addressText, AL.addrMaxW).slice(0, 2);
    let addrY = AL.addrY;
    for (const line of addrLines) {
      ctx.fillText(line, AL.addrX, addrY);
      addrY += 34;
    }

    if (phone) {
      ctx.font = `bold 26px ${AL_FONT}`;
      ctx.fillText(String(phone), AL.addrX, AL.phoneY);
    }

    if (email) {
      ctx.font = `20px ${AL_FONT}`;
      ctx.fillText(String(email), AL.emailX, AL.emailY);
    }

    // ========== LEFT SIDEBAR (photo + name + role + sangh) ==========
    // Ye bhi generateLetterhead se hi copy kiya gaya hai.
    if (photoUrl) {
      try {
        const response = await axios.get(photoUrl, {
          responseType: "arraybuffer",
          timeout: 5000,
          headers: { "User-Agent": "Mozilla/5.0" },
        });

        const resizedBuffer = await sharp(response.data)
          .resize(AL.photoR * 2, AL.photoR * 2, { fit: "cover" })
          .jpeg({ quality: 85 })
          .toBuffer();

        const userPhoto = await loadImage(resizedBuffer);

        ctx.save();
        ctx.beginPath();
        ctx.arc(AL.photoCx, AL.photoCy, AL.photoR, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(
          userPhoto,
          AL.photoCx - AL.photoR,
          AL.photoCy - AL.photoR,
          AL.photoR * 2,
          AL.photoR * 2,
        );
        ctx.restore();
      } catch (err) {
        console.error("Appointment letter photo load error:", err.message);
      }
    }

    ctx.textAlign = "center";

    ctx.fillStyle = "#E53935";
    ctx.font = `bold 30px ${AL_FONT}`;
    ctx.fillText(name, 120, 515);

    ctx.fillStyle = "#1A1A1A";
    ctx.font = `bold 25px ${AL_FONT}`;
    ctx.fillText(roleText, 120, 549);

    ctx.font = `bold 23px ${AL_FONT}`;
    const sanghLines = alWrapText(ctx, sanghName, 215).slice(0, 2);
    let sanghY = 580;
    for (const line of sanghLines) {
      ctx.fillText(line, 120, sanghY);
      sanghY += 28;
    }

    // body ke liye alignment/colour reset
    ctx.textAlign = "left";

    // ================= BODY =================
    ctx.fillStyle = "#1A1A1A";
    let y = AL.startY;

    // आदरणीय श्री ... जी,
    ctx.font = `bold ${AL.labelSize}px ${AL_FONT}`;
    ctx.fillText(`आदरणीय ${salutation} ${name} जी,`, AL.bodyX, y);
    y += AL.lineH + 4;

    // निवासी / शहर / जिला / राज्य / संघ / पद
    const infoRows = [
      ["निवासी", residence],
      ["शहर", cityText],
      ["जिला", districtText],
      ["राज्य", stateText],
      ["संघ का नाम", sanghName],
      ["पद", roleText],
    ];

    for (const [label, value] of infoRows) {
      ctx.font = `bold ${AL.fontSize}px ${AL_FONT}`;
      const labelText = `${label} : `;
      ctx.fillText(labelText, AL.bodyX, y);

      const labelW = ctx.measureText(labelText).width;
      ctx.font = `${AL.fontSize}px ${AL_FONT}`;
      const valLines = alWrapText(
        ctx,
        String(value || "—"),
        AL.bodyMaxW - labelW,
      );
      ctx.fillText(valLines[0] || "", AL.bodyX + labelW, y);
      y += AL.lineH - 4;

      // agar value lambi ho to baaki lines niche
      for (let i = 1; i < valLines.length; i++) {
        ctx.fillText(valLines[i], AL.bodyX + labelW, y);
        y += AL.lineH - 4;
      }
    }

    y += 14;

    // ===== Paragraph 1 =====
    ctx.font = `${AL.fontSize}px ${AL_FONT}`;
    y = alDrawParagraph(
      ctx,
      "हर्ष के साथ सूचित किया जाता है कि आपको जैन प्रबुद्ध मंच ट्रस्ट में उक्तलिखित पद पर आगामी 02 वर्षों की अवधि के लिए नियुक्त किया जाता है।",
      AL.bodyX,
      y,
      AL.bodyMaxW,
      AL.lineH,
    );
    y += 8;

    // ===== Paragraph 2 =====
    y = alDrawParagraph(
      ctx,
      "आपकी नियुक्ति संस्था के नियमों, दिशा-निर्देशों एवं संविधान के अनुरूप की गई है। संस्था के प्रति आपकी निष्ठा, समर्पण एवं सामाजिक कार्यों में सक्रिय सहभागिता को ध्यान में रखते हुए आपको यह जिम्मेदारी सौंपी जा रही है।",
      AL.bodyX,
      y,
      AL.bodyMaxW,
      AL.lineH,
    );
    y += 8;

    y = alDrawParagraph(
      ctx,
      "आपसे अपेक्षा की जाती है कि आप—",
      AL.bodyX,
      y,
      AL.bodyMaxW,
      AL.lineH,
    );
    y += 4;

    // ===== 8 points =====
    const points = [
      "संस्था के उद्देश्यों एवं विचारों का प्रचार-प्रसार करेंगे।",
      "पारदर्शिता, निष्ठा एवं समर्पण के साथ अपने दायित्वों का निर्वहन करेंगे।",
      "उच्च संगठन द्वारा दिए गए दिशा-निर्देशों का पालन करेंगे।",
      "नियमित बैठकों में सहभागिता करेंगे एवं आवश्यक प्रतिवेदन प्रस्तुत करेंगे।",
      "समाजहित एवं संगठनहित के कार्यक्रमों में सक्रिय भूमिका निभाएंगे।",
      "संगठन को मजबूत बनाने एवं अधिक से अधिक समाजजनों को जोड़ने का प्रयास करेंगे।",
      "संस्था की गरिमा, अनुशासन एवं नियमों का सदैव पालन करेंगे।",
      "प्रत्येक माह दिनांक 1 से 5 तारीख के बीच अपने संघ की नियमित रिपोर्ट जैनत्व ऐप या वेबसाइट पर करना आवश्यक होगा। इसी रिपोर्ट के आधार पर संघ की गतिविधियों एवं कार्यप्रदर्शन की रैंकिंग तय की जाएगी।",
    ];

    ctx.font = `${AL.fontSize}px ${AL_FONT}`;
    for (let i = 0; i < points.length; i++) {
      y = alDrawParagraph(
        ctx,
        `${i + 1}. ${points[i]}`,
        AL.bodyX,
        y,
        AL.bodyMaxW,
        AL.pointLineH,
        32, // hanging indent — wrap hone par number ke neeche na aaye
      );
      y += 3;
    }

    y += 10;

    // ===== Closing =====
    y = alDrawParagraph(
      ctx,
      "अतः आपसे अनुरोध है कि इस नियुक्ति पत्र की प्रति पर हस्ताक्षर कर अपनी सहमति प्रदान करें।",
      AL.bodyX,
      y,
      AL.bodyMaxW,
      AL.lineH,
    );
    y += 4;

    y = alDrawParagraph(
      ctx,
      "आपके सफल कार्यकाल एवं उज्ज्वल भविष्य के लिए हार्दिक शुभकामनाएँ।",
      AL.bodyX,
      y,
      AL.bodyMaxW,
      AL.lineH,
    );

    y += 18;

    // ================= SIGNATURE BLOCK =================
    ctx.font = `bold ${AL.fontSize}px ${AL_FONT}`;
    ctx.fillText("भवदीय", AL.bodyX, y);
    y += 10;

    const sign = await loadAppointmentSign();
    if (sign) {
      ctx.drawImage(sign, AL.bodyX, y, AL.signW, AL.signH);
      y += AL.signH + 6;
    } else {
      y += 55; // signature na mile to bhi jagah chhod do
    }

    ctx.fillStyle = "#E53935";
    ctx.font = `bold 29px ${AL_FONT}`;
    ctx.fillText("विवेक जैन", AL.bodyX, y);
    y += 34;

    ctx.fillStyle = "#1A1A1A";
    ctx.font = `bold 24px ${AL_FONT}`;
    ctx.fillText("फाउंडर अध्यक्ष", AL.bodyX, y);
    y += 30;

    ctx.fillText("जैन प्रबुद्ध मंच ट्रस्ट", AL.bodyX, y);

    // ===== RESPONSE =====
    res.setHeader("Content-Type", "image/jpeg");
    canvas.createJPEGStream({ quality: 0.92 }).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to generate appointment letter",
      error: err.message,
    });
  }
};
// foundation sangh return karta hai. Claim/Expense form ke dropdown ke liye.
const getClaimTargetSanghs = asyncHandler(async (req, res) => {
  try {
    const { sanghId } = req.params;
    const current = await HierarchicalSangh.findById(sanghId);
    if (!current) {
      return errorResponse(res, "Sangh not found", 404);
    }
 
    const loc = current.location || {};
    const level = current.level;
 
    // Level -> upar wala level + location key jispe match karna hai
    const map = {
      city: { upLevel: "district", key: "district", val: loc.district },
      district: { upLevel: "state", key: "state", val: loc.state },
      state: { upLevel: "country", key: "country", val: loc.country },
      country: { upLevel: "foundation", key: null, val: null },
      area: { upLevel: "city", key: "city", val: loc.city },
    };
 
    const rule = map[level];
    const options = [];
 
    // Upar wala level ka sangh (location match) - foundation ke alawa
    if (rule && rule.upLevel && rule.upLevel !== "foundation") {
      const q = { level: rule.upLevel, status: "active" };
      if (rule.key && rule.val) q[`location.${rule.key}`] = rule.val;
      const upperSanghs = await HierarchicalSangh.find(q).select(
        "name level location",
      );
      upperSanghs.forEach((s) =>
        options.push({
          _id: s._id,
          name: s.name,
          level: s.level,
          location: s.location,
          isFoundation: false,
        }),
      );
    }
 
    // Foundation hamesha (dynamically level=foundation)
    const foundation = await HierarchicalSangh.findOne({
      level: "foundation",
      status: "active",
    }).select("name level location");
 
    if (foundation) {
      options.push({
        _id: foundation._id,
        name: foundation.name || "Foundation",
        level: "foundation",
        location: foundation.location || {},
        isFoundation: true,
      });
    }
 
    return successResponse(
      res,
      {
        currentLevel: level,
        foundationSanghId: foundation ? foundation._id : null,
        options,
      },
      "Target sanghs retrieved",
    );
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
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
  switchToUserToken,
  updateMemberStatus,
  deleteSanghTeamMember,
  addHonoraryMember,
  createAdminSangh,
  getSanghsList,
  generateLetterhead,
  getClaimTargetSanghs,
  generateAppointmentLetter,
};
