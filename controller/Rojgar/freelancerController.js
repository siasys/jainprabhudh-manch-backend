// controller/Rojgar/freelancerController.js
const Freelancer = require("../../model/Rojgar Modal/Freelancermodel");
const FreelancerInterest = require("../../model/Rojgar Modal/Freelancerinterestmodel");
const Notification = require("../../model/SocialMediaModels/notificationModel");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
const FreelancerReview = require("../../model/Rojgar Modal/FreelancerReviewModel");
const mongoose = require("mongoose");

// ================= NEW: Fiverr-style gig helpers =================
// FormData se packages / faqs JSON string me aate hai.
const parseJSON = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const txt = (v, max) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined;
};
const TIERS = ["basic", "standard", "premium"];

// NEW: portfolio ka demo link — sirf sahi http/https link (khaali chalega)
// "abc", "javascript:..." jaise text save nahi honge
const LINK_ERROR = "Enter a valid link that starts with http:// or https://";
const cleanLink = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return { ok: true, value: "" };
  if (s.length > 500 || /\s/.test(s)) return { ok: false };
  try {
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol)) return { ok: false };
    if (!u.hostname.includes(".") && u.hostname !== "localhost")
      return { ok: false };
    return { ok: true, value: s };
  } catch {
    return { ok: false };
  }
};

const cleanPackages = (raw) => {
  const list = parseJSON(raw, []);
  if (!Array.isArray(list)) return [];
  return TIERS.map((tier) => list.find((p) => p && p.tier === tier))
    .filter((p) => p && num(p.price, 0, 10000000) !== undefined)
    .map((p) => ({
      tier: p.tier,
      title: txt(p.title, 80),
      description: txt(p.description, 300),
      price: num(p.price, 0, 10000000),
      deliveryDays: num(p.deliveryDays, 1, 365) || 1,
      revisions: num(p.revisions, 0, 99) ?? 0,
      features: Array.isArray(p.features)
        ? p.features
            .map((f) => txt(f, 80))
            .filter(Boolean)
            .slice(0, 10)
        : [],
    }));
};

const cleanFaqs = (raw) => {
  const list = parseJSON(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .map((f) => ({
      question: txt(f?.question, 200),
      answer: txt(f?.answer, 600),
    }))
    .filter((f) => f.question && f.answer)
    .slice(0, 10);
};

// Average rating dobara nikal kar freelancer doc par save karo
const recalcRating = async (freelancerId) => {
  const [stats] = await FreelancerReview.aggregate([
    {
      $match: { freelancer: new mongoose.Types.ObjectId(String(freelancerId)) },
    },
    { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  const ratingAvg = stats ? Math.round(stats.avg * 10) / 10 : 0;
  const ratingCount = stats ? stats.count : 0;
  await Freelancer.findByIdAndUpdate(freelancerId, { ratingAvg, ratingCount });
  return { ratingAvg, ratingCount };
};

// ================= CREATE FREELANCER POST =================
exports.createFreelancer = async (req, res) => {
  try {
    const { user, jainAadhar, serviceName, description, skills } = req.body;
    // NEW (optional): Fiverr-style fields
    const { category, packages, faqs } = req.body;

    let skillsArr = [];
    if (Array.isArray(skills)) {
      skillsArr = skills;
    } else if (typeof skills === "string" && skills.trim()) {
      skillsArr = skills
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User is required.",
      });
    }

    let image = "";
    if (req.files?.jobPost?.[0]?.location) {
      image = convertS3UrlToCDN(req.files.jobPost[0].location);
    }

    // NEW: pehli image cover (pehle jaisa), baaki images gallery me
    const gallery = (req.files?.jobPost || [])
      .slice(1)
      .filter((f) => f.location)
      .map((f) => convertS3UrlToCDN(f.location));

    const newFreelancer = new Freelancer({
      user,
      jainAadhar,
      serviceName,
      description,
      image,
      skills: skillsArr,
      category: txt(category, 60),
      packages: cleanPackages(packages),
      faqs: cleanFaqs(faqs),
      gallery,
    });

    const saved = await newFreelancer.save();

    res.status(201).json({
      success: true,
      message: "Freelancer post created successfully.",
      data: saved,
    });
  } catch (error) {
    console.error("Create Freelancer Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= GET ALL FREELANCERS =================
exports.getAllFreelancers = async (req, res) => {
  try {
    let freelancers = await Freelancer.find()
      .populate("user", "fullName profilePicture")
      .sort({ createdAt: -1 });

    freelancers = freelancers.map((item) => ({
      ...item._doc,
      image: item.image ? convertS3UrlToCDN(item.image) : "",
      gallery: Array.isArray(item.gallery)
        ? item.gallery.filter(Boolean).map((g) => convertS3UrlToCDN(g))
        : [],
      portfolio: Array.isArray(item.portfolio)
        ? item.portfolio.map((p) => ({
            ...(p._doc || p),
            image: p.image ? convertS3UrlToCDN(p.image) : "",
          }))
        : [],
      user: item.user
        ? {
            ...item.user._doc,
            profilePicture: item.user.profilePicture
              ? convertS3UrlToCDN(item.user.profilePicture)
              : "",
          }
        : null,
    }));

    res.status(200).json({
      success: true,
      count: freelancers.length,
      data: freelancers,
    });
  } catch (error) {
    console.error("Get Freelancers Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= SHOW INTEREST =================
exports.showInterest = async (req, res) => {
  try {
    const { freelancer, interestedUser, message } = req.body;

    if (!freelancer || !interestedUser) {
      return res.status(400).json({
        success: false,
        message: "Freelancer and user are required.",
      });
    }

    const freelancerDoc = await Freelancer.findById(freelancer);
    if (!freelancerDoc) {
      return res.status(404).json({
        success: false,
        message: "Freelancer post not found.",
      });
    }

    // Apni hi post par interest nahi
    if (
      freelancerDoc.user &&
      freelancerDoc.user.toString() === interestedUser.toString()
    ) {
      return res.status(400).json({
        success: false,
        message: "You cannot show interest on your own post.",
      });
    }

    // Already interested?
    const existing = await FreelancerInterest.findOne({
      freelancer,
      interestedUser,
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        alreadyInterested: true,
        message: "You have already shown interest.",
      });
    }

    const saved = await FreelancerInterest.create({
      freelancer,
      interestedUser,
      message,
    });

    // Count update
    try {
      const updated = await Freelancer.findByIdAndUpdate(
        freelancer,
        { $addToSet: { interestedUsers: interestedUser } },
        { new: true },
      );
      if (updated) {
        updated.interestedCount = Array.isArray(updated.interestedUsers)
          ? updated.interestedUsers.length
          : 0;
        await updated.save();
      }
    } catch (e) {
      console.error("interestedCount update error:", e.message);
    }

    // Freelancer ko notification (FCM auto via notification post-save hook)
    try {
      await Notification.create({
        senderId: interestedUser,
        receiverId: freelancerDoc.user,
        type: "freelancer_interest",
        freelancerId: freelancer,
        message: `Someone is interested in your service${
          freelancerDoc.serviceName ? ": " + freelancerDoc.serviceName : ""
        }`,
      });
    } catch (e) {
      console.error("freelancer interest notification error:", e.message);
    }

    res.status(201).json({
      success: true,
      message: "Interest submitted successfully.",
      data: saved,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        alreadyInterested: true,
        message: "You have already shown interest.",
      });
    }
    console.error("Show Interest Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= INTERESTED USERS FOR A POST =================
exports.getInterestedUsers = async (req, res) => {
  try {
    const { freelancerId } = req.params;

    let interests = await FreelancerInterest.find({
      freelancer: freelancerId,
    })
      .populate("interestedUser", "fullName profilePicture")
      .sort({ createdAt: -1 });

    interests = interests.map((item) => ({
      ...item._doc,
      interestedUser: item.interestedUser
        ? {
            ...item.interestedUser._doc,
            profilePicture: item.interestedUser.profilePicture
              ? convertS3UrlToCDN(item.interestedUser.profilePicture)
              : "",
          }
        : null,
    }));

    res.status(200).json({
      success: true,
      count: interests.length,
      data: interests,
    });
  } catch (error) {
    console.error("Get Interested Users Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= MY INTERESTS (jinpe maine interest diya) =================
exports.getMyInterests = async (req, res) => {
  try {
    const { userId } = req.params;

    const interests = await FreelancerInterest.find({
      interestedUser: userId,
    }).select("freelancer");

    res.status(200).json({
      success: true,
      count: interests.length,
      data: interests,
    });
  } catch (error) {
    console.error("Get My Interests Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= UPDATE FREELANCER PROFILE =================
exports.updateFreelancer = async (req, res) => {
  try {
    const { id } = req.params;
    const { serviceName, description, skills } = req.body;

    const update = {};
    if (serviceName !== undefined) update.serviceName = serviceName;
    if (description !== undefined) update.description = description;
    if (skills !== undefined) {
      let skillsArr = [];
      if (Array.isArray(skills)) {
        skillsArr = skills;
      } else if (typeof skills === "string" && skills.trim()) {
        skillsArr = skills
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      }
      update.skills = skillsArr;
    }
    // NEW (optional) Fiverr-style fields
    if (req.body.category !== undefined)
      update.category = txt(req.body.category, 60);
    if (req.body.packages !== undefined)
      update.packages = cleanPackages(req.body.packages);
    if (req.body.faqs !== undefined) update.faqs = cleanFaqs(req.body.faqs);

    // galleryMode = "append" ho to nayi images gallery me judti hai (cover nahi badalta).
    // gallery = JSON list ho to sirf wahi purani images rakhi jaati hai (remove ke liye).
    const appendGallery = req.body.galleryMode === "append";
    const newGallery = appendGallery
      ? (req.files?.jobPost || [])
          .filter((f) => f.location)
          .map((f) => convertS3UrlToCDN(f.location))
      : [];
    const keepGallery = parseJSON(req.body.gallery, null);

    if (!appendGallery && req.files?.jobPost?.[0]?.location) {
      update.image = convertS3UrlToCDN(req.files.jobPost[0].location);
    }
    if (Array.isArray(keepGallery)) {
      update.gallery = [
        ...keepGallery.filter((g) => typeof g === "string" && g),
        ...newGallery,
      ].slice(0, 10);
    } else if (newGallery.length) {
      update.$push = { gallery: { $each: newGallery } };
    }

    const updated = await Freelancer.findByIdAndUpdate(id, update, {
      new: true,
    });
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Freelancer post not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated.",
      data: updated,
    });
  } catch (error) {
    console.error("Update Freelancer Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================= ADD PORTFOLIO ITEM =================
exports.addPortfolioItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;

    // NEW: galat link save na ho
    const link = cleanLink(req.body.demoLink);
    if (!link.ok) {
      return res.status(400).json({ success: false, message: LINK_ERROR });
    }
    const demoLink = link.value;

    let image = "";
    if (req.files?.jobPost?.[0]?.location) {
      image = convertS3UrlToCDN(req.files.jobPost[0].location);
    }

    const updated = await Freelancer.findByIdAndUpdate(
      id,
      { $push: { portfolio: { title, description, demoLink, image } } },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Freelancer post not found.",
      });
    }

    res.status(201).json({
      success: true,
      message: "Portfolio item added.",
      data: updated,
    });
  } catch (error) {
    console.error("Add Portfolio Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================= NEW: EDIT PORTFOLIO ITEM =================
// PUT /freelancer/portfolio/:id/:itemId  — title / description / demoLink badlo,
// nayi image (jobPost) aaye to image badlo, removeImage = "true" ho to image hatao.
exports.updatePortfolioItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;
    if (
      !mongoose.Types.ObjectId.isValid(id) ||
      !mongoose.Types.ObjectId.isValid(itemId)
    ) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }

    const set = {};
    if (req.body.title !== undefined) {
      const title = txt(req.body.title, 120);
      if (!title) {
        return res
          .status(400)
          .json({ success: false, message: "Add a project title." });
      }
      set["portfolio.$.title"] = title;
    }
    if (req.body.description !== undefined)
      set["portfolio.$.description"] = txt(req.body.description, 600);
    if (req.body.demoLink !== undefined) {
      const link = cleanLink(req.body.demoLink);
      if (!link.ok) {
        return res.status(400).json({ success: false, message: LINK_ERROR });
      }
      set["portfolio.$.demoLink"] = link.value;
    }
    if (req.files?.jobPost?.[0]?.location) {
      set["portfolio.$.image"] = convertS3UrlToCDN(
        req.files.jobPost[0].location,
      );
    } else if (String(req.body.removeImage) === "true") {
      set["portfolio.$.image"] = "";
    }

    const updated = await Freelancer.findOneAndUpdate(
      { _id: id, "portfolio._id": itemId },
      { $set: set },
      { new: true },
    );
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Project not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Project updated.",
      data: updated,
    });
  } catch (error) {
    console.error("Update Portfolio Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================= DELETE PORTFOLIO ITEM =================
exports.deletePortfolioItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;

    const updated = await Freelancer.findByIdAndUpdate(
      id,
      { $pull: { portfolio: { _id: itemId } } },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Freelancer post not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Portfolio item removed.",
      data: updated,
    });
  } catch (error) {
    console.error("Delete Portfolio Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ================= DELETE FREELANCER POST =================
exports.deleteFreelancer = async (req, res) => {
  try {
    const deleted = await Freelancer.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Freelancer post not found.",
      });
    }

    try {
      await FreelancerInterest.deleteMany({ freelancer: req.params.id });
      await FreelancerReview.deleteMany({ freelancer: req.params.id });
    } catch (e) {
      console.error("Interest cleanup error:", e.message);
    }

    res.status(200).json({
      success: true,
      message: "Freelancer post deleted successfully.",
    });
  } catch (error) {
    console.error("Delete Freelancer Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= NEW: REVIEWS / RATING =================
const reviewerView = (r) => ({
  ...r,
  reviewer: r.reviewer
    ? {
        _id: r.reviewer._id,
        fullName: r.reviewer.fullName || "",
        profilePicture: r.reviewer.profilePicture
          ? convertS3UrlToCDN(r.reviewer.profilePicture)
          : "",
      }
    : null,
});

// GET /freelancer/:id/reviews  (public)
exports.getReviews = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid freelancer id." });
    }
    const reviews = await FreelancerReview.find({ freelancer: id })
      .populate("reviewer", "fullName profilePicture")
      .sort({ createdAt: -1 })
      .lean();

    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach(
      (r) => (breakdown[r.rating] = (breakdown[r.rating] || 0) + 1),
    );
    const count = reviews.length;
    const avg = count
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) /
        10
      : 0;

    res.status(200).json({
      success: true,
      avg,
      count,
      breakdown,
      data: reviews.map(reviewerView),
    });
  } catch (error) {
    console.error("Get Reviews Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /freelancer/:id/reviews  (login) — naya review, ya apna purana review update
exports.addReview = async (req, res) => {
  try {
    const { id } = req.params;
    const reviewerId = req.userId;
    const rating = Number(req.body.rating);
    const comment = txt(req.body.comment, 1000);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ success: false, message: "Rating must be between 1 and 5." });
    }
    const gig = await Freelancer.findById(id).select("user serviceName");
    if (!gig) {
      return res
        .status(404)
        .json({ success: false, message: "Freelancer post not found." });
    }
    if (gig.user && gig.user.toString() === reviewerId.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot review your own service.",
      });
    }
    // Sirf wahi review de sakta hai jisne interest bheja tha
    const hasInterest = await FreelancerInterest.exists({
      freelancer: id,
      interestedUser: reviewerId,
    });
    if (!hasInterest) {
      return res.status(403).json({
        success: false,
        message:
          "Send interest and work with this freelancer before leaving a review.",
      });
    }

    const existing = await FreelancerReview.findOne({
      freelancer: id,
      reviewer: reviewerId,
    });
    const review = await FreelancerReview.findOneAndUpdate(
      { freelancer: id, reviewer: reviewerId },
      { $set: { rating, comment } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
      .populate("reviewer", "fullName profilePicture")
      .lean();

    const stats = await recalcRating(id);

    if (!existing) {
      try {
        await Notification.create({
          senderId: reviewerId,
          receiverId: gig.user,
          type: "freelancer_review",
          freelancerId: id,
          message: `New ${rating}-star review on your service${gig.serviceName ? ": " + gig.serviceName : ""}`,
        });
      } catch (e) {
        console.error("freelancer review notification error:", e.message);
      }
    }

    res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "Review updated." : "Review added.",
      data: reviewerView(review),
      ...stats,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "You have already reviewed this service.",
      });
    }
    console.error("Add Review Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /freelancer/:id/reviews/:reviewId  (review likhne wala ya admin)
exports.deleteReview = async (req, res) => {
  try {
    const { id, reviewId } = req.params;
    const review = await FreelancerReview.findOne({
      _id: reviewId,
      freelancer: id,
    });
    if (!review) {
      return res
        .status(404)
        .json({ success: false, message: "Review not found." });
    }
    const isAdmin = ["admin", "superadmin"].includes(req.user?.role);
    if (!isAdmin && review.reviewer.toString() !== req.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own review.",
      });
    }
    await review.deleteOne();
    const stats = await recalcRating(id);
    res
      .status(200)
      .json({ success: true, message: "Review deleted.", ...stats });
  } catch (error) {
    console.error("Delete Review Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /freelancer/:id/reviews/:reviewId/reply  (sirf service ka owner)
exports.replyToReview = async (req, res) => {
  try {
    const { id, reviewId } = req.params;
    const gig = await Freelancer.findById(id).select("user");
    if (!gig) {
      return res
        .status(404)
        .json({ success: false, message: "Freelancer post not found." });
    }
    if (gig.user.toString() !== req.userId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Only the freelancer can reply." });
    }
    const text = txt(req.body.text, 600);
    const review = await FreelancerReview.findOneAndUpdate(
      { _id: reviewId, freelancer: id },
      text
        ? { $set: { reply: { text, at: new Date() } } }
        : { $unset: { reply: 1 } },
      { new: true },
    )
      .populate("reviewer", "fullName profilePicture")
      .lean();
    if (!review) {
      return res
        .status(404)
        .json({ success: false, message: "Review not found." });
    }
    res.status(200).json({
      success: true,
      message: text ? "Reply saved." : "Reply removed.",
      data: reviewerView(review),
    });
  } catch (error) {
    console.error("Reply Review Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
