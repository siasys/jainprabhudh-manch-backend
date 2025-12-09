// controllers/rojgarController.js
const Rojgar = require("../../model/Rojgar Modal/RojgarModel");
const RojgarRecruitee = require("../../model/Rojgar Modal/RojgarRecruiteeModel")
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

// Create a new job
exports.createJob = async (req, res) => {
  try {
    const { user, jainAadhar, jobName, jobType, jobDescription, education, experience, salary, age, language, gender, location, jobContact, jobEmail } = req.body;

    // Extract jobPost files from req.files
    let jobPost = [];
    if (req.files && req.files.jobPost) {
      jobPost = req.files.jobPost.map((file) => ({
        url: convertS3UrlToCDN(file.location),
        type: file.mimetype.startsWith("video/") ? "video" : "image",
      }));
    }
    console.log("Job Post Data:", jobPost);

    const newJob = new Rojgar({
      user,
      jainAadhar,
      jobName,
      jobDescription,
      education,
      jobType,
      experience,
      salary,
      age,
      language,
      gender,
      location,
      jobContact,
      jobEmail,
      jobPost,
    });

    const savedJob = await newJob.save();
    res.status(201).json(savedJob);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
exports.createRecruitee = async (req, res) => {
  try {
    const { jainAadhar, candidateName, gender, user,field, education, experience } = req.body;

    let candidateResume = "";

    if (req.files?.candidateResume?.[0]?.location) {
      candidateResume = convertS3UrlToCDN(req.files.candidateResume[0].location); // 👈 CDN URL
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
      .populate("user", "fullName profilePicture mobile email")
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
    const jobs = await Rojgar.find().populate("user", "firstName lastName fullName profilePicture");
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
    const job = await Rojgar.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
