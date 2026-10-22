const { VyavahikBiodata } = require("../../model/Matrimonial/VyavahikBiodata");
const JainAadhar = require("../../model/UserRegistrationModels/jainAadharModel");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
const mongoose = require("mongoose");

/* ══════════════════════════════════════════════════════════════
   ✅ COUNTRY-WISE ADDRESS (Shravak jaisa, countryConfig fieldName se)
   ──────────────────────────────────────────────────────────────
   Frontend bhejta hai: addressFields = JSON
     India  → { state, district, pincode, regionLabels }
     Canada → { province, region, postal_code, regionLabels }
     UK     → { county, town_borough, postcode, regionLabels }
   Model me ye keys likhi nahi hain, isliye doc.set(..., {strict:false})
   se save karte hain — model badalne ki zaroorat nahi.
   ══════════════════════════════════════════════════════════════ */
const PROTECTED_ADDRESS_KEYS = [
  "country",
  "city",
  "fullAddress",
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
    if (val === null || val === undefined) continue;
    if (typeof val === "object") continue;
    clean[key] = String(val).trim().slice(0, 200);
  }
  return clean;
};

const applyCountryAddress = (doc, fields) => {
  for (const [key, val] of Object.entries(fields || {})) {
    doc.set(`addressInfo.${key}`, val, { strict: false });
  }
};

/* ══════════════════════════════════════════════════════════════
   ✅ DUPLICATE BIODATA GUARD — ek user ka sirf ek biodata
   1) DB check: pehle se biodata hai to naya nahi banega (409)
   2) In-memory lock: same user ki 2 request ek saath aayi (double tap /
      retry) to doosri request turant 409 le legi
   3) catch me E11000 (unique index) bhi 409 me convert hota hai
   ══════════════════════════════════════════════════════════════ */
const creatingUsers = new Set();

/* ══════════════════════════════════════════════════════════════
   ✅ BASIC STEP — MANDATORY FIELDS VALIDATION
   Create par sab required; Edit par jo field bheja gaya wo khaali na ho
   Response: 400 + missingFields / invalidFields (Review screen dikhata hai)
   ══════════════════════════════════════════════════════════════ */
const BASIC_FIELD_LABELS = {
  profile: "Profile For",
  shravakId: "Jain Shravak ID",
  name: "Full Name",
  gender: "Gender",
  dob: "Date of Birth",
  timeOfBirth: "Time of Birth",
  birthPlace: "Birth Place",
  relationWithCandidate: "Relation with Candidate",
  creatorShravakId: "Creator Jain Shravak ID",
  creatorName: "Creator Name",
  creatorMobile: "Creator Mobile",
  marriageType: "Marital Status",
};

const MARRIAGE_TYPES = ["Single", "Divorced", "Widowed/widower"];

const BASIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-/]{3,29}$/;
const TIME_12H_PATTERN = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;
const TIME_24H_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

const isBlankValue = (v) =>
  v === undefined || v === null || String(v).trim() === "";

// Ek field ka format check — galat ho to reason, sahi ho to null
const getBasicFieldFormatError = (field, value) => {
  const v = String(value).trim();
  switch (field) {
    case "profile":
      return ["mySelf", "someoneElse"].includes(v) ? null : "invalid value";
    case "shravakId":
    case "creatorShravakId":
      return BASIC_ID_PATTERN.test(v) ? null : "invalid ID format";
    case "gender":
      return ["Male", "Female"].includes(v) ? null : "must be Male or Female";
    case "dob": {
      const d = new Date(v);
      if (isNaN(d.getTime())) return "invalid date";
      if (d.getTime() > Date.now()) return "cannot be in the future";
      return null;
    }
    case "timeOfBirth":
      return TIME_12H_PATTERN.test(v) || TIME_24H_PATTERN.test(v)
        ? null
        : "invalid time";
    case "marriageType":
      return MARRIAGE_TYPES.includes(v) ? null : "invalid option";
    case "creatorMobile": {
      const digits = v.replace(/[^0-9]/g, "");
      return digits.length >= 6 && digits.length <= 15
        ? null
        : "invalid mobile number";
    }
    default:
      return null;
  }
};

const buildBasicErrorResponse = (missing, invalid) => {
  const parts = [];
  if (missing.length) {
    parts.push(
      `Please fill these required fields: ${missing
        .map((m) => m.label)
        .join(", ")}`,
    );
  }
  if (invalid.length) {
    parts.push(
      `Please correct: ${invalid
        .map((i) => `${i.label} (${i.reason})`)
        .join(", ")}`,
    );
  }
  return {
    success: false,
    message: parts.join(". "),
    missingFields: missing,
    invalidFields: invalid,
  };
};

// Create — sab basic fields required
const validateBasicForCreate = (body = {}) => {
  const required = [
    "profile",
    "shravakId",
    "name",
    "gender",
    "dob",
    "timeOfBirth",
    "birthPlace",
    "marriageType", // ✅ Marital Status — Basic screen
  ];
  if (body.profile === "someoneElse") {
    required.push(
      "relationWithCandidate",
      "creatorShravakId",
      "creatorName",
      "creatorMobile",
    );
  }

  const missing = [];
  const invalid = [];
  for (const field of required) {
    const label = BASIC_FIELD_LABELS[field];
    if (isBlankValue(body[field])) {
      missing.push({ field, label });
      continue;
    }
    const reason = getBasicFieldFormatError(field, body[field]);
    if (reason) invalid.push({ field, label, reason });
  }

  // ✅ Divorced — "Is Divorce Completed?" (Yes/No) required
  if (body.marriageType === "Divorced") {
    if (isBlankValue(body.isDivorceComplete)) {
      missing.push({
        field: "isDivorceComplete",
        label: "Is Divorce Completed?",
      });
    } else if (!["Yes", "No"].includes(String(body.isDivorceComplete).trim())) {
      invalid.push({
        field: "isDivorceComplete",
        label: "Is Divorce Completed?",
        reason: "must be Yes or No",
      });
    }
  }

  // ✅ Number of Children optional — bhara ho to sirf number (DB me Number hai)
  if (
    ["Divorced", "Widowed/widower"].includes(body.marriageType) &&
    !isBlankValue(body.numberOfChildren) &&
    !/^\d{1,2}$/.test(String(body.numberOfChildren).trim())
  ) {
    invalid.push({
      field: "numberOfChildren",
      label: "Number of Children",
      reason: "invalid number",
    });
  }
  return { missing, invalid };
};

// Edit — partial update: sirf jo basic field bheja gaya wo khaali/galat na ho
// "For Myself" profile me creator/relation fields check nahi hote
const CREATOR_ONLY_FIELDS = [
  "relationWithCandidate",
  "creatorShravakId",
  "creatorName",
  "creatorMobile",
];

const validateBasicForEdit = (body = {}, currentProfile) => {
  const profile = body.profile || currentProfile;
  const missing = [];
  const invalid = [];
  for (const field of Object.keys(BASIC_FIELD_LABELS)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    if (profile !== "someoneElse" && CREATOR_ONLY_FIELDS.includes(field)) {
      continue;
    }
    const label = BASIC_FIELD_LABELS[field];
    if (isBlankValue(body[field])) {
      missing.push({ field, label });
      continue;
    }
    const reason = getBasicFieldFormatError(field, body[field]);
    if (reason) invalid.push({ field, label, reason });
  }
  return { missing, invalid };
};

/* ══════════════════════════════════════════════════════════════
   ✅ EK ACCOUNT SE MAX 3 MATRIMONIAL PROFILES
   - 3 ho gaye to 409 + limitReached
   - "For Myself" sirf ek (apni hi do profile nahi) → 409 + selfExists
   ══════════════════════════════════════════════════════════════ */
const MAX_PROFILES_PER_USER = 3;
const PROFILE_LIMIT_MESSAGE = `You can create a maximum of ${MAX_PROFILES_PER_USER} matrimonial profiles from one account.`;

const checkProfileLimit = async (userId, profileType) => {
  const count = await VyavahikBiodata.countDocuments({ userId });
  if (count >= MAX_PROFILES_PER_USER) {
    return {
      status: 409,
      body: {
        success: false,
        limitReached: true,
        count,
        maxProfiles: MAX_PROFILES_PER_USER,
        message: PROFILE_LIMIT_MESSAGE,
      },
    };
  }
  if (profileType === "mySelf") {
    const selfExists = await VyavahikBiodata.exists({
      userId,
      profile: "mySelf",
    });
    if (selfExists) {
      return {
        status: 409,
        body: {
          success: false,
          selfExists: true,
          message:
            "You already have a matrimonial profile for yourself. Please choose 'Someone else' to create another profile.",
        },
      };
    }
  }
  return null;
};

/* ══════════════════════════════════════════════════════════════
   ✅ ACTIVE PROFILE — ek user ki 3 profiles me se kaunsi abhi chal rahi hai
   App har request me header "x-biodata-id" bhejta hai.
   Wo id is user ki ho to wahi; warna (purana app / galat id) pehli profile.
   ══════════════════════════════════════════════════════════════ */
// ─── LIVE AGE (DOB se aaj ki umar) ─────────────────────────────────────────
// ✅ DB me "age" profile banate waqt ek baar save hoti hai aur saal badalne par
// purani reh jaati thi. Profile bhejne se pehle DOB se aaj ki umar bhar do.
// DB me kuch save nahi hota; DOB na ho / galat ho to purani "age" hi rehti hai.
const getAgeFromDobLive = (dob) => {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
};

// Lean data (object / array, populated profiles bhi) me jahan "dob" ho wahan age
const withLiveAge = (value, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 6) return value;
  if (value instanceof Date || value._bsontype || Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => withLiveAge(item, depth + 1));
    return value;
  }
  if (Object.prototype.hasOwnProperty.call(value, "dob")) {
    const live = getAgeFromDobLive(value.dob);
    if (live !== null) value.age = String(live);
  }
  Object.keys(value).forEach((key) => {
    const child = value[key];
    if (child && typeof child === "object") withLiveAge(child, depth + 1);
  });
  return value;
};

const getActiveBiodataFilter = async (req) => {
  const raw =
    req.headers?.["x-biodata-id"] ||
    req.query?.myBiodataId ||
    req.body?.myBiodataId ||
    "";
  const id = String(raw).trim();

  if (id && mongoose.Types.ObjectId.isValid(id)) {
    const owned = await VyavahikBiodata.exists({
      _id: id,
      userId: req.user._id,
    });
    if (owned) return { _id: id };
  }
  return { userId: req.user._id };
};

/* ══════════════════════════════════════════════════════════════
   ✅ CITY SEARCH (Birth Place autocomplete) — GET /biodata/cities?q=khar
   GeoNames se import hui "cities" collection me "shuru hone wala" search.
   India ke results pehle (max 10), phir duniya (max 5), bade sheher upar.
   ══════════════════════════════════════════════════════════════ */
const { City } = require("../../model/Location/CityModel");

const toCitySearchText = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Country code → naam ("IN" → "India") — DB me save nahi, yahan banta hai
const cityCountryNames = new Intl.DisplayNames(["en"], { type: "region" });
const getCityCountryName = (code) => {
  try {
    return cityCountryNames.of(code) || code;
  } catch {
    return code;
  }
};

// Patla DB doc → app ka format (frontend wahi fields padhta hai)
const toCityResponse = (doc) => {
  const country = getCityCountryName(doc.cc);
  return {
    name: doc.n,
    state: doc.st || "",
    country,
    countryCode: doc.cc,
    displayName: [doc.n, doc.st && doc.st !== doc.n ? doc.st : "", country]
      .filter(Boolean)
      .join(", "),
  };
};

const searchCities = async (req, res) => {
  try {
    const q = toCitySearchText(req.query.q);
    if (q.length < 2) {
      return res.status(200).json({ success: true, data: [] });
    }

    const prefix = { $regex: `^${escapeRegex(q)}` };
    const fields = "n st cc";

    const [india, world] = await Promise.all([
      City.find({ cc: "IN", s: prefix })
        .sort({ p: -1 })
        .limit(10)
        .select(fields)
        .maxTimeMS(3000)
        .lean(),
      City.find({ cc: { $ne: "IN" }, s: prefix })
        .sort({ p: -1 })
        .limit(5)
        .select(fields)
        .maxTimeMS(3000)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: [...india, ...world].map(toCityResponse),
    });
  } catch (error) {
    console.error("❌ searchCities error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not search cities" });
  }
};

// GET /my-profiles — login user ki saari profiles + kitni aur bana sakta hai
const getMyProfiles = async (req, res) => {
  try {
    const list = await VyavahikBiodata.find({ userId: req.user._id })
      .select(
        "name gender age profile relationWithCandidate uploadedPhotos createdAt",
      )
      .sort({ createdAt: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: list.length,
      maxProfiles: MAX_PROFILES_PER_USER,
      canCreateMore: list.length < MAX_PROFILES_PER_USER,
      data: list,
    });
  } catch (error) {
    console.error("❌ getMyProfiles error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load your profiles",
    });
  }
};

const sendAlreadyExists = (res, existing) =>
  res.status(409).json({
    success: false,
    alreadyExists: true,
    message: "Aapka biodata pehle se bana hua hai",
    data: existing || null,
  });

// Create API
const createBiodata = async (req, res) => {
  const lockKey = String(req.user?._id || req.body?.userId || "");
  let lockTaken = false;
  try {
    if (!lockKey) {
      return res.status(401).json({
        success: false,
        message: "User not identified. Please login again.",
      });
    }
    if (creatingUsers.has(lockKey)) {
      return sendAlreadyExists(res, null);
    }
    creatingUsers.add(lockKey);
    lockTaken = true;

    // ✅ Max 3 profiles (pehle sirf 1 tha)
    const limitError = await checkProfileLimit(lockKey, req.body?.profile);
    if (limitError) {
      return res.status(limitError.status).json(limitError.body);
    }

    // Extract S3 uploaded URLs
    const passportPhotoS3 = req.files?.passportPhoto?.[0]?.location || null;
    const fullPhotoS3 = req.files?.fullPhoto?.[0]?.location || null;
    const familyPhotoS3 = req.files?.familyPhoto?.[0]?.location || null;
    const healthCertificateS3 =
      req.files?.healthCertificate?.[0]?.location || null;
    const educationCertificateS3 =
      req.files?.educationCertificate?.[0]?.location || null;
    const divorceCertificateS3 =
      req.files?.divorceCertificate?.[0]?.location || null;

    // Convert S3 URLs → CDN
    const passportPhoto = passportPhotoS3
      ? convertS3UrlToCDN(passportPhotoS3)
      : null;
    const fullPhoto = fullPhotoS3 ? convertS3UrlToCDN(fullPhotoS3) : null;
    const familyPhoto = familyPhotoS3 ? convertS3UrlToCDN(familyPhotoS3) : null;
    const healthCertificate = healthCertificateS3
      ? convertS3UrlToCDN(healthCertificateS3)
      : null;
    const educationCertificate = educationCertificateS3
      ? convertS3UrlToCDN(educationCertificateS3)
      : null;
    const divorceCertificate = divorceCertificateS3
      ? convertS3UrlToCDN(divorceCertificateS3)
      : null;

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
        if (
          monthDiff < 0 ||
          (monthDiff === 0 && today.getDate() < dobDate.getDate())
        ) {
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
      userId: lockKey, // ✅ duplicate check isi userId par hota hai
      dob: processedDob, // ✅ Override with backend-processed DOB
      age: processedAge, // ✅ Override with backend-calculated Age
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
    if (error?.code === 11000) {
      const existing = await VyavahikBiodata.findOne({ userId: lockKey }).catch(
        () => null,
      );
      return sendAlreadyExists(res, existing);
    }
    console.error("❌ Biodata Creation Error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating biodata",
      error: error.message,
    });
  } finally {
    if (lockTaken) creatingUsers.delete(lockKey);
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
      { new: true },
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
    const passportPhoto = passportPhotoS3
      ? convertS3UrlToCDN(passportPhotoS3)
      : undefined;
    const fullPhoto = fullPhotoS3 ? convertS3UrlToCDN(fullPhotoS3) : undefined;
    const familyPhoto = familyPhotoS3
      ? convertS3UrlToCDN(familyPhotoS3)
      : undefined;

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
      { new: true },
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
        message: "Biodata not found",
      });
    }
    res.status(200).json({
      success: true,
      data: biodata,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching biodata",
      error: error.message,
    });
  }
};

// Get All Biodatas API
const getAllBiodatas = async (req, res) => {
  try {
    let filter = {};
    // Search Parameters
    const { age, name, gotra, panth, mulJain, upJati, dobPlace } = req.query;
    if (name) {
      filter.name = { $regex: name, $options: "i" };
    }
    if (age) {
      filter.age = age;
    }
    if (gotra) {
      filter.gotra = { $regex: gotra, $options: "i" };
    }
    if (panth) {
      filter.panth = { $regex: panth, $options: "i" };
    }
    if (mulJain) {
      filter.mulJain = { $regex: mulJain, $options: "i" };
    }
    if (upJati) {
      filter.upJati = { $regex: upJati, $options: "i" };
    }
    if (dobPlace) {
      filter.dobPlace = { $regex: dobPlace, $options: "i" };
    }
    const biodatas = await VyavahikBiodata.find(filter).populate(
      "userId",
      "firstName lastName fullName profilePicture",
    );
    res.status(200).json({
      success: true,
      data: biodatas,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching biodatas",
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
        hasBiodata: false,
      });
    }

    res.status(200).json({
      success: true,
      hasBiodata: true,
      isPaid: biodata.paymentStatus === "paid",
      isVisible: biodata.isVisible,
      biodataId: biodata._id,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error checking biodata status",
      error: error.message,
    });
  }
};
const getBiodataByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find biodata using userId
    const biodata = await VyavahikBiodata.findOne({ userId }).populate(
      "userId",
      "firstName lastName fullName profilePicture",
    );

    if (!biodata) {
      return res.status(404).json({
        success: false,
        message: "Biodata not found for this user",
      });
    }

    res.status(200).json({
      success: true,
      data: biodata,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching biodata by userId",
      error: error.message,
    });
  }
};

const toCDN = (files, key) => {
  const loc = files?.[key]?.[0]?.location;
  return loc ? convertS3UrlToCDN(loc) : null;
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
/* ══════════════════════════════════════════════════════════════
   ✅ LIFESTYLE — weight (kg, max 3 digit), smoking/drinking (Yes/No)
   Galat value aaye to save nahi hoti (crash / cast error nahi)
   ══════════════════════════════════════════════════════════════ */
const toWeightKg = (value) => {
  if (isBlankValue(value)) return undefined;
  const digits = String(value).replace(/[^0-9]/g, "");
  if (!digits || digits.length > 3) return undefined;
  const kg = Number(digits);
  return kg > 0 ? kg : undefined;
};

/* ══════════════════════════════════════════════════════════════
   ✅ EDUCATION — Highest Education mandatory (fixed options)
   School level → sirf extraQualification; Higher → college/degree/year
   ══════════════════════════════════════════════════════════════ */
const EDUCATION_LEVELS = [
  "Less than 10th",
  "10th",
  "11th",
  "12th",
  "Under Graduate",
  "Post Graduate",
  "Diploma",
  "PhD",
];
const SCHOOL_EDUCATION_LEVELS = ["Less than 10th", "10th", "11th", "12th"];
const HIGHER_EDUCATION_LEVELS = [
  "Under Graduate",
  "Post Graduate",
  "Diploma",
  "PhD",
];

const getYearOfPassingError = (value) => {
  const v = String(value).trim();
  if (!/^\d{4}$/.test(v)) return "invalid year";
  const year = Number(v);
  const maxYear = new Date().getFullYear() + 6;
  return year >= 1950 && year <= maxYear ? null : "invalid year";
};

// Create — highestEducation required + sahi option
const validateEducationForCreate = (body = {}) => {
  const missing = [];
  const invalid = [];
  if (isBlankValue(body.highestEducation)) {
    missing.push({ field: "highestEducation", label: "Highest Education" });
  } else if (!EDUCATION_LEVELS.includes(String(body.highestEducation).trim())) {
    invalid.push({
      field: "highestEducation",
      label: "Highest Education",
      reason: "invalid option",
    });
  }
  if (!isBlankValue(body.yearOfPassing)) {
    const reason = getYearOfPassingError(body.yearOfPassing);
    if (reason) {
      invalid.push({
        field: "yearOfPassing",
        label: "Year of Passing",
        reason,
      });
    }
  }
  return { missing, invalid };
};

// Edit — jo bheja gaya wo sahi ho
const validateEducationForEdit = (body = {}) => {
  const missing = [];
  const invalid = [];
  if (Object.prototype.hasOwnProperty.call(body, "highestEducation")) {
    if (isBlankValue(body.highestEducation)) {
      missing.push({ field: "highestEducation", label: "Highest Education" });
    } else if (
      !EDUCATION_LEVELS.includes(String(body.highestEducation).trim())
    ) {
      invalid.push({
        field: "highestEducation",
        label: "Highest Education",
        reason: "invalid option",
      });
    }
  }
  if (!isBlankValue(body.yearOfPassing)) {
    const reason = getYearOfPassingError(body.yearOfPassing);
    if (reason) {
      invalid.push({
        field: "yearOfPassing",
        label: "Year of Passing",
        reason,
      });
    }
  }
  return { missing, invalid };
};

// Level ke hisaab se sirf relevant fields rakho
// (purana free-text level ho to kuch mat hatao)
const shapeEducationByLevel = (education) => {
  const level = String(education.highestEducation || "").trim();
  if (SCHOOL_EDUCATION_LEVELS.includes(level)) {
    return {
      ...education,
      collegeUniversity: undefined,
      degreeName: undefined,
      yearOfPassing: undefined,
    };
  }
  if (HIGHER_EDUCATION_LEVELS.includes(level)) {
    return { ...education, extraQualification: undefined };
  }
  return education;
};

/* ══════════════════════════════════════════════════════════════
   ✅ ALTERNATE CONTACTS — name, relation, number (address nahi), max 3
   Naya app: alternateContacts (JSON array)
   Purana app: addNumber me JSON string ya sirf number + addNumberName...
   Kuch bhi na bheja ho to null (edit me purana data rahe)
   ══════════════════════════════════════════════════════════════ */
const parseAlternateContacts = (body = {}) => {
  let list = null;

  if (!isBlankValue(body.alternateContacts)) {
    try {
      const parsed =
        typeof body.alternateContacts === "string"
          ? JSON.parse(body.alternateContacts)
          : body.alternateContacts;
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      list = [];
    }
  } else if (!isBlankValue(body.addNumber)) {
    const raw = String(body.addNumber).trim();
    if (raw.startsWith("{")) {
      try {
        list = [JSON.parse(raw)];
      } catch {
        list = [];
      }
    } else {
      list = [
        {
          name: body.addNumberName,
          relation: body.addNumberRelation,
          number: raw,
        },
      ];
    }
  } else if (
    !isBlankValue(body.addNumberName) ||
    !isBlankValue(body.addNumberRelation)
  ) {
    list = [{ name: body.addNumberName, relation: body.addNumberRelation }];
  }

  if (list === null) return null;

  return list
    .map((item) => ({
      name: String(item?.name ?? "").trim(),
      relation: String(item?.relation ?? "").trim(),
      number: String(item?.number ?? item?.contact ?? "")
        .replace(/[^0-9]/g, "")
        .slice(0, 15),
    }))
    .filter((item) => item.name || item.number)
    .slice(0, 3);
};

/* ══════════════════════════════════════════════════════════════
   ✅ CLOSE RELATIVES — relation, name, occupation, city (max 5)
   Kuch na bheja ho to null (edit me purana data rahe)
   ══════════════════════════════════════════════════════════════ */
const MAX_RELATIVES = 5;

// ✅ Additional work / income (Career "Add More") — FormData JSON → array.
// undefined = bheja hi nahi (edit me purana rahe). Max 5.
const MAX_ADDITIONAL_WORK = 5;
const ADDITIONAL_WORK_STATUSES = ["Employed", "SelfEmployed", "OtherIncome"];
const parseAdditionalWork = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(list)) return undefined;
  const clean = (v, max = 120) =>
    String(v ?? "")
      .trim()
      .slice(0, max);
  return list
    .map((item) => {
      const status = clean(item?.workStatus, 30);
      const workStatus =
        status === "Self Employed"
          ? "SelfEmployed"
          : status === "Other Source of Income"
            ? "OtherIncome"
            : status;
      const isOther = workStatus === "OtherIncome";
      return {
        workStatus,
        companyName: workStatus === "Employed" ? clean(item?.companyName) : "",
        businessName:
          workStatus === "SelfEmployed" ? clean(item?.businessName) : "",
        workingIndustry: isOther ? "" : clean(item?.workingIndustry),
        workLocation: isOther ? "" : clean(item?.workLocation),
        annualIncome: clean(item?.annualIncome, 40),
        incomeSource: isOther ? clean(item?.incomeSource) : "",
      };
    })
    .filter((item) => ADDITIONAL_WORK_STATUSES.includes(item.workStatus))
    .slice(0, MAX_ADDITIONAL_WORK);
};

const parseRelatives = (value) => {
  if (value === undefined || value === null) return null;

  let list = value;
  if (typeof value === "string") {
    if (!value.trim()) return [];
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  const clean = (v) =>
    String(v ?? "")
      .trim()
      .slice(0, 100);

  return list
    .map((item) => ({
      relation: clean(item?.relation),
      name: clean(item?.name),
      // ✅ Naye fields — Phone (sirf ank, max 15) aur Residence
      phone: String(item?.phone ?? "")
        .replace(/[^0-9]/g, "")
        .slice(0, 15),
      occupation: clean(item?.occupation),
      residence: clean(item?.residence || item?.city),
      city: clean(item?.city || item?.residence), // purana field bhi bhara rahe
    }))
    .filter((item) => item.relation || item.name)
    .slice(0, MAX_RELATIVES);
};

// ✅ Close Relatives text — trim, max 1000 (undefined = bheja hi nahi)
const MAX_RELATIVES_TEXT = 1000;
const cleanRelativesText = (value) =>
  value === undefined || value === null
    ? undefined
    : String(value).trim().slice(0, MAX_RELATIVES_TEXT);

const toYesNo = (value) => {
  const v = String(value ?? "").trim();
  return v === "Yes" || v === "No" ? v : undefined;
};

const createBiodatas = async (req, res) => {
  const lockKey = String(req.user?._id || "");
  let lockTaken = false;
  try {
    const { body, files } = req;

    // ✅ Basic + Education ke mandatory fields
    const basicCheck = validateBasicForCreate(body);
    const educationCheck = validateEducationForCreate(body);
    const createMissing = [...basicCheck.missing, ...educationCheck.missing];
    const createInvalid = [...basicCheck.invalid, ...educationCheck.invalid];

    // ✅ Half Photo (passportPhoto) mandatory — app Review screen ko bypass
    // karke bhi (purana app / seedha API) bina photo profile na bane
    const halfPhotoFile = Array.isArray(files?.passportPhoto)
      ? files.passportPhoto[0]
      : files?.passportPhoto;
    if (!halfPhotoFile?.location) {
      createMissing.push({ field: "passportPhoto", label: "Half Photo" });
    }

    // ✅ Height mandatory (Lifestyle) — app bypass / purana app / seedha API
    const heightRaw = String(body.height ?? "").trim();
    if (
      !heightRaw ||
      Number.isNaN(Number(heightRaw)) ||
      Number(heightRaw) <= 0
    ) {
      createMissing.push({ field: "height", label: "Height" });
    }

    if (createMissing.length || createInvalid.length) {
      return res
        .status(400)
        .json(buildBasicErrorResponse(createMissing, createInvalid));
    }

    // ✅ Double-tap guard + max 3 profiles per user
    if (!lockKey) {
      return res.status(401).json({
        success: false,
        message: "User not identified. Please login again.",
      });
    }
    if (creatingUsers.has(lockKey)) {
      // same user ki pehli request abhi chal rahi hai (double tap)
      return sendAlreadyExists(res, null);
    }
    creatingUsers.add(lockKey);
    lockTaken = true;

    // ✅ Max 3 profiles (pehle sirf 1 tha)
    const createLimitError = await checkProfileLimit(lockKey, body.profile);
    if (createLimitError) {
      return res.status(createLimitError.status).json(createLimitError.body);
    }

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
    const education = shapeEducationByLevel({
      highestEducation: body.highestEducation,
      collegeUniversity: body.collegeUniversity,
      degreeName: body.degreeName,
      yearOfPassing: body.yearOfPassing,
      extraQualification: body.extraQualification,
      educationCertificate: educationCertificateUrl,
    });

    // ── Work Info ────────────────────────────────────────────────
    const workInfo = {
      workStatus: body.workStatus,
      companyName: body.companyName,
      businessName: body.businessName,
      workingIndustry: body.workingIndustry,
      workLocation: body.workLocation,
      annualIncome: body.annualIncome,
      // ✅ Income source sirf Unemployed ke liye
      incomeSource:
        body.workStatus === "Unemployed" ? body.incomeSource : undefined,
      // ✅ Add More — extra kaam / aay
      additionalWork: parseAdditionalWork(body.additionalWork) || [],
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
      relativesDetails: cleanRelativesText(body.relativesDetails),
      relatives: parseRelatives(body.relatives) || [], // purana app
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
    const createAlternateContacts = parseAlternateContacts(body) || [];

    const contactInfo = {
      mobileNumber: body.contactMobile || body.mobileNumber,
      contactPerson: body.contactPerson,
      email: body.email,

      // ✅ Pehla alternate contact addNumber me (purani screens ke liye) + saare list me
      addNumber: createAlternateContacts[0]
        ? {
            name: createAlternateContacts[0].name,
            number: createAlternateContacts[0].number,
            relation: createAlternateContacts[0].relation,
          }
        : undefined,
      alternateContacts: createAlternateContacts,
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
      userId: lockKey,

      // profile
      profile: body.profile,
      relationWithCandidate: body.relationWithCandidate,
      creatorName: body.creatorName,
      creatorShravakId: body.creatorShravakId,
      creatorMobile: body.creatorMobile,
      creatorCountryCode: body.creatorCountryCode,

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
      weight: toWeightKg(body.weight),
      smoking: toYesNo(body.smoking),
      drinking: toYesNo(body.drinking),
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

    // ✅ Country-wise address keys (province / postal_code ...) bhi save ho
    applyCountryAddress(biodata, parseCountryAddress(body.addressFields));

    await biodata.save();

    res.status(201).json({
      success: true,
      message: "Biodata created successfully!",
      data: biodata,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await VyavahikBiodata.findOne({ userId: lockKey }).catch(
        () => null,
      );
      return sendAlreadyExists(res, existing);
    }
    console.error("❌ Biodata Creation Error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating biodata",
      error: error.message,
    });
  } finally {
    if (lockTaken) creatingUsers.delete(lockKey);
  }
};

// ─── UPDATE / EDIT ───────────────────────────────────────────────────────────
const editBiodata = async (req, res) => {
  try {
    const { id } = req.params;
    const { body, files } = req;

    const biodata = await VyavahikBiodata.findById(id);

    if (!biodata) {
      return res.status(404).json({
        success: false,
        message: "Biodata not found",
      });
    }

    // Optional ownership check
    if (
      req.user?._id &&
      biodata.userId?.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to edit this biodata",
      });
    }

    // ✅ Bheje gaye basic fields khaali / galat na hon
    const basicEditCheck = validateBasicForEdit(body, biodata.profile);
    const educationEditCheck = validateEducationForEdit(body);
    const editMissing = [
      ...basicEditCheck.missing,
      ...educationEditCheck.missing,
    ];
    const editInvalid = [
      ...basicEditCheck.invalid,
      ...educationEditCheck.invalid,
    ];
    if (editMissing.length || editInvalid.length) {
      return res
        .status(400)
        .json(buildBasicErrorResponse(editMissing, editInvalid));
    }

    // ── Files: old preserve, new aaye to replace ─────────────────
    const educationCertificateUrl =
      toCDN(files, "educationCertificate") ||
      biodata.education?.educationCertificate;

    const divorceCertificateUrl =
      toCDN(files, "divorceCertificate") ||
      biodata.marriageInfo?.divorcedDetails?.divorceCertificate;

    // ── Photos update ────────────────────────────────────────────
    let uploadedPhotos = Array.isArray(biodata.uploadedPhotos)
      ? [...biodata.uploadedPhotos]
      : [];

    // ✅ Purani profile — photos top-level fields me thi (schema se hat chuki).
    // uploadedPhotos khaali ho to unhe yahan le aao, warna edit ke baad
    // purani Half Photo profile se gayab ho jaati
    if (!uploadedPhotos.length) {
      const legacy = biodata.toObject ? biodata.toObject() : biodata;
      [
        ["passportPhoto", "Passport Photo"],
        ["fullPhoto", "Full Photo"],
        ["familyPhoto", "Family Photo"],
      ].forEach(([key, label]) => {
        if (typeof legacy?.[key] === "string" && legacy[key].trim()) {
          uploadedPhotos.push({ label, url: legacy[key].trim() });
        }
      });
    }

    // ✅ Edit me photo DELETE — app "removePhotoUrls" (JSON array) bhejta hai.
    // Half Photo ("Passport Photo") kabhi delete nahi hogi — sirf badli ja sakti hai
    let removePhotoUrls = [];
    try {
      const rawRemove = body.removePhotoUrls;
      removePhotoUrls = Array.isArray(rawRemove)
        ? rawRemove
        : rawRemove
          ? JSON.parse(rawRemove)
          : [];
    } catch {
      removePhotoUrls = [];
    }
    if (Array.isArray(removePhotoUrls) && removePhotoUrls.length) {
      const removeSet = new Set(removePhotoUrls.map((u) => String(u)));
      uploadedPhotos = uploadedPhotos.filter(
        (p) => p?.label === "Passport Photo" || !removeSet.has(String(p?.url)),
      );
    }

    const replacePhotoByLabel = (label, url) => {
      if (!url) return;

      const index = uploadedPhotos.findIndex((p) => p.label === label);

      if (index !== -1) {
        uploadedPhotos[index] = { label, url };
      } else {
        uploadedPhotos.push({ label, url });
      }
    };

    const labeledFields = [
      { key: "passportPhoto", label: "Passport Photo" },
      { key: "fullPhoto", label: "Full Photo" },
      { key: "familyPhoto", label: "Family Photo" },
    ];

    for (const { key, label } of labeledFields) {
      const fileArr = files?.[key];
      const f = Array.isArray(fileArr) ? fileArr[0] : fileArr;

      if (f?.location) {
        replacePhotoByLabel(label, convertS3UrlToCDN(f.location));
      }
    }

    const extraPhotos = (files?.extraPhotos || [])
      .map((f, i) => ({
        label: f.originalname || `Extra Photo ${i + 1}`,
        url: convertS3UrlToCDN(f.location),
      }))
      .filter((p) => p.url);

    uploadedPhotos.push(...extraPhotos);
    uploadedPhotos = uploadedPhotos.slice(0, 10);

    // ── DOB + age ────────────────────────────────────────────────
    let processedDob = biodata.dob;
    let age = biodata.age;

    if (body.dob) {
      const d = new Date(body.dob);

      if (!isNaN(d.getTime())) {
        processedDob = d;

        const today = new Date();
        age = today.getFullYear() - d.getFullYear();

        const m = today.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
      }
    }

    // ── Parse brothers / sisters ─────────────────────────────────
    let brothers = body.brothers ?? biodata.familyInfo?.brothers ?? [];
    let sisters = body.sisters ?? biodata.familyInfo?.sisters ?? [];

    if (typeof brothers === "string") {
      try {
        brothers = JSON.parse(brothers);
      } catch {
        brothers = biodata.familyInfo?.brothers || [];
      }
    }

    if (typeof sisters === "string") {
      try {
        sisters = JSON.parse(sisters);
      } catch {
        sisters = biodata.familyInfo?.sisters || [];
      }
    }

    // ── Marriage Info ────────────────────────────────────────────
    const marriageType =
      body.marriageType || biodata.marriageInfo?.marriageType;

    const marriageInfo = {
      marriageType,
    };

    if (marriageType === "Divorced") {
      marriageInfo.divorcedDetails = {
        isDivorceComplete:
          body.isDivorceComplete ??
          biodata.marriageInfo?.divorcedDetails?.isDivorceComplete,

        reasonForDivorce:
          body.reasonForDivorce ??
          biodata.marriageInfo?.divorcedDetails?.reasonForDivorce,

        divorceCertificate: divorceCertificateUrl,

        spouseName:
          body.spouseName ?? biodata.marriageInfo?.divorcedDetails?.spouseName,

        spouseFatherName:
          body.spouseFatherName ??
          biodata.marriageInfo?.divorcedDetails?.spouseFatherName,

        spouseMotherName:
          body.spouseMotherName ??
          biodata.marriageInfo?.divorcedDetails?.spouseMotherName,

        numberOfChildren:
          body.numberOfChildren ??
          biodata.marriageInfo?.divorcedDetails?.numberOfChildren,
      };
    }

    if (marriageType === "Widowed/widower") {
      marriageInfo.widowedDetails = {
        spouseName:
          body.spouseName ?? biodata.marriageInfo?.widowedDetails?.spouseName,

        spouseFatherName:
          body.spouseFatherName ??
          biodata.marriageInfo?.widowedDetails?.spouseFatherName,

        spouseMotherName:
          body.spouseMotherName ??
          biodata.marriageInfo?.widowedDetails?.spouseMotherName,

        reasonSpouseDeath:
          body.reasonSpouseDeath ??
          biodata.marriageInfo?.widowedDetails?.reasonSpouseDeath,

        numberOfChildren:
          body.numberOfChildren ??
          biodata.marriageInfo?.widowedDetails?.numberOfChildren,
      };
    }

    // ── Update document ──────────────────────────────────────────
    biodata.profile = body.profile ?? biodata.profile;
    biodata.relationWithCandidate =
      body.relationWithCandidate ?? biodata.relationWithCandidate;
    biodata.creatorName = body.creatorName ?? biodata.creatorName;
    biodata.creatorShravakId =
      body.creatorShravakId ?? biodata.creatorShravakId;
    biodata.creatorMobile = body.creatorMobile ?? biodata.creatorMobile;
    biodata.creatorCountryCode =
      body.creatorCountryCode ?? biodata.creatorCountryCode;

    biodata.shravakId = body.shravakId ?? biodata.shravakId;
    biodata.jainShravak = body.jainShravak ?? biodata.jainShravak;
    biodata.name = body.name ?? biodata.name;
    biodata.gender = body.gender ?? biodata.gender;
    biodata.dob = processedDob;
    biodata.age = age;
    biodata.timeOfBirth = body.timeOfBirth ?? biodata.timeOfBirth;
    biodata.birthPlace = body.birthPlace ?? biodata.birthPlace;

    biodata.height = body.height ?? biodata.height;
    biodata.complexion = body.complexion ?? biodata.complexion;
    biodata.dietPreference = body.dietPreference ?? biodata.dietPreference;
    biodata.hobbies = body.hobbies ?? biodata.hobbies;
    // ✅ Sirf sahi value aaye tabhi update
    const editWeight = toWeightKg(body.weight);
    if (editWeight !== undefined) biodata.weight = editWeight;
    const editSmoking = toYesNo(body.smoking);
    if (editSmoking) biodata.smoking = editSmoking;
    const editDrinking = toYesNo(body.drinking);
    if (editDrinking) biodata.drinking = editDrinking;
    biodata.aboutMySelf = body.aboutMySelf ?? biodata.aboutMySelf;
    biodata.physicalCondition =
      body.physicalCondition ?? biodata.physicalCondition;
    biodata.physicalConditionDescribe =
      body.physicalConditionDescribe ?? biodata.physicalConditionDescribe;

    biodata.marriageInfo = marriageInfo;

    biodata.education = shapeEducationByLevel({
      highestEducation:
        body.highestEducation ?? biodata.education?.highestEducation,
      collegeUniversity:
        body.collegeUniversity ?? biodata.education?.collegeUniversity,
      degreeName: body.degreeName ?? biodata.education?.degreeName,
      yearOfPassing: body.yearOfPassing ?? biodata.education?.yearOfPassing,
      extraQualification:
        body.extraQualification ?? biodata.education?.extraQualification,
      educationCertificate: educationCertificateUrl,
    });

    biodata.workInfo = {
      workStatus: body.workStatus ?? biodata.workInfo?.workStatus,
      companyName: body.companyName ?? biodata.workInfo?.companyName,
      businessName: body.businessName ?? biodata.workInfo?.businessName,
      workingIndustry:
        body.workingIndustry ?? biodata.workInfo?.workingIndustry,
      workLocation: body.workLocation ?? biodata.workInfo?.workLocation,
      annualIncome: body.annualIncome ?? biodata.workInfo?.annualIncome,
      // ✅ Income source sirf Unemployed ke liye
      incomeSource:
        (body.workStatus ?? biodata.workInfo?.workStatus) === "Unemployed"
          ? (body.incomeSource ?? biodata.workInfo?.incomeSource)
          : undefined,
      // ✅ Add More — na bheja to purana hi rahe (workInfo poora replace hota hai)
      additionalWork:
        parseAdditionalWork(body.additionalWork) ??
        biodata.workInfo?.additionalWork ??
        [],
    };

    biodata.familyInfo = {
      fatherName: body.fatherName ?? biodata.familyInfo?.fatherName,
      fatherOccupation:
        body.fatherOccupation ?? biodata.familyInfo?.fatherOccupation,
      motherName: body.motherName ?? biodata.familyInfo?.motherName,
      motherOccupation:
        body.motherOccupation ?? biodata.familyInfo?.motherOccupation,
      nativePlace: body.nativePlace ?? biodata.familyInfo?.nativePlace,
      familyType: body.familyType ?? biodata.familyInfo?.familyType,
      familyIncome: body.familyIncome ?? biodata.familyInfo?.familyIncome,
      noOfBrothers: body.noOfBrothers ?? biodata.familyInfo?.noOfBrothers,
      brothers,
      noOfSisters: body.noOfSisters ?? biodata.familyInfo?.noOfSisters,
      sisters,
      // ✅ Naye aaye to replace, warna purane rahein
      relatives:
        parseRelatives(body.relatives) ?? biodata.familyInfo?.relatives ?? [],
      // ✅ Naya text aaya to replace, warna purana rahe
      relativesDetails:
        cleanRelativesText(body.relativesDetails) ??
        biodata.familyInfo?.relativesDetails,
    };

    biodata.communityInfo = {
      mulJain: body.mulJain ?? biodata.communityInfo?.mulJain,
      panth: body.panth ?? biodata.communityInfo?.panth,
      gotra: body.gotra ?? biodata.communityInfo?.gotra,
      subGotra: body.subGotra ?? biodata.communityInfo?.subGotra,
      caste: body.caste ?? biodata.communityInfo?.caste,
      subCaste: body.subCaste ?? biodata.communityInfo?.subCaste,
      mamaGotra: body.mamaGotra ?? biodata.communityInfo?.mamaGotra,
      manglik: body.manglik ?? biodata.communityInfo?.manglik,
      motherTongue: body.motherTongue ?? biodata.communityInfo?.motherTongue,
    };

    // ✅ Pehle ki country-wise keys (province / postal_code ...) yaad rakho —
    // neeche naya object assign hote hi ye mit jaati thi
    const BASE_ADDRESS_KEYS = [
      "country",
      "state",
      "district",
      "city",
      "fullAddress",
    ];
    const prevAddress = biodata.toObject().addressInfo || {};

    biodata.addressInfo = {
      country: body.country ?? biodata.addressInfo?.country ?? "India",
      state: body.state ?? biodata.addressInfo?.state,
      district: body.district ?? biodata.addressInfo?.district,
      city: body.city ?? biodata.addressInfo?.city,
      fullAddress: body.fullAddress ?? biodata.addressInfo?.fullAddress,
    };

    // purani extra keys wapas
    applyCountryAddress(
      biodata,
      Object.fromEntries(
        Object.entries(prevAddress).filter(
          ([k]) => !BASE_ADDRESS_KEYS.includes(k),
        ),
      ),
    );
    // naye bheje gaye country-wise fields (agar edit me address badla)
    applyCountryAddress(biodata, parseCountryAddress(body.addressFields));

    const editAlternateContacts = parseAlternateContacts(body);

    biodata.contactInfo = {
      mobileNumber:
        body.contactMobile ??
        body.mobileNumber ??
        biodata.contactInfo?.mobileNumber,

      contactPerson: body.contactPerson ?? biodata.contactInfo?.contactPerson,

      email: body.email ?? biodata.contactInfo?.email,

      // ✅ Naye contacts aaye to replace (address nahi), warna purane rahein
      addNumber: editAlternateContacts
        ? editAlternateContacts[0]
          ? {
              name: editAlternateContacts[0].name,
              number: editAlternateContacts[0].number,
              relation: editAlternateContacts[0].relation,
            }
          : undefined
        : biodata.contactInfo?.addNumber,
      alternateContacts:
        editAlternateContacts ?? biodata.contactInfo?.alternateContacts,
    };

    biodata.partnerPreference = {
      preferredAgeFrom:
        body.preferredAgeFrom ?? biodata.partnerPreference?.preferredAgeFrom,

      preferredAgeTo:
        body.preferredAgeTo ?? biodata.partnerPreference?.preferredAgeTo,

      heightFrom: body.heightFrom ?? biodata.partnerPreference?.heightFrom,

      heightTo: body.heightTo ?? biodata.partnerPreference?.heightTo,

      incomePreference:
        body.incomePreference ?? biodata.partnerPreference?.incomePreference,

      maritalStatus:
        body.partnerMaritalStatus ?? biodata.partnerPreference?.maritalStatus,

      educationPreference:
        body.educationPreference ??
        biodata.partnerPreference?.educationPreference,

      locationPreference:
        body.locationPreference ??
        biodata.partnerPreference?.locationPreference,

      additionalPreference:
        body.additionalPreference ??
        biodata.partnerPreference?.additionalPreference,
    };

    biodata.uploadedPhotos = uploadedPhotos;

    await biodata.save();

    res.status(200).json({
      success: true,
      message: "Biodata updated successfully!",
      data: biodata,
    });
  } catch (error) {
    console.error("❌ Biodata Update Error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating biodata",
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
    if (gender) filter.gender = gender;
    if (city) filter["addressInfo.city"] = new RegExp(city, "i");
    if (state) filter["addressInfo.state"] = new RegExp(state, "i");
    if (mulJain) filter["communityInfo.mulJain"] = new RegExp(mulJain, "i");
    if (panth) filter["communityInfo.panth"] = new RegExp(panth, "i");
    if (caste) filter["communityInfo.caste"] = new RegExp(caste, "i");
    if (maritalStatus) filter["marriageInfo.marriageType"] = maritalStatus;

    // age filter via dob range
    if (ageFrom || ageTo) {
      filter.dob = {};
      if (ageTo)
        filter.dob.$gte = new Date(
          new Date().setFullYear(new Date().getFullYear() - ageTo),
        );
      if (ageFrom)
        filter.dob.$lte = new Date(
          new Date().setFullYear(new Date().getFullYear() - ageFrom),
        );
    }

    // height filter
    if (heightFrom || heightTo) {
      filter.height = {};
      if (heightFrom) filter.height.$gte = Number(heightFrom);
      if (heightTo) filter.height.$lte = Number(heightTo);
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
      data: withLiveAge(biodatas), // ✅ DOB se aaj ki umar
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
      data: withLiveAge(biodata), // ✅ DOB se aaj ki umar
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
    const biodata = await VyavahikBiodata.findOne(
      await getActiveBiodataFilter(req),
    )
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
      data: withLiveAge(biodata), // ✅ DOB se aaj ki umar
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
    const myBiodata = await VyavahikBiodata.findOne(
      await getActiveBiodataFilter(req),
    );
    if (!myBiodata) {
      return res.status(404).json({
        success: false,
        message: "Your biodata not found",
      });
    }
    // target exist karta he?
    const targetBiodata = await VyavahikBiodata.findOne({
      $or: [{ _id: targetId }, { userId: targetId }],
    });

    if (!targetBiodata) {
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
      (id) => id.toString() === targetId,
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

    const myBiodata = await VyavahikBiodata.findOne(
      await getActiveBiodataFilter(req),
    );
    if (!myBiodata) {
      return res.status(404).json({
        success: false,
        message: "Your biodata not found",
      });
    }

    // liked he?
    const likedIndex = myBiodata.likedProfiles.findIndex(
      (id) => id.toString() === targetId,
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
    const myBiodata = await VyavahikBiodata.findOne(
      await getActiveBiodataFilter(req),
    )
      .populate(
        "likedProfiles",
        "name gender dob height complexion addressInfo uploadedPhotos communityInfo marriageInfo",
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
      data: withLiveAge(myBiodata.likedProfiles), // ✅ DOB se aaj ki umar
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

    if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid target profile id",
      });
    }

    // ✅ Active profile (x-biodata-id) se interest jaata hai
    const myBiodata = await VyavahikBiodata.findOne(
      await getActiveBiodataFilter(req),
    );

    if (!myBiodata) {
      return res.status(404).json({
        success: false,
        message: "Your biodata not found",
      });
    }

    const targetBiodata = await VyavahikBiodata.findOne({
      $or: [{ _id: targetId }, { userId: targetId }],
    });

    if (!targetBiodata) {
      return res.status(404).json({
        success: false,
        message: "Target profile not found",
      });
    }

    const targetProfileId = targetBiodata._id.toString();
    const myProfileId = myBiodata._id.toString();

    if (myProfileId === targetProfileId) {
      return res.status(400).json({
        success: false,
        message: "Cannot send interest to yourself",
      });
    }

    myBiodata.interestsSent = Array.isArray(myBiodata.interestsSent)
      ? myBiodata.interestsSent
      : [];

    targetBiodata.interestsReceived = Array.isArray(
      targetBiodata.interestsReceived,
    )
      ? targetBiodata.interestsReceived
      : [];

    const alreadySent = myBiodata.interestsSent.some(
      (i) => i?.profileId?.toString() === targetProfileId,
    );

    if (alreadySent) {
      return res.status(400).json({
        success: false,
        message: "Interest already sent to this profile",
      });
    }

    myBiodata.interestsSent.push({
      profileId: targetBiodata._id,
      status: "pending",
      message: message || "",
      sentAt: new Date(),
    });

    targetBiodata.interestsReceived.push({
      profileId: myBiodata._id,
      status: "pending",
      message: message || "",
      receivedAt: new Date(),
    });

    await Promise.all([myBiodata.save(), targetBiodata.save()]);

    return res.status(200).json({
      success: true,
      message: "Interest sent successfully",
    });
  } catch (error) {
    console.error("❌ Send Interest Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error sending interest",
      error: error.message,
    });
  }
};

// ─── WITHDRAW (CANCEL) SENT INTEREST ─────────────────────────────────────────
// DELETE /biodata/interest/:targetId
// ✅ Galti se bheja interest wapas lo — sirf "pending" wala; accept / reject
// ho chuka ho to nahi. Dono taraf se hatata hai (mera Sent + unka Received)
const withdrawInterest = async (req, res) => {
  try {
    const { targetId } = req.params;

    if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid target profile id",
      });
    }

    // Active profile (x-biodata-id) — sendInterest jaisa hi
    const myBiodata = await VyavahikBiodata.findOne(
      await getActiveBiodataFilter(req),
    );
    if (!myBiodata) {
      return res.status(404).json({
        success: false,
        message: "Your biodata not found",
      });
    }

    const targetBiodata = await VyavahikBiodata.findOne({
      $or: [{ _id: targetId }, { userId: targetId }],
    });
    if (!targetBiodata) {
      return res.status(404).json({
        success: false,
        message: "Target profile not found",
      });
    }

    const myProfileId = myBiodata._id.toString();
    const targetProfileId = targetBiodata._id.toString();

    const sentEntry = (myBiodata.interestsSent || []).find(
      (i) => i?.profileId?.toString() === targetProfileId,
    );
    if (!sentEntry) {
      return res.status(404).json({
        success: false,
        message: "No interest found to withdraw",
      });
    }
    if (sentEntry.status && sentEntry.status !== "pending") {
      return res.status(400).json({
        success: false,
        message:
          sentEntry.status === "accepted"
            ? "Interest already accepted. It cannot be withdrawn."
            : "Interest already responded. It cannot be withdrawn.",
      });
    }

    // Atomic $pull — dono documents se sirf pending entry hatao
    await Promise.all([
      VyavahikBiodata.updateOne(
        { _id: myBiodata._id },
        {
          $pull: {
            interestsSent: { profileId: targetBiodata._id, status: "pending" },
          },
        },
      ),
      VyavahikBiodata.updateOne(
        { _id: targetBiodata._id },
        {
          $pull: {
            interestsReceived: { profileId: myBiodata._id, status: "pending" },
          },
        },
      ),
    ]);

    return res.status(200).json({
      success: true,
      message: "Interest withdrawn successfully",
      data: { profileId: targetProfileId, by: myProfileId },
    });
  } catch (error) {
    console.error("❌ Withdraw Interest Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error withdrawing interest",
      error: error.message,
    });
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
      return res.status(400).json({
        success: false,
        message: "Status must be 'accepted' or 'rejected'",
      });
    }

    // apna biodata (receiver)
    const myBiodata = await VyavahikBiodata.findOne(
      await getActiveBiodataFilter(req),
    );
    if (!myBiodata) {
      return res
        .status(404)
        .json({ success: false, message: "Your biodata not found" });
    }

    // apne received mein entry dhundo
    const receivedEntry = myBiodata.interestsReceived.find(
      (i) => i.profileId.toString() === senderBiodataId,
    );
    if (!receivedEntry) {
      return res
        .status(404)
        .json({ success: false, message: "Interest request not found" });
    }

    if (receivedEntry.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Interest already ${receivedEntry.status}`,
      });
    }

    // apna received update
    receivedEntry.status = status;

    // sender ke interestsSent mein bhi sync
    const senderBiodata = await VyavahikBiodata.findById(senderBiodataId);
    if (senderBiodata) {
      const sentEntry = senderBiodata.interestsSent.find(
        (i) => i.profileId.toString() === myBiodata._id.toString(),
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
    res.status(500).json({
      success: false,
      message: "Error responding to interest",
      error: error.message,
    });
  }
};
// ─── GET MY SENT INTERESTS ────────────────────────────────────────────────────
// GET /biodata/interests/sent
const getSentInterests = async (req, res) => {
  try {
    const myBiodata = await VyavahikBiodata.findOne(
      await getActiveBiodataFilter(req),
    )
      .populate(
        "interestsSent.profileId",
        "name gender dob uploadedPhotos addressInfo",
      )
      .lean();

    if (!myBiodata) {
      return res.status(404).json({
        success: false,
        message: "Your biodata not found",
        total: 0,
        data: [],
      });
    }

    const interestsSent = Array.isArray(myBiodata.interestsSent)
      ? myBiodata.interestsSent
      : [];

    return res.status(200).json({
      success: true,
      message: "Sent interests fetched successfully",
      total: interestsSent.length,
      data: withLiveAge(interestsSent), // ✅ DOB se aaj ki umar
    });
  } catch (error) {
    console.error("❌ Get Sent Interests Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching sent interests",
      total: 0,
      data: [],
      error: error.message,
    });
  }
};

// ─── GET MY RECEIVED INTERESTS ────────────────────────────────────────────────
// GET /biodata/interests/received
const getReceivedInterests = async (req, res) => {
  try {
    const myBiodata = await VyavahikBiodata.findOne(
      await getActiveBiodataFilter(req),
    )
      .populate(
        "interestsReceived.profileId",
        "name gender dob uploadedPhotos addressInfo",
      )
      .lean();

    if (!myBiodata) {
      return res.status(404).json({
        success: false,
        message: "Your biodata not found",
        total: 0,
        data: [],
      });
    }

    const interestsReceived = Array.isArray(myBiodata.interestsReceived)
      ? myBiodata.interestsReceived
      : [];

    return res.status(200).json({
      success: true,
      message: "Received interests fetched successfully",
      total: interestsReceived.length,
      data: withLiveAge(interestsReceived), // ✅ DOB se aaj ki umar
    });
  } catch (error) {
    console.error("❌ Get Received Interests Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching received interests",
      total: 0,
      data: [],
      error: error.message,
    });
  }
};

/* ══════════════════════════════════════════════════════════════
   ✅ CANDIDATE SHRAVAK LOOKUP (Matrimonial — someone else)
   GET /shravak-details/:shravakId
   Sirf name, gender, dob bhejte hain — mobile/email/address nahi (privacy)
   ══════════════════════════════════════════════════════════════ */
const SHRAVAK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-/]{3,29}$/;

// Card me name/gender/dob alag key ya nested object me ho sakte hain
const pickFilled = (values) =>
  values.find((v) => v !== undefined && v !== null && String(v).trim() !== "");

const extractShravakBasics = (card) => {
  const sources = [
    card,
    card?.personalDetails,
    card?.personalInfo,
    card?.basicDetails,
    card?.basicInfo,
    card?.applicant,
    card?.details,
  ].filter((o) => o && typeof o === "object" && !Array.isArray(o));

  const get = (keys) =>
    pickFilled(sources.flatMap((o) => keys.map((k) => o[k])));

  return {
    name: get(["name", "fullName", "full_name", "naam", "applicantName"]) || "",
    gender: get(["gender", "ling", "sex"]) || "",
    dob:
      get(["dob", "dateOfBirth", "date_of_birth", "birthDate", "janmTithi"]) ||
      null,
  };
};

const getShravakBasicDetails = async (req, res) => {
  try {
    const rawId = String(req.params.shravakId || "").trim();

    if (!SHRAVAK_ID_PATTERN.test(rawId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Shravak ID format",
      });
    }

    // Model default export ho ya { JainAadhar } — dono chalein
    const JainAadharModel =
      typeof JainAadhar?.find === "function"
        ? JainAadhar
        : JainAadhar?.JainAadhar || JainAadhar?.default;

    if (!JainAadharModel || typeof JainAadharModel.find !== "function") {
      console.error("❌ JainAadhar model export not found");
      return res.status(500).json({
        success: false,
        message: "Shravak model not available",
      });
    }

    const idVariants = [...new Set([rawId, rawId.toUpperCase()])];

    const cards = await JainAadharModel.find({
      jainAadharNumber: { $in: idVariants },
    })
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean();

    const card =
      cards.find((c) => String(c.status || "").toLowerCase() === "approved") ||
      cards[0];

    if (!card) {
      return res.status(404).json({
        success: false,
        notFound: true,
        message: "Shravak card not found",
      });
    }

    const basics = extractShravakBasics(card);

    if (!basics.name && !basics.gender && !basics.dob) {
      // Field names match nahi hue — keys log karo taaki pata chale
      console.warn(
        "⚠️ Shravak card mila par name/gender/dob nahi mile. Keys:",
        Object.keys(card),
      );
    }

    // ✅ Matrimonial Community (Someone Else) ke liye — Sect / Panth / Gotra /
    // Sub Gotra / Upjati bhi. Mobile / email / address ab bhi bahar NAHI jaate.
    const pickText = (...values) => {
      for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) return text;
      }
      return "";
    };

    return res.status(200).json({
      success: true,
      data: {
        jainAadharNumber: card.jainAadharNumber,
        name: basics.name,
        gender: basics.gender,
        dob: basics.dob,
        status: card.status || "",
        mulJain: pickText(card.mulJain, card.religiousDetails?.mulJain),
        panth: pickText(card.panth, card.religiousDetails?.panth),
        gotra: pickText(card.gotra, card.religiousDetails?.gotra),
        subGotra: pickText(card.subGotra, card.religiousDetails?.subGotra),
        subCaste: pickText(
          card.subCaste,
          card.upjati,
          card.religiousDetails?.subCaste,
        ),
        // ✅ Matrimonial Family (Someone Else) — purana + naya dono card format
        fatherName: pickText(
          card.fatherName,
          card.pitaKaNaam,
          card.pitaOrpatiName,
        ),
        motherName: pickText(card.mataKaNaam, card.motherName),
        nativePlace: pickText(card.pitaKaMulNiwas, card.nativePlace),
        brotherCount: pickText(card.brotherCount),
        sisterCount: pickText(card.sisterCount),
        // Naam list — string ya {name} dono; khaali hatao
        brothers: (Array.isArray(card.brother) ? card.brother : [])
          .map((item) => pickText(typeof item === "string" ? item : item?.name))
          .filter(Boolean),
        sisters: (Array.isArray(card.sister) ? card.sister : [])
          .map((item) => pickText(typeof item === "string" ? item : item?.name))
          .filter(Boolean),
      },
    });
  } catch (error) {
    console.error("❌ getShravakBasicDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching Shravak details",
    });
  }
};

module.exports = {
  searchCities,
  getMyProfiles,
  getShravakBasicDetails,
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
  withdrawInterest,
  getSentInterests,
  getReceivedInterests,
  editBiodata,
};
