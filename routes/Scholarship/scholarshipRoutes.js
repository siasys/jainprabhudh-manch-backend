const express = require("express");
const { applyScholarship, getScholarshipById, getAllScholarships, updateScholarship, deleteScholarship, createScholarshipSponsor, getAllScholarshipSponsors, updateScholarshipStatus, getScholarshipByUser } = require("../../controller/Scholarship/scholarshipController");
const router = express.Router();
const upload = require("../../middlewares/upload");

// Apply for scholarship
router.post("/apply", upload.scholarshipUpload, applyScholarship);
router.post("/sponsor", createScholarshipSponsor);
router.get("/get/sponsor", getAllScholarshipSponsors);

// Get scholarship by ID
router.get("/:id", getScholarshipById);
router.get("/user/:userId", getScholarshipByUser);

// Get all scholarships
router.get("/", getAllScholarships);

// Update scholarship
router.put("/update/:id", updateScholarship);
router.patch("/:id/status", updateScholarshipStatus);

// Delete scholarship
router.delete("/delete/:id", deleteScholarship);

module.exports = router;
