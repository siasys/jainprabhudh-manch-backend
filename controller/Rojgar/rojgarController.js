// controllers/rojgarController.js
const Rojgar = require("../../model/Rojgar Modal/RojgarModel");
const RojgarRecruitee = require("../../model/Rojgar Modal/RojgarRecruiteeModel");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
// NEW: job profile delete par resume S3 se bhi hatane ke liye
const mongoose = require("mongoose");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../../config/s3Config");
const JobApplication = require("../../model/Rojgar Modal/Jobapplicationmodel");

// S3 / CDN URL se file ka key nikalo, jaise https://cdn.../resumes/abc.pdf -> resumes/abc.pdf
const s3KeyFromUrl = (url) => {
  try {
    const key = decodeURIComponent(
      new URL(String(url)).pathname.replace(/^\/+/, ""),
    );
    return key || null;
  } catch {
    return null;
  }
};

// S3 se file hatao. Fail ho to sirf log, request nahi rukti.
const deleteFromS3 = async (url) => {
  const key = s3KeyFromUrl(url);
  if (!key) return false;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
      }),
    );
    return true;
  } catch (e) {
    console.error("S3 delete error:", key, e.message);
    return false;
  }
};

// NEW: phone ka basic check (country code ke saath ya bina). Desh-wise check frontend countryConfig se hota hai.
// Mobile app ke purane format (sirf digits / +91XXXXXXXXXX) bhi chalte rahenge.
const isValidPhone = (value) => {
  const s = String(value || "").trim();
  if (!s) return true;
  if (!/^\+?[\d\s()-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
};

// Create a new job
exports.createJob = async (req, res) => {
  try {
    const {
      user,
      jainAadhar,
      companyName,
      jobName,
      jobType,
      jobDescription,
      education,
      experience,
      salary,
      age,
      language,
      gender,
      location,
      jobContact,
      jobEmail,
    } = req.body;

    // NEW: galat phone number save na ho
    if (!isValidPhone(jobContact)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid phone number.",
      });
    }

    // ================= JOB POSTS (Images / Videos) =================
    let jobPost = [];
    if (req.files?.jobPost?.length > 0) {
      jobPost = req.files.jobPost.map((file) => ({
        url: convertS3UrlToCDN(file.location),
        type: file.mimetype.startsWith("video/") ? "video" : "image",
      }));
    }

    // ================= JOB PDF (Single) =================
    let jobPdf = null;
    if (req.files?.jobPdf?.length > 0) {
      jobPdf = convertS3UrlToCDN(req.files.jobPdf[0].location);
    }

    const newJob = new Rojgar({
      user,
      jainAadhar,
      companyName,
      jobName,
      jobType,
      jobDescription,
      education,
      experience,
      salary,
      age,
      language,
      gender,
      location,
      jobContact,
      jobEmail,

      jobPdf, // ✅ ADDED
      jobPost,
    });

    const savedJob = await newJob.save();

    res.status(201).json({
      success: true,
      message: "Job created successfully",
      data: savedJob,
    });
  } catch (error) {
    console.error("Create Job Error:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createRecruitee = async (req, res) => {
  try {
    const {
      jainAadhar,
      candidateName,
      gender,
      user,
      field,
      education,
      experience,
    } = req.body;

    let candidateResume = "";

    if (req.files?.candidateResume?.[0]?.location) {
      candidateResume = convertS3UrlToCDN(
        req.files.candidateResume[0].location,
      ); // 👈 CDN URL
    }

    const newRecruitee = new RojgarRecruitee({
      jainAadhar,
      candidateName,
      experience,
      education,
      field,
      gender,
      user,
      jobType: "recruitee",
      candidateResume,
    });

    await newRecruitee.save();

    res.status(201).json({
      message: "Recruitee created successfully!",
      newRecruitee,
    });
  } catch (error) {
    console.error("❌ Error creating recruitee:", error);
    res.status(500).json({
      message: "Error creating recruitee",
      error: error.message,
    });
  }
};
exports.getAllRecruitees = async (req, res) => {
  try {
    let recruitees = await RojgarRecruitee.find({ jobType: "recruitee" })
      .populate("user", "fullName profilePicture")
      .sort({ createdAt: -1 });

    // Convert resume URLs to CDN
    recruitees = recruitees.map((item) => ({
      ...item._doc,
      candidateResume: item.candidateResume
        ? convertS3UrlToCDN(item.candidateResume)
        : "",
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
      message: "All Recruitees fetched successfully!",
      data: recruitees,
    });
  } catch (error) {
    console.error("❌ Error fetching recruitees:", error);
    res.status(500).json({
      message: "Error fetching recruitees",
      error: error.message,
    });
  }
};

// Get all jobs
exports.getAllJobs = async (req, res) => {
  try {
    // Saari jobs dikhao (expireDate filter hataya, purani jobs chhup rahi thi)
    const jobs = await Rojgar.find()
      .populate("user", "fullName profilePicture")
      .sort({ createdAt: -1 });

    res.status(200).json(jobs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get a job by ID
exports.getJobById = async (req, res) => {
  try {
    const job = await Rojgar.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    res.status(200).json(job);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Update a job by ID
exports.updateJob = async (req, res) => {
  try {
    const job = await Rojgar.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    res.status(200).json(job);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Delete a job by ID
exports.deleteJob = async (req, res) => {
  try {
    const job = await Rojgar.findByIdAndDelete(req.params.id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    res.status(200).json({ message: "Job deleted successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ================= NEW: DELETE JOB PROFILE (recruitee) =================
// Sirf profile ka owner (ya admin) delete kar sakta hai. Resume S3 se bhi hatta hai,
// lekin agar wahi resume kisi job application me use hua hai to file rakhi jaati hai
// (taaki employer purani application me resume dekh sake).
exports.deleteRecruitee = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid profile id." });
    }

    const profile = await RojgarRecruitee.findById(id);
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Job profile not found." });
    }

    const isAdmin = ["admin", "superadmin"].includes(req.user?.role);
    const isOwner =
      profile.user &&
      req.userId &&
      profile.user.toString() === req.userId.toString();
    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own job profile.",
      });
    }

    const resumeUrl = profile.candidateResume || "";
    await profile.deleteOne();

    let resumeDeleted = false;
    if (resumeUrl) {
      const cdnUrl = convertS3UrlToCDN(resumeUrl);
      const [usedInApplication, usedByOtherProfile] = await Promise.all([
        JobApplication.exists({ resume: { $in: [resumeUrl, cdnUrl] } }),
        RojgarRecruitee.exists({
          candidateResume: { $in: [resumeUrl, cdnUrl] },
        }),
      ]);
      if (!usedInApplication && !usedByOtherProfile) {
        resumeDeleted = await deleteFromS3(resumeUrl);
      }
    }

    res.status(200).json({
      success: true,
      message: "Job profile deleted.",
      resumeDeleted,
    });
  } catch (error) {
    console.error("Delete Recruitee Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
