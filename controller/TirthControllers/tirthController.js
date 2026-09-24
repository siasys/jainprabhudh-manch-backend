const Tirth = require("../../model/TirthModels/tirthModel");

/* ══════════════════════════════════════════════════════════════
   ✅ COUNTRY-WISE ADDRESS (Shravak / Matrimonial jaisa)
   Frontend `addressFields` JSON bhejta hai — countryConfig ke naam se:
     India  → { state, district, pincode, regionLabels }
     UK     → { county, town_borough, postcode, regionLabels }
     Canada → { province, region, postal_code, regionLabels }
   Model me ye keys likhi nahi hain, isliye doc.set(..., {strict:false})
   — model badalne ki zaroorat nahi. state/district/pincode pehle jaise
   bhi save hote hain (list, filter, search inhi par chalte hain).
   ══════════════════════════════════════════════════════════════ */
const BASE_ADDRESS_KEYS = [
  "country",
  "state",
  "district",
  "city",
  "fullAddress",
  "pincode",
  "mapLink",
];
const PROTECTED_ADDRESS_KEYS = [
  "country",
  "city",
  "fullAddress",
  "mapLink",
  "_id",
  "__proto__",
  "constructor",
  "prototype",
];

const parseCountryAddress = (raw) => {
  if (!raw) return {};
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};

  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key === "regionLabels" && val && typeof val === "object") {
      clean.regionLabels = {
        region1: String(val.region1 || "").slice(0, 60),
        region2: String(val.region2 || "").slice(0, 60),
      };
      continue;
    }
    // sirf simple snake_case keys (province, town_borough, postal_code)
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) continue;
    if (PROTECTED_ADDRESS_KEYS.includes(key)) continue;
    if (val === null || val === undefined || typeof val === "object") continue;
    clean[key] = String(val).trim().slice(0, 200);
  }
  return clean;
};

const applyCountryAddress = (doc, fields) => {
  for (const [key, val] of Object.entries(fields || {})) {
    doc.set(`address.${key}`, val, { strict: false });
  }
};
const HierarchicalSangh = require("../../model/SanghModels/hierarchicalSanghModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { s3Client, DeleteObjectCommand } = require("../../config/config");
const {
  extractS3KeyFromUrl,
  convertS3UrlToCDN,
} = require("../../utils/s3Utils");

/* ==================================================================
   HELPERS
================================================================== */

/**
 * FormData se aane wale nested fields strings hote hain.
 * Agar string JSON hai to parse kar do, warna jaisa hai waisa.
 */
const parseMaybeJSON = (val, fallback) => {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

const toBool = (v, def = false) => {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  return v === "true" || v === "1" || v === 1;
};

/**
 * req.body (JSON ya FormData) se naye structure ka object banao.
 * Sirf wahi keys return hoti hain jo body me aayi hain — partial update safe.
 */
const buildTirthPayload = (body = {}) => {
  const out = {};

  const objectFields = [
    "basic",
    "contact",
    "address",
    "temple",
    "acc",
    "bhoj",
    "school",
    "hostel",
    "nearbyInfo",
    "team",
  ];
  objectFields.forEach((k) => {
    if (body[k] !== undefined) {
      const parsed = parseMaybeJSON(body[k], null);
      if (parsed && typeof parsed === "object") out[k] = parsed;
    }
  });

  // facilities — Map<string, boolean>
  if (body.facilities !== undefined) {
    const f = parseMaybeJSON(body.facilities, null);
    if (f && typeof f === "object") {
      const clean = {};
      Object.keys(f).forEach((key) => {
        clean[key] = !!f[key];
      });
      out.facilities = clean;
    }
  }

  // transports — array of { type, timing, charges }
  if (body.transports !== undefined) {
    const t = parseMaybeJSON(body.transports, null);
    if (Array.isArray(t)) {
      out.transports = t
        .filter((x) => x && (x.type || x.timing || x.charges))
        .map((x) => ({
          type: x.type || "",
          timing: x.timing || "",
          charges: x.charges || "",
        }));
    }
  }

  // toggles
  ["accOn", "bhojOn", "schoolOn", "hostelOn", "transportOn"].forEach((k) => {
    if (body[k] !== undefined) out[k] = toBool(body[k]);
  });

  return out;
};

/** Card/list ke liye chhota shape */
const toCard = (t) => ({
  _id: t._id,
  name: t.basic?.name || "",
  trust: t.basic?.trust || "",
  sect: t.basic?.sect || "",
  type: t.basic?.type || "",
  kshetra: t.basic?.kshetra || "",
  city: t.address?.city || "",
  district: t.address?.district || "",
  state: t.address?.state || "",
  country: t.address?.country || "",
  photo: t.photos?.[0] || "",
  photos: t.photos || [],
  applicationStatus: t.applicationStatus,
  createdAt: t.createdAt,
});

/* ==================================================================
   PUBLIC
================================================================== */

// Cities jinme active Sangh hai
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

/**
 * Tirthlist.jsx — saare tirth (search + filter support)
 * GET /api/tirth/get?search=&sect=&state=&city=
 */
const getAllTirth = async (req, res) => {
  try {
    const { search, sect, state, city } = req.query;

    // CHANGED - status filter hata diya, ab list direct saara data laati hai
    const filter = {};
    if (sect) filter["basic.sect"] = sect;
    if (state) filter["address.state"] = state;
    if (city) filter["address.city"] = new RegExp(`^${city}$`, "i");

    if (search && search.trim()) {
      const rx = new RegExp(search.trim(), "i");
      filter.$or = [
        { "basic.name": rx },
        { "basic.trust": rx },
        { "address.city": rx },
        { "address.district": rx },
        { "address.state": rx },
      ];
    }

    const tirths = await Tirth.find(filter).sort({ "basic.name": 1 }).lean();

    return successResponse(res, tirths.map(toCard));
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// Approved tirths ki chhoti list
const getAllTirths = async (req, res) => {
  try {
    const tirths = await Tirth.find({
      status: "active",
      applicationStatus: "approved",
    })
      .select("basic address photos applicationStatus createdAt")
      .sort({ "basic.name": 1 })
      .lean();

    return successResponse(res, tirths.map(toCard));
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// Ek city ke tirths
const getCityTirths = async (req, res) => {
  try {
    const { citySanghId } = req.params; // ab city ka naam bhi chal jayega

    const sangh = await HierarchicalSangh.findById(citySanghId)
      .select("location.city")
      .lean()
      .catch(() => null);

    const cityName = sangh?.location?.city || citySanghId;

    const tirths = await Tirth.find({
      "address.city": new RegExp(`^${cityName}$`, "i"),
      status: "active",
      applicationStatus: "approved",
    })
      .sort({ "basic.name": 1 })
      .lean();

    return successResponse(res, tirths.map(toCard));
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// Tirthfullprofile.jsx — poori detail
const getTirthDetails = async (req, res) => {
  try {
    const { tirthId } = req.params;

    // CHANGED - status filter hata diya, taaki list ka har card khul sake
    const tirth = await Tirth.findOne({ _id: tirthId }).lean();
    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    // Map → plain object (frontend ke liye)
    if (tirth.facilities instanceof Map) {
      tirth.facilities = Object.fromEntries(tirth.facilities);
    }

    return successResponse(res, tirth);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   CREATE / UPDATE
================================================================== */

// Tirthform.jsx — naya tirth submit
const submitTirthApplication = async (req, res) => {
  try {
    // photos (S3 → CDN url)
    let photos = [];
    if (req.files && req.files.tirthPhoto) {
      photos = req.files.tirthPhoto.map((file) =>
        convertS3UrlToCDN(file.location),
      );
    }

    const payload = buildTirthPayload(req.body);

    if (!payload.basic?.name) {
      return errorResponse(res, "Tirth name is required", 400);
    }

    const tirth = new Tirth({
      ...payload,
      photos,
      submittedBy: req.user._id,
    });

    // ✅ Country ke naam wali address keys bhi (county / province / postcode)
    applyCountryAddress(tirth, parseCountryAddress(req.body.addressFields));

    await tirth.save();

    // user ko is tirth ka manager bana do
    const User = require("../../model/UserRegistrationModels/userModel");
    await User.findByIdAndUpdate(
      req.user._id,
      {
        $push: {
          tirthRoles: {
            tirthId: tirth._id,
            role: "manager",
            approvedAt: new Date(),
          },
        },
      },
      { new: true },
    );

    return successResponse(res, {
      message: "Tirth created successfully and role assigned",
      tirthId: tirth._id,
    });
  } catch (error) {
    console.error("❌ Error creating Tirth:", error);

    // error par uploaded files delete
    if (req.files && req.files.tirthPhoto) {
      await Promise.all(
        req.files.tirthPhoto.map((file) =>
          s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: file.key,
            }),
          ),
        ),
      ).catch(() => {});
    }

    return errorResponse(res, error.message, 500);
  }
};

// TirthEdit.jsx — details update
const updateTirthDetails = async (req, res) => {
  try {
    const { tirthId } = req.params;

    const tirth = await Tirth.findOne({ _id: tirthId, status: "active" });
    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    const payload = buildTirthPayload(req.body);

    // sensitive fields kabhi body se update na ho
    delete payload.applicationStatus;
    delete payload.reviewNotes;
    delete payload.status;
    delete payload.submittedBy;

    // ✅ address ki country-wise keys (county / province...) yaad rakho —
    // neeche naya object assign hote hi ye mit jaati thin
    const prevAddress = tirth.toObject().address || {};

    // nested objects merge karo (poora replace na ho)
    const mergeKeys = [
      "basic",
      "contact",
      "address",
      "temple",
      "acc",
      "bhoj",
      "school",
      "hostel",
      "nearbyInfo",
      "team",
    ];
    mergeKeys.forEach((k) => {
      if (payload[k]) {
        tirth[k] = {
          ...(tirth[k]?.toObject?.() || tirth[k] || {}),
          ...payload[k],
        };
      }
    });

    // purani country-wise keys wapas — par country badli ho to nahi
    // (UK ki "county" Canada wale address me na rahe)
    const countryChanged =
      payload.address?.country &&
      payload.address.country !== prevAddress.country;
    if (!countryChanged) {
      applyCountryAddress(
        tirth,
        Object.fromEntries(
          Object.entries(prevAddress).filter(
            ([k]) => !BASE_ADDRESS_KEYS.includes(k),
          ),
        ),
      );
    }
    // naye bheje gaye
    applyCountryAddress(tirth, parseCountryAddress(req.body.addressFields));

    if (payload.facilities) tirth.facilities = payload.facilities;
    if (payload.transports) tirth.transports = payload.transports;

    ["accOn", "bhojOn", "schoolOn", "hostelOn", "transportOn"].forEach((k) => {
      if (payload[k] !== undefined) tirth[k] = payload[k];
    });

    // photos — frontend jo list bhejta hai wahi final (removed hate hue)
    if (req.body.photos !== undefined) {
      const kept = parseMaybeJSON(req.body.photos, null);
      if (Array.isArray(kept)) {
        const removed = (tirth.photos || []).filter((p) => !kept.includes(p));
        tirth.photos = kept;

        // S3 se hataye gaye photos delete
        await Promise.all(
          removed.map(async (url) => {
            try {
              const key = extractS3KeyFromUrl(url);
              if (key) {
                await s3Client.send(
                  new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                  }),
                );
              }
            } catch (e) {
              console.error("S3 delete failed:", url, e.message);
            }
          }),
        );
      }
    }

    // nayi photos add
    if (req.files && req.files.tirthPhoto) {
      const newPhotos = req.files.tirthPhoto.map((f) =>
        convertS3UrlToCDN(f.location),
      );
      tirth.photos.push(...newPhotos);
    }

    await tirth.save();

    return successResponse(res, {
      message: "Tirth details updated successfully",
      tirth,
    });
  } catch (error) {
    // error par nayi uploaded files clean
    if (req.files && req.files.tirthPhoto) {
      await Promise.all(
        req.files.tirthPhoto.map((file) =>
          s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: file.key,
            }),
          ),
        ),
      ).catch(() => {});
    }
    return errorResponse(res, error.message, 500);
  }
};

// Sirf images update
const updateTirthImages = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { replaceIndex } = req.body;

    if (!tirthId) return errorResponse(res, "Tirth ID is required", 400);

    const tirth = await Tirth.findById(tirthId);
    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    let newImages = [];
    if (
      req.files &&
      Array.isArray(req.files.tirthPhoto) &&
      req.files.tirthPhoto.length > 0
    ) {
      newImages = req.files.tirthPhoto
        .filter((file) => file?.location)
        .map((file) => convertS3UrlToCDN(file.location));
    }

    if (newImages.length === 0) {
      return errorResponse(res, "No valid images uploaded", 400);
    }

    const idx = Number(replaceIndex);
    if (
      replaceIndex !== undefined &&
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < tirth.photos.length
    ) {
      tirth.photos[idx] = newImages[0];
    } else {
      tirth.photos.push(...newImages);
    }

    await tirth.save();

    return successResponse(res, {
      message: "Tirth images updated successfully",
      photos: tirth.photos,
    });
  } catch (error) {
    console.error("❌ Error updating Tirth images:", error);

    if (req.files && Array.isArray(req.files.tirthPhoto)) {
      await Promise.all(
        req.files.tirthPhoto.map((file) =>
          s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: file.key,
            }),
          ),
        ),
      ).catch(() => {});
    }

    return errorResponse(res, error.message, 500);
  }
};

// Soft delete
const deleteTirth = async (req, res) => {
  try {
    const { tirthId } = req.params;

    const tirth = await Tirth.findById(tirthId);
    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    const User = require("../../model/UserRegistrationModels/userModel");

    // ADDED - sirf owner (submittedBy) ya jiske paas is tirth ka
    // tirthRole hai wahi delete kar sake. req.user na ho to purana behaviour.
    const requesterId = req.user?._id;
    if (requesterId) {
      const isOwner = String(tirth.submittedBy || "") === String(requesterId);
      let hasRole = false;
      if (!isOwner) {
        const me = await User.findById(requesterId).select("tirthRoles").lean();
        hasRole = (me?.tirthRoles || []).some(
          (r) => String(r.tirthId) === String(tirthId),
        );
      }
      if (!isOwner && !hasRole) {
        return errorResponse(
          res,
          "You are not allowed to delete this Tirth",
          403,
        );
      }
    }

    tirth.status = "inactive"; // enum: active | inactive
    await tirth.save();

    // ADDED - tirthRoles cleanup.
    // userId in priority order:
    //   1) explicitly bheja hua userId (body ya query se)
    //   2) tirth.submittedBy  -> jis account se tirth register hua tha
    //   3) request karne wala logged-in user
    // aur last me safety-net: baaki koi bhi user jiske paas ye role bacha ho.
    const mongoose = require("mongoose");
    const toObjectId = (v) => {
      try {
        return new mongoose.Types.ObjectId(String(v));
      } catch {
        return null;
      }
    };

    const tirthObjId = tirth._id;

    const candidateIds = [
      req.body?.userId,
      req.query?.userId,
      req.params?.userId,
      tirth.submittedBy,
      requesterId,
    ]
      .filter(Boolean)
      .map((v) => String(v));

    const uniqueUserIds = [...new Set(candidateIds)]
      .map(toObjectId)
      .filter(Boolean);

    const removedFromUsers = [];
    for (const uid of uniqueUserIds) {
      try {
        const r = await User.updateOne(
          { _id: uid },
          { $pull: { tirthRoles: { tirthId: tirthObjId } } },
        );
        if ((r?.modifiedCount ?? r?.nModified ?? 0) > 0) {
          removedFromUsers.push(String(uid));
        }
      } catch (e) {
        console.error(
          "tirthRoles pull failed for user:",
          String(uid),
          e.message,
        );
      }
    }

    // safety-net - agar kisi aur user ke paas bhi ye role pada ho
    let extraRemoved = 0;
    try {
      const pulled = await User.updateMany(
        { "tirthRoles.tirthId": tirthObjId },
        { $pull: { tirthRoles: { tirthId: tirthObjId } } },
      );
      extraRemoved = pulled?.modifiedCount ?? pulled?.nModified ?? 0;
    } catch (e) {
      console.error("tirthRoles cleanup failed:", e.message);
    }

    return successResponse(res, {
      message: "Tirth deleted successfully",
      tirthId: tirth._id,
      removedFromUsers,
      rolesRemovedFrom: removedFromUsers.length + extraRemoved,
    });
  } catch (error) {
    console.error("Delete Tirth Error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   REVIEW / ACCESS
================================================================== */

const getPendingApplications = async (req, res) => {
  try {
    const { citySanghId } = req.params;

    const sangh = await HierarchicalSangh.findById(citySanghId)
      .select("location.city")
      .lean()
      .catch(() => null);

    const filter = { applicationStatus: "pending" };
    if (sangh?.location?.city) {
      filter["address.city"] = new RegExp(`^${sangh.location.city}$`, "i");
    }

    const applications = await Tirth.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return successResponse(res, applications.map(toCard));
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const reviewApplication = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { status, notes } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return errorResponse(res, "Invalid review status", 400);
    }

    const tirth = await Tirth.findOneAndUpdate(
      { _id: tirthId, applicationStatus: "pending" },
      {
        applicationStatus: status,
        reviewNotes: {
          text: notes || "",
          reviewedBy: req.user?._id,
          reviewedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!tirth) {
      return errorResponse(
        res,
        "Tirth application not found or already reviewed",
        404,
      );
    }

    // approve hone par submittedBy user ko manager role (agar pehle se na ho)
    if (status === "approved" && tirth.submittedBy) {
      const User = require("../../model/UserRegistrationModels/userModel");
      const user = await User.findById(tirth.submittedBy);

      if (user) {
        if (!Array.isArray(user.tirthRoles)) user.tirthRoles = [];

        const hasRole = user.tirthRoles.some(
          (r) => String(r.tirthId) === String(tirth._id),
        );

        if (!hasRole) {
          user.tirthRoles.push({
            tirthId: tirth._id,
            role: "manager",
            startDate: new Date(),
          });
          user.markModified("tirthRoles");
          await user.save();
        }
      }
    }

    return successResponse(res, {
      message: `Tirth application ${status}`,
      tirth,
    });
  } catch (error) {
    console.error("❌ Error in reviewApplication:", error);
    return errorResponse(res, error.message, 500);
  }
};

const tirthLogin = async (req, res) => {
  try {
    const userId = req.user._id;
    const { tirthId } = req.params;

    const User = require("../../model/UserRegistrationModels/userModel");
    const user = await User.findById(userId);
    if (!user) return errorResponse(res, "User not found", 404);

    const hasTirthRole =
      user.tirthRoles &&
      user.tirthRoles.some((r) => String(r.tirthId) === String(tirthId));

    if (!hasTirthRole) {
      return errorResponse(
        res,
        "You do not have permission to access this Tirth",
        403,
      );
    }

    const tirth = await Tirth.findOne({ _id: tirthId, status: "active" });
    if (!tirth) return errorResponse(res, "Tirth not found or not active", 404);

    return successResponse(res, { message: "Access granted", tirth });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  getAvailableCities,
  submitTirthApplication,
  getPendingApplications,
  reviewApplication,
  getTirthDetails,
  updateTirthDetails,
  getCityTirths,
  tirthLogin,
  getAllTirths,
  getAllTirth,
  deleteTirth,
  updateTirthImages,
};
