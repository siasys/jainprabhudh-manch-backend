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
      return res
        .status(403)
        .json({
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
        updatedAt: saved.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================= COVER PHOTO (owner only) =================
// User model ka coverPicture hi update hota hai, taki app ke main profile me bhi same cover dikhe.
exports.uploadCover = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isOwner(req, userId)) {
      return res
        .status(403)
        .json({
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
    await User.findByIdAndUpdate(userId, { coverPicture: url });

    res
      .status(200)
      .json({
        success: true,
        message: "Cover photo updated.",
        coverPicture: url,
      });
  } catch (error) {
    console.error("Upload Cover Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
