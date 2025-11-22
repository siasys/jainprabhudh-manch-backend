// routes/rojgarRoute.js
const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/upload");
const { createJob, getAllJobs, getJobById, updateJob, deleteJob, createRecruitee, getAllRecruitees } = require("../../controller/Rojgar/rojgarController");

// Routes for job operations
router.post("/create", upload.jobPostUpload, createJob);
router.post("/candidate", upload.candidateResumeUpload, createRecruitee);
router.get("/", getAllJobs);
router.get("/recruitee", getAllRecruitees);
router.get("/:id", getJobById);
router.put("/:id", updateJob);
router.delete("/:id", deleteJob);

module.exports = router;
