// controller/Rojgar/jobApplicationController.js
const JobApplication = require("../../model/Rojgar Modal/Jobapplicationmodel");
const Rojgar = require("../../model/Rojgar Modal/RojgarModel");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
const Notification = require("../../model/SocialMediaModels/notificationModel");
const RojgarRecruitee = require("../../model/Rojgar Modal/RojgarRecruiteeModel");

// ================= APPLY TO A JOB =================
exports.applyToJob = async (req, res) => {
  try {
    const {
      job,
      applicant,
      jainAadhar,
      applicantName,
      applicantContact,
      applicantEmail,
      coverNote,
    } = req.body;

    if (!job || !applicant) {
      return res.status(400).json({
        success: false,
        message: "Job and applicant are required.",
      });
    }

    // Job maujood hai?
    const jobDoc = await Rojgar.findById(job);
    if (!jobDoc) {
      return res.status(404).json({
        success: false,
        message: "Job not found.",
      });
    }

    // Apni hi job par apply na kare
    if (
      jobDoc.user &&
      applicant &&
      jobDoc.user.toString() === applicant.toString()
    ) {
      return res.status(400).json({
        success: false,
        message: "You cannot apply to your own job post.",
      });
    }

    // Already applied?
    const existing = await JobApplication.findOne({ job, applicant });
    if (existing) {
      return res.status(409).json({
        success: false,
        alreadyApplied: true,
        message: "You have already applied to this job.",
      });
    }

    // Resume upload (candidateResume field – same middleware as candidate form)
    let resume = "";
    if (req.files?.candidateResume?.[0]?.location) {
      resume = convertS3UrlToCDN(req.files.candidateResume[0].location);
    } else if (req.body.resume) {
      // Job seeker ka pehle se saved resume (RojgarRecruitee) reuse
      resume = req.body.resume;
    }

    const application = new JobApplication({
      job,
      applicant,
      jainAadhar,
      applicantName,
      applicantContact,
      applicantEmail,
      coverNote,
      resume,
    });

    const saved = await application.save();

    // Job doc par applied tracking update (additive)
    try {
      const updatedJob = await Rojgar.findByIdAndUpdate(
        job,
        { $addToSet: { appliedUsers: applicant } },
        { new: true },
      );
      if (updatedJob) {
        updatedJob.appliedCount = Array.isArray(updatedJob.appliedUsers)
          ? updatedJob.appliedUsers.length
          : 0;
        await updatedJob.save();
      }
    } catch (e) {
      console.error("appliedCount update error:", e.message);
    }

    // Job owner ko notification (FCM auto via post-save hook)
    try {
      if (jobDoc.user && jobDoc.user.toString() !== applicant.toString()) {
        await Notification.create({
          senderId: applicant,
          receiverId: jobDoc.user,
          type: "job_application",
          jobId: job,
          message: `${applicantName || "Someone"} applied to your job${
            jobDoc.jobName ? ": " + jobDoc.jobName : ""
          }`,
        });
      }
    } catch (e) {
      console.error("job application notification error:", e.message);
    }

    res.status(201).json({
      success: true,
      message: "Application submitted successfully.",
      data: saved,
    });
  } catch (error) {
    // Duplicate key (race condition safety)
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        alreadyApplied: true,
        message: "You have already applied to this job.",
      });
    }
    console.error("Apply Job Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= APPLICANTS FOR A JOB (recruiter) =================
exports.getApplicationsForJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    let applications = await JobApplication.find({ job: jobId })
      .populate("applicant", "fullName profilePicture")
      .sort({ createdAt: -1 });

    applications = applications.map((item) => ({
      ...item._doc,
      resume: item.resume ? convertS3UrlToCDN(item.resume) : "",
      applicant: item.applicant
        ? {
            ...item.applicant._doc,
            profilePicture: item.applicant.profilePicture
              ? convertS3UrlToCDN(item.applicant.profilePicture)
              : "",
          }
        : null,
    }));

    res.status(200).json({
      success: true,
      count: applications.length,
      data: applications,
    });
  } catch (error) {
    console.error("Get Applications Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= MY APPLICATIONS (candidate) =================
exports.getMyApplications = async (req, res) => {
  try {
    const { userId } = req.params;

    const applications = await JobApplication.find({ applicant: userId })
      .populate("job", "jobName companyName location jobType salary")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: applications.length,
      data: applications,
    });
  } catch (error) {
    console.error("Get My Applications Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= UPDATE APPLICATION STATUS (recruiter) =================
exports.getSuggestedJobs = async (req, res) => {
  try {
    const { userId } = req.params;

    // User ki latest job-seeker (recruitee) profile
    const profile = await RojgarRecruitee.findOne({ user: userId }).sort({
      createdAt: -1,
    });
    const field = profile && profile.field ? profile.field.trim() : "";

    if (!field) {
      return res.status(200).json({ success: true, field: "", data: [] });
    }

    const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(esc, "i");
    const now = new Date();

    let jobs = await Rojgar.find({
      user: { $ne: userId },
      $and: [
        {
          $or: [
            { expireDate: { $gte: now } },
            { expireDate: { $exists: false } },
          ],
        },
        {
          $or: [
            { jobName: rx },
            { jobDescription: rx },
            { education: rx },
            { companyName: rx },
          ],
        },
      ],
    })
      .populate("user", "fullName profilePicture")
      .sort({ createdAt: -1 })
      .limit(20);

    res.status(200).json({ success: true, field, data: jobs });
  } catch (error) {
    console.error("Suggested jobs error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateApplicationStatus = async (req, res) => {
  try {
    const { appId } = req.params;
    const { status } = req.body;

    const allowed = ["applied", "shortlisted", "rejected", "hired"];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value.",
      });
    }

    const updated = await JobApplication.findByIdAndUpdate(
      appId,
      { status },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Application not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Status updated.",
      data: updated,
    });
  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
