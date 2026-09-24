// controller/Rojgar/freelancerController.js
const Freelancer = require("../../model/Rojgar Modal/Freelancermodel");
const FreelancerInterest = require("../../model/Rojgar Modal/Freelancerinterestmodel");
const Notification = require("../../model/SocialMediaModels/notificationModel");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");

// ================= CREATE FREELANCER POST =================
exports.createFreelancer = async (req, res) => {
  try {
    const { user, jainAadhar, serviceName, description, skills } = req.body;

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

    const newFreelancer = new Freelancer({
      user,
      jainAadhar,
      serviceName,
      description,
      image,
      skills: skillsArr,
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
    if (req.files?.jobPost?.[0]?.location) {
      update.image = convertS3UrlToCDN(req.files.jobPost[0].location);
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
    const { title, description, demoLink } = req.body;

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
