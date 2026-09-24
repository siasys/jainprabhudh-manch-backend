const Sadhu = require("../../model/SadhuModels/sadhuModel");
const HierarchicalSangh = require("../../model/SanghModels/hierarchicalSanghModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { s3Client, DeleteObjectCommand } = require("../../config/s3Config");
const { extractS3KeyFromUrl } = require("../../utils/s3Utils");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");

/* ══════════════════════════════════════════════════════════════
   ── NEW HELPERS (additive only) ──
   ══════════════════════════════════════════════════════════════ */

// ✅ DUPLICATE GUARD — ek user ki do request ek saath process na ho
// (double-tap / slow network par user do baar submit kar deta hai)
const inFlightSadhuSubmissions = new Set();

// FormData se aane wale numeric field "" ho sakte hain -> null
const toNumberOrNull = (val) => {
  if (val === undefined || val === null || String(val).trim() === "")
    return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
};

// FormData se aane wale date field "" ho sakte hain -> null
const toDateOrNull = (val) => {
  if (val === undefined || val === null || String(val).trim() === "")
    return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// "true"/"false" string ko boolean me
const toBool = (val) =>
  val === true || val === "true" || val === 1 || val === "1";

// chaturmasList JSON string -> clean array
const parseChaturmasList = (raw) => {
  if (!raw) return null;
  let list = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  return list
    .filter((item) => item && (item.year || item.place))
    .map((item) => ({
      year: toNumberOrNull(item.year),
      place: item.place || "",
      city: item.city || "",
      state: item.state || "",
    }));
};

// Naye fields ko sahi type me convert karta hai (existing fields ko chhuta nahi)
const normalizeNewSadhuFields = (data, userId) => {
  if (data.sanyamVarsh !== undefined) {
    data.sanyamVarsh = toNumberOrNull(data.sanyamVarsh);
  }

  if (data.currentLocation && typeof data.currentLocation === "object") {
    const loc = data.currentLocation;
    loc.fromDate = toDateOrNull(loc.fromDate);
    loc.toDate = toDateOrNull(loc.toDate);
    loc.lat = toNumberOrNull(loc.lat);
    loc.lng = toNumberOrNull(loc.lng);
    loc.updatedAt = toDateOrNull(loc.updatedAt) || new Date();
    if (userId) loc.updatedBy = userId;
  }

  if (data.contactDetails && typeof data.contactDetails === "object") {
    if (data.contactDetails.showMobilePublic !== undefined) {
      data.contactDetails.showMobilePublic = toBool(
        data.contactDetails.showMobilePublic,
      );
    }

    // ✅ Location country ke hisab se aati hai — frontend seedha us
    // country ke field name se bhejta hai (UK: county/town_borough).
    // contactDetails schema strict:false hai, to ye keys waise hi
    // save ho jaati hain — yahan kuch convert karne ki zaroorat nahi.
  }

  if (data.chaturmasList !== undefined) {
    const parsed = parseChaturmasList(data.chaturmasList);
    if (parsed) {
      data.chaturmasList = parsed;
    } else {
      delete data.chaturmasList;
    }
  }

  // ── NEW: update ke waqt upadhiList bhi JSON string me aata hai ──
  if (data.upadhiList !== undefined && typeof data.upadhiList === "string") {
    try {
      const parsed = JSON.parse(data.upadhiList);
      if (Array.isArray(parsed)) {
        data.upadhiList = parsed;
      } else {
        delete data.upadhiList;
      }
    } catch (e) {
      delete data.upadhiList;
    }
  }

  return data;
};

// Submit new sadhu info
const submitSadhuInfo = async (req, res) => {
  const lockKey = String(req.user._id);
  // Ye request ne lock liya hai ya nahi — warna reject hui request
  // finally me pehli request ka lock delete kar degi
  let lockAcquired = false;

  try {
    // ✅ GUARD 1 — parallel request block (double-tap / retry)
    if (inFlightSadhuSubmissions.has(lockKey)) {
      return res.status(429).json({
        success: false,
        message: "Your previous submission is still processing. Please wait.",
      });
    }
    inFlightSadhuSubmissions.add(lockKey);
    lockAcquired = true;

    // ✅ GUARD 2 — ek user sirf ek hi Sadhu profile bana sakta hai
    const existingSadhu = await Sadhu.findOne({
      submittedBy: req.user._id,
    }).select("_id sadhuID");

    if (existingSadhu) {
      return res.status(409).json({
        success: false,
        message: "You have already registered a Sadhu profile.",
        data: {
          sadhuId: existingSadhu._id,
          sadhuID: existingSadhu.sadhuID,
        },
      });
    }

    const sadhuData = { ...req.body };
    sadhuData.submittedBy = req.user._id;

    // Generate unique Sadhu ID
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    sadhuData.sadhuID = `SADHU${randomNum}`;

    // Parse upadhiList array
    if (req.body.upadhiList) {
      try {
        sadhuData.upadhiList = JSON.parse(req.body.upadhiList);
      } catch (parseErr) {
        return errorResponse(res, "Invalid upadhiList format");
      }
    }

    // ── NEW: naye fields ko sahi type me convert karo ──
    normalizeNewSadhuFields(sadhuData, req.user._id);

    // Ensure uploadImage is an array
    sadhuData.uploadImage = [];

    // Handle file uploads
    if (req.files) {
      // ⬇️ MULTIPLE PHOTOS (entityPhoto)
      if (req.files?.uploadImage) {
        sadhuData.uploadImage = req.files.uploadImage.map((file) =>
          convertS3UrlToCDN(file.location),
        );
      }

      // ⬇️ MULTIPLE DOCUMENTS
      // if (req.files.entityDocuments) {
      //   sadhuData.documents = req.files.entityDocuments.map(doc =>
      //     convertS3UrlToCDN(doc.location)
      //   );
      // }
    }

    // Save Sadhu
    const sadhu = new Sadhu(sadhuData);
    await sadhu.save();

    // Add Sadhu reference to User
    const user = await User.findById(req.user._id);
    if (!user.sadhuRoles) user.sadhuRoles = [];
    user.sadhuRoles.push({
      sadhuId: sadhu._id,
      role: "owner",
    });
    await user.save();

    return successResponse(
      res,
      "Sadhu information submitted successfully for review",
      {
        sadhuID: sadhu.sadhuID,
        sadhuData: sadhu,
      },
    );
  } catch (error) {
    // ✅ DB unique index se aaya duplicate error — saaf message do
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "You have already registered a Sadhu profile.",
      });
    }
    return errorResponse(res, error.message);
  } finally {
    // ✅ Sirf apna liya hua lock chhodo (success ho ya error)
    if (lockAcquired) {
      inFlightSadhuSubmissions.delete(lockKey);
    }
  }
};

// Review sadhu submission
const reviewSadhuSubmission = async (req, res) => {
  try {
    const { sadhuId } = req.params;
    const { status } = req.body;

    const sadhu = await Sadhu.findById(sadhuId);
    if (!sadhu) {
      return errorResponse(res, "Sadhu not found", 404);
    }

    sadhu.applicationStatus = status;
    sadhu.reviewInfo = {
      reviewedBy: {
        cityPresidentId: req.user._id,
        reviewDate: new Date(),
      },
    };

    if (status === "approved") {
      // Find the user who submitted the sadhu application
      const submittedByUser = await User.findById(sadhu.submittedBy);
      if (submittedByUser) {
        // Add owner role to the user who submitted the application
        if (!submittedByUser.sadhuRoles) {
          submittedByUser.sadhuRoles = [];
        }
        submittedByUser.sadhuRoles.push({
          sadhuId: sadhu._id,
          role: "owner",
          approvedAt: new Date(),
        });
        await submittedByUser.save();
      }
      await sadhu.save();
      return successResponse(res, "Sadhu approved and role assigned to user", {
        sadhu,
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

    const sadhu = await Sadhu.findById(sadhuId);
    if (!sadhu) {
      return errorResponse(res, "Sadhu not found");
    }

    /* ============================
       ✅ HANDLE IMAGE UPDATE
    ============================ */

    if (files?.uploadImage?.length) {
      if (!Array.isArray(sadhu.uploadImage)) sadhu.uploadImage = [];

      if (updates?.updateIndex !== undefined) {
        // 📝 Replace image at index
        const index = parseInt(updates.updateIndex, 10);
        const oldImageUrl = sadhu.uploadImage[index];
        if (oldImageUrl) {
          const key = extractS3KeyFromUrl(oldImageUrl);
          if (key) {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: key,
              }),
            );
          }
        }
        sadhu.uploadImage[index] = convertS3UrlToCDN(
          files.uploadImage[0].location,
        );
      } else {
        // 📝 Add new images at the end
        files.uploadImage.forEach((file) => {
          sadhu.uploadImage.push(convertS3UrlToCDN(file.location));
        });
      }
    }

    /* ============================
       ✅ NEW: naye fields normalize
    ============================ */
    normalizeNewSadhuFields(updates, req.user?._id);

    /* ============================
       ✅ NEW: array fields explicitly set karo
       ------------------------------------------------
       Mongoose DocumentArray pe seedha `sadhu[key] = array` karne se
       change-tracking hamesha register nahi hoti aur save() us path ko
       skip kar deta hai — koi error bhi nahi aata. Isliye .set() +
       markModified() use karte hain, aur phir in keys ko `updates` se
       hata dete hain taaki neeche wala merge loop inhe dobara na chhue.
    ============================ */
    const arrayFields = ["chaturmasList", "upadhiList"];
    for (const key of arrayFields) {
      if (Array.isArray(updates[key])) {
        sadhu.set(key, updates[key]);
        sadhu.markModified(key);
        delete updates[key];
      }
    }

    /* ============================
       ✅ MERGE BODY UPDATES
    ============================ */
    for (const key in updates) {
      if (typeof updates[key] === "object" && !Array.isArray(updates[key])) {
        sadhu[key] = {
          ...(sadhu[key] || {}),
          ...updates[key],
        };
      } else {
        sadhu[key] = updates[key];
      }
    }

    await sadhu.save();

    return successResponse(res, "Profile updated successfully", sadhu);
  } catch (error) {
    console.error("Sadhu Update Error:", error);
    return errorResponse(res, error.message);
  }
};

// Get available cities with active Sanghs
const getAvailableCities = async (req, res) => {
  try {
    const cities = await HierarchicalSangh.find(
      { level: "city", status: "active" },
      "location.city location.state location.district _id",
    ).sort({ "location.city": 1 });

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
      applicationStatus: "pending",
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
      status: "approved",
      isActive: true,
    }).select("-accessCredentials");

    return successResponse(res, "Sadhus retrieved successfully", sadhus);
  } catch (error) {
    return errorResponse(res, error.message);
  }
};
// Get all sadhus (public)
const getAllSadhu = async (req, res) => {
  try {
    const sadhus = await Sadhu.find({
      // isActive: true
    }).select("-accessCredentials"); // citySanghId ka sirf location fetch hoga

    return successResponse(res, "Sadhus retrieved successfully", sadhus);
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
    }).select("-accessCredentials");
    if (!sadhu) {
      return errorResponse(res, "Sadhu not found", 404);
    }
    return successResponse(res, "Sadhu retrieved successfully", sadhu);
  } catch (error) {
    return errorResponse(res, error.message);
  }
};

/* ══════════════════════════════════════════════════════════════
   ── NEW: Sadhu directory (normal user side list) ──
   ------------------------------------------------------------------
   Purani list screen saare users laati thi aur phir har sadhu ke liye
   ek alag call karti thi (N+1). Ye endpoint sab kuch ek aggregation me
   deta hai — server-side search, filter, sort aur pagination ke saath.
   ══════════════════════════════════════════════════════════════ */

// Regex ke special characters ko safe banao
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getSadhuDirectory = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 12, 1),
      50,
    );
    const skip = (page - 1) * limit;

    /* ── Filters ── */
    const match = {};

    if (req.query.mulJain) {
      match.mulJain = new RegExp(`^${escapeRegex(req.query.mulJain)}$`, "i");
    }
    if (req.query.sadhuType) {
      match.sadhuType = req.query.sadhuType;
    }
    if (req.query.sadhuStatus) {
      match.sadhuStatus = req.query.sadhuStatus;
    }
    if (req.query.verified === "true") {
      match.applicationStatus = "approved";
    }
    if (req.query.state) {
      match["currentLocation.state"] = new RegExp(
        `^${escapeRegex(req.query.state)}$`,
        "i",
      );
    }
    if (req.query.city) {
      match["currentLocation.city"] = new RegExp(
        escapeRegex(req.query.city),
        "i",
      );
    }
    if (req.query.chaturmasYear) {
      const year = parseInt(req.query.chaturmasYear, 10);
      if (!Number.isNaN(year)) {
        // String aur Number dono match karo — purane records me year
        // string me save hui ho sakti hai
        match["chaturmasList.year"] = { $in: [year, String(year)] };
      }
    }

    // Free text search — naam, sangh, guru, city, upadhi, vishesh gyan
    if (req.query.q && String(req.query.q).trim()) {
      const rx = new RegExp(escapeRegex(String(req.query.q).trim()), "i");
      match.$or = [
        { sadhuName: rx },
        { sanghName: rx },
        { guruName: rx },
        { dikshaGuruName: rx },
        { visheshGyan: rx },
        { bhasha: rx },
        { "currentLocation.city": rx },
        { "currentLocation.state": rx },
        { "currentLocation.placeName": rx },
        { "contactDetails.district": rx },
        { "contactDetails.state": rx },
        { "upadhiList.upadhiName": rx },
      ];
    }

    /* ── Sort ── _id tiebreaker se pagination deterministic rehti hai ── */
    let sort;
    switch (req.query.sort) {
      case "name":
        sort = { sadhuName: 1, _id: 1 };
        break;
      case "sanyam":
        sort = { sanyamVarsh: -1, _id: -1 };
        break;
      case "location":
        sort = { "currentLocation.updatedAt": -1, _id: -1 };
        break;
      default:
        sort = { createdAt: -1, _id: -1 };
    }

    const pipeline = [
      { $match: match },

      // Sadhu ka owner user — profile picture aur userId ke liye
      {
        $lookup: {
          from: "users",
          localField: "submittedBy",
          foreignField: "_id",
          as: "ownerUser",
        },
      },

      /* Purane documents me kuch fields string me store hain (schema
         badalne se pehle ke records). $size / $slice / $arrayElemAt
         string pe error de dete hain aur poori aggregation fail ho
         jaati hai — isliye har jagah $isArray se guard lagaya hai. */
      // ── NEW: published niyam ka count ──
      {
        $lookup: {
          from: "sadhuniyams",
          let: { sid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$sadhuId", "$$sid"] },
                    { $ne: ["$isPublished", false] },
                  ],
                },
              },
            },
            { $count: "count" },
          ],
          as: "niyamStats",
        },
      },

      {
        $addFields: {
          safeUpadhi: {
            $cond: [{ $isArray: "$upadhiList" }, "$upadhiList", []],
          },
          safeChaturmas: {
            $cond: [{ $isArray: "$chaturmasList" }, "$chaturmasList", []],
          },
          safePhotos: {
            $cond: [
              { $isArray: "$uploadImage" },
              "$uploadImage",
              {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $type: "$uploadImage" }, "string"] },
                      { $ne: ["$uploadImage", ""] },
                    ],
                  },
                  ["$uploadImage"],
                  [],
                ],
              },
            ],
          },
        },
      },

      {
        $addFields: {
          ownerUser: { $arrayElemAt: ["$ownerUser", 0] },
          chaturmasCount: { $size: "$safeChaturmas" },
          upadhiCount: { $size: "$safeUpadhi" },
          photoCount: { $size: "$safePhotos" },
          niyamCount: {
            $ifNull: [{ $arrayElemAt: ["$niyamStats.count", 0] }, 0],
          },
          latestUpadhi: { $arrayElemAt: ["$safeUpadhi", -1] },
          isVerified: { $eq: ["$applicationStatus", "approved"] },
        },
      },

      // Sirf wahi fields jo card ko chahiye — payload chhota rehta hai.
      // Mobile number aur email jaan-bujh kar bahar rakhe hain (privacy).
      {
        $project: {
          sadhuName: 1,
          sadhuType: 1,
          sadhuStatus: 1,
          mulJain: 1,
          panth: 1,
          sanghName: 1,
          sanyamVarsh: 1,
          guruName: 1,
          visheshGyan: 1,
          applicationStatus: 1,
          isVerified: 1,
          createdAt: 1,
          uploadImage: { $slice: ["$safePhotos", 1] },
          currentLocation: {
            placeName: "$currentLocation.placeName",
            city: "$currentLocation.city",
            state: "$currentLocation.state",
            fromDate: "$currentLocation.fromDate",
            toDate: "$currentLocation.toDate",
            updatedAt: "$currentLocation.updatedAt",
          },
          contactDetails: {
            district: "$contactDetails.district",
            state: "$contactDetails.state",
          },
          chaturmasCount: 1,
          upadhiCount: 1,
          photoCount: 1,
          niyamCount: 1,
          latestUpadhi: 1,
          userId: "$ownerUser._id",
          userProfilePicture: "$ownerUser.profilePicture",
        },
      },

      { $sort: sort },

      {
        $facet: {
          records: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const result = await Sadhu.aggregate(pipeline);
    const records = result?.[0]?.records || [];
    const total = result?.[0]?.totalCount?.[0]?.count || 0;

    return successResponse(res, "Sadhu directory retrieved", {
      records,
      total,
      page,
      limit,
      hasMore: skip + records.length < total,
    });
  } catch (error) {
    console.error("getSadhuDirectory error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── Filter dropdowns ke liye actual available options ──
   Hardcoded list dikhane se khali filters aate hain, isliye DB se
   sirf wahi values bhejte hain jinke against records maujood hain. */
const getSadhuFilterOptions = async (req, res) => {
  try {
    const [states, cities, types, panths, mulJains, years] = await Promise.all([
      Sadhu.distinct("currentLocation.state"),
      Sadhu.distinct("currentLocation.city"),
      Sadhu.distinct("sadhuType"),
      Sadhu.distinct("panth"),
      Sadhu.distinct("mulJain"),
      Sadhu.distinct("chaturmasList.year"),
    ]);

    const clean = (arr) =>
      (arr || [])
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
        .sort();

    return successResponse(res, "Filter options retrieved", {
      states: clean(states),
      cities: clean(cities),
      sadhuTypes: clean(types),
      panths: clean(panths),
      mulJains: clean(mulJains),
      chaturmasYears: clean(years).reverse(),
    });
  } catch (error) {
    console.error("getSadhuFilterOptions error:", error);
    return errorResponse(res, error.message);
  }
};

/* ══════════════════════════════════════════════════════════════
   ── NEW: ek photo hatao (index se) ──
   ══════════════════════════════════════════════════════════════ */
const removeSadhuImage = async (req, res) => {
  try {
    const { sadhuId } = req.params;
    const index = parseInt(req.body.index, 10);

    const sadhu = await Sadhu.findById(sadhuId);
    if (!sadhu) {
      return errorResponse(res, "Sadhu not found", 404);
    }

    if (!Array.isArray(sadhu.uploadImage) || Number.isNaN(index)) {
      return errorResponse(res, "Invalid image index");
    }
    if (index < 0 || index >= sadhu.uploadImage.length) {
      return errorResponse(res, "Image index out of range");
    }

    const oldImageUrl = sadhu.uploadImage[index];
    if (oldImageUrl) {
      const key = extractS3KeyFromUrl(oldImageUrl);
      if (key) {
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: key,
            }),
          );
        } catch (s3Err) {
          // S3 delete fail ho to bhi DB se hata dete hain
          console.error("S3 delete failed:", s3Err.message);
        }
      }
    }

    sadhu.uploadImage.splice(index, 1);
    await sadhu.save();

    return successResponse(res, "Image removed", sadhu);
  } catch (error) {
    console.error("removeSadhuImage error:", error);
    return errorResponse(res, error.message);
  }
};

module.exports = {
  submitSadhuInfo,
  removeSadhuImage,
  // ── NEW: directory ──
  getSadhuDirectory,
  getSadhuFilterOptions,
  reviewSadhuSubmission,
  getAllSadhus,
  getAllSadhu,
  getSadhuById,
  updateSadhuProfile,
  getAvailableCities,
  getPendingSadhuApplications,
};
