// controller/Rojgar/profileController.js
const mongoose = require("mongoose");
const Profile = require("../../model/Rojgar Modal/ProfileModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");

// Frontend ke sections.js jaisa hi — sirf yahi fields save honge.
const SECTION_FIELDS = {
  experience: [
    "title",
    "company",
    "type",
    "location",
    "current",
    "start",
    "end",
    "description",
  ],
  education: [
    "school",
    "degree",
    "field",
    "grade",
    "start",
    "end",
    "description",
  ],
  projects: ["name", "link", "start", "end", "skills", "description"],
  services: ["name", "price", "description"],
  careerBreak: ["type", "start", "end", "description"],
  skills: ["name"],
  featured: ["title", "link", "description"],
  licenses: ["name", "org", "issued", "expires", "credentialId", "link"],
  courses: ["name", "number", "associated"],
  recommendations: ["from", "relation", "text"],
  volunteer: ["org", "role", "cause", "start", "end", "description"],
  publications: ["title", "publisher", "date", "link", "description"],
  languages: ["name", "level"],
  honors: ["title", "issuer", "date", "description"],
};
const BOOLEAN_FIELDS = new Set(["current"]);
const LINK_FIELDS = new Set(["link"]);
const MAX_ITEMS = 50;
const MAX_LEN = 2000;
const MAX_HIRING_JOBS = 20; // NEW: Hiring card me zyada se zyada itni jobs
const WORK_TYPES = [
  "Full-time",
  "Part-time",
  "Internship",
  "Freelance",
  "Remote",
];

const str = (v, max = MAX_LEN) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const newId = () => new mongoose.Types.ObjectId().toString();

// Sirf http/https link — "javascript:" jaise link save nahi honge
const safeLink = (v) => {
  const s = str(v, 500);
  return /^https?:\/\//i.test(s) ? s : "";
};

const cleanSections = (input) => {
  const out = {};
  if (!input || typeof input !== "object") return out;
  Object.keys(SECTION_FIELDS).forEach((key) => {
    const list = Array.isArray(input[key])
      ? input[key].slice(0, MAX_ITEMS)
      : [];
    out[key] = list
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const clean = {
          id:
            typeof item.id === "string" && /^[\w-]{1,40}$/.test(item.id)
              ? item.id
              : newId(),
        };
        SECTION_FIELDS[key].forEach((f) => {
          if (item[f] === undefined) return;
          if (BOOLEAN_FIELDS.has(f)) clean[f] = !!item[f];
          else if (LINK_FIELDS.has(f)) clean[f] = safeLink(item[f]);
          else clean[f] = str(item[f]);
        });
        return clean;
      });
  });
  return out;
};

const cleanIntro = (intro = {}) => ({
  headline: str(intro.headline, 120),
  location: str(intro.location, 120),
  openToWork: !!intro.openToWork,
  openRoles: str(intro.openRoles, 200),
  openTypes: Array.isArray(intro.openTypes)
    ? intro.openTypes.filter((t) => WORK_TYPES.includes(t))
    : [],
  // NEW: Hiring
  hiring: !!intro.hiring,
  hiringJobIds: Array.isArray(intro.hiringJobIds)
    ? [
        ...new Set(
          intro.hiringJobIds
            .map((id) => String(id ?? ""))
            .filter((id) => mongoose.Types.ObjectId.isValid(id)),
        ),
      ].slice(0, MAX_HIRING_JOBS)
    : [],
});

const userView = (u) =>
  u
    ? {
        _id: u._id,
        fullName: u.fullName || "",
        profilePicture: u.profilePicture
          ? convertS3UrlToCDN(u.profilePicture)
          : "",
        coverPicture: u.coverPicture ? convertS3UrlToCDN(u.coverPicture) : "",
        jainAadharNumber: u.jainAadharNumber || "",
      }
    : null;

const emptyProfile = () => ({
  intro: cleanIntro(),
  about: "",
  sections: {},
  seeded: false,
  photo: "",
  cover: "",
});

// Login user wahi hai jiska profile hai (ya admin)?
const isOwner = (req, userId) =>
  (req.userId && req.userId.toString() === String(userId)) ||
  ["admin", "superadmin"].includes(req.user?.role);

// ================= GET PROFILE (public) =================
exports.getProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user id." });
    }

    const [profile, user] = await Promise.all([
      Profile.findOne({ user: userId }).lean(),
      User.findById(userId)
        .select("fullName profilePicture coverPicture jainAadharNumber")
        .lean(),
    ]);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    res.status(200).json({
      success: true,
      exists: !!profile,
      data: profile
        ? {
            intro: profile.intro,
            about: profile.about,
            sections: profile.sections || {},
            seeded: profile.seeded,
            // NEW: Employment profile ki apni photo / cover
            photo: profile.photo ? convertS3UrlToCDN(profile.photo) : "",
            cover: profile.cover ? convertS3UrlToCDN(profile.cover) : "",
            updatedAt: profile.updatedAt,
          }
        : emptyProfile(),
      user: userView(user),
    });
  } catch (error) {
    console.error("Get Profile Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================= SAVE PROFILE (owner only) =================
exports.updateProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user id." });
    }
    if (!isOwner(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own profile.",
      });
    }

    const { intro, about, sections, seeded } = req.body || {};
    const update = {
      intro: cleanIntro(intro),
      about: str(about, 2000),
      sections: cleanSections(sections),
      seeded: !!seeded,
    };

    const saved = await Profile.findOneAndUpdate(
      { user: userId },
      { $set: update, $setOnInsert: { user: userId } },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    res.status(200).json({
      success: true,
      message: "Profile saved.",
      data: {
        intro: saved.intro,
        about: saved.about,
        sections: saved.sections || {},
        seeded: saved.seeded,
        photo: saved.photo ? convertS3UrlToCDN(saved.photo) : "",
        cover: saved.cover ? convertS3UrlToCDN(saved.cover) : "",
        updatedAt: saved.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Employment profile me photo / cover save karo (profile na ho to ban jayega)
const saveProfileMedia = (userId, field, url) =>
  Profile.findOneAndUpdate(
    { user: userId },
    { $set: { [field]: url }, $setOnInsert: { user: userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

// ================= COVER PHOTO (owner only) =================
// UPDATED: ab cover sirf Employment profile me save hota hai — login user ka main cover nahi badalta.
exports.uploadCover = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isOwner(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "You can only change your own cover photo.",
      });
    }
    const file = req.files?.coverPicture?.[0];
    if (!file?.location) {
      return res
        .status(400)
        .json({ success: false, message: "Please choose an image." });
    }

    const url = convertS3UrlToCDN(file.location);
    await saveProfileMedia(userId, "cover", url);

    res.status(200).json({
      success: true,
      message: "Cover photo updated.",
      coverPicture: url,
    });
  } catch (error) {
    console.error("Upload Cover Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================= PROFILE PHOTO (owner only) =================
// NEW: Employment profile ki apni photo — login user ki main profile photo nahi badalti.
exports.uploadPhoto = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user id." });
    }
    if (!isOwner(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "You can only change your own profile photo.",
      });
    }
    const file = req.files?.profilePicture?.[0];
    if (!file?.location) {
      return res
        .status(400)
        .json({ success: false, message: "Please choose an image." });
    }

    const url = convertS3UrlToCDN(file.location);
    await saveProfileMedia(userId, "photo", url);

    res.status(200).json({
      success: true,
      message: "Profile photo updated.",
      photo: url,
    });
  } catch (error) {
    console.error("Upload Profile Photo Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================= REMOVE PHOTO / COVER (owner only) =================
// NEW: Employment profile se photo ya cover hatao (login user ki main photo/cover par koi asar nahi)
const removeProfileMedia = (field, label) => async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user id." });
    }
    if (!isOwner(req, userId)) {
      return res.status(403).json({
        success: false,
        message: `You can only remove your own ${label}.`,
      });
    }
    await Profile.findOneAndUpdate(
      { user: userId },
      { $set: { [field]: "" } },
      { new: true },
    );
    res.status(200).json({
      success: true,
      message: `${label.charAt(0).toUpperCase()}${label.slice(1)} removed.`,
    });
  } catch (error) {
    console.error(`Remove ${label} Error:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.removePhoto = removeProfileMedia("photo", "profile photo");
exports.removeCover = removeProfileMedia("cover", "cover photo");
