const express = require("express");
const { applyScholarship, getScholarshipById, getAllScholarships, updateScholarship, deleteScholarship } = require("../../controller/Scholarship/scholarshipController");
const router = express.Router();
const upload = require("../../middlewares/upload");

// Apply for scholarship
router.post("/apply", upload.scholarshipUpload, applyScholarship);

// Get scholarship by ID
router.get("/:id", getScholarshipById);

// Get all scholarships
router.get("/", getAllScholarships);

// Update scholarship
router.put("/update/:id", updateScholarship);

// Delete scholarship
router.delete("/delete/:id", deleteScholarship);

module.exports = router;
