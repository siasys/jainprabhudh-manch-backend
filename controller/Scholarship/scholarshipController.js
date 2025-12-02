const Scholarship = require("../../model/Scholarship Modal/scholarshipModal");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
const ScholarshipSponsor = require("../../model/Scholarship Modal/ScholarshipSponsor");

// ------------------------ CREATE ------------------------
exports.applyScholarship = async (req, res) => {
  try {
    const data = req.body;

    // Basic validation
    if (!data.categoryType) {
      return res.status(400).json({ message: "Category type is required" });
    }

    // Convert uploaded files
    const marksheetFiles = (req.files?.lastYearMarksheet || []).map((file) => ({
      fileUrl: convertS3UrlToCDN(file.location),
      fileType: file.mimetype,
    }));

    // Prepare Scholarship Details Object
    const scholarshipDetails = {
      type: data["scholarshipDetails.type"] || "",
      declaration: data["scholarshipDetails.declaration"] || "",
      reason: data["scholarshipDetails.reason"] || ""
    };

    // Save in DB
    const scholarship = new Scholarship({
      ...data,
      lastYearMarksheet: marksheetFiles,
      scholarshipDetails: scholarshipDetails,
    });

    await scholarship.save();

    res.status(201).json({
      message: "Scholarship application submitted successfully",
      scholarship,
    });

  } catch (error) {
    res.status(500).json({
      message: "Error applying scholarship",
      error: error.message,
    });
  }
};

exports.createScholarshipSponsor = async (req, res) => {
  try {
    const data = req.body;

    // ⭐ Convert Sponsor Image (if exists under fields)
    let sponsorImageUrl = null;

    if (req.files && req.files.sponserImage && req.files.sponserImage.length > 0) {
      sponsorImageUrl = convertS3UrlToCDN(req.files.sponserImage[0].location);
    }

    // Create sponsor
    const sponsor = new ScholarshipSponsor({
      sponsorName: data.sponsorName || "",
      address: data.address || "",
      contactNumber: data.contactNumber || "",
      totalSponsorshipAmount: data.totalSponsorshipAmount || "",
      numberOfStudents: data.numberOfStudents || "",
      sponsorshipType: data.sponsorshipType || "",
      sponserImage: sponsorImageUrl,           // ⭐ Correct
      createdBy: data.createdBy || "",
    });

    await sponsor.save();

    res.status(201).json({
      message: "Scholarship sponsor added successfully",
      sponsor,
    });

  } catch (error) {
    console.error("Sponsor creation error:", error);

    res.status(500).json({
      message: "Error creating scholarship sponsor",
      error: error.message,
    });
  }
};


exports.getAllScholarshipSponsors = async (req, res) => {
  try {
    const sponsors = await ScholarshipSponsor.find().sort({ createdAt: -1 });

    res.status(200).json({
      message: "All scholarship sponsors fetched successfully",
      count: sponsors.length,
      sponsors,
    });

  } catch (error) {
    console.error("Get sponsors error:", error);

    res.status(500).json({
      message: "Error fetching scholarship sponsors",
      error: error.message,
    });
  }
};
// ------------------------ GET ONE ------------------------
exports.getScholarshipById = async (req, res) => {
  try {
    const scholarship = await Scholarship.findById(req.params.id);

    if (!scholarship) {
      return res.status(404).json({ message: "Scholarship not found" });
    }

    res.json(scholarship);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching scholarship",
      error: error.message,
    });
  }
};

// ------------------------ GET ALL ------------------------
exports.getAllScholarships = async (req, res) => {
  try {
    const scholarships = await Scholarship.find().sort({ createdAt: -1 });

    res.json(scholarships);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching scholarship list",
      error: error.message,
    });
  }
};

// ------------------------ UPDATE ------------------------
exports.updateScholarship = async (req, res) => {
  try {
    const updated = await Scholarship.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Scholarship not found" });
    }

    res.json({
      message: "Scholarship updated successfully",
      updated,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error updating scholarship",
      error: error.message,
    });
  }
};

// ------------------------ DELETE ------------------------
exports.deleteScholarship = async (req, res) => {
  try {
    const deleted = await Scholarship.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: "Scholarship not found" });
    }

    res.json({
      message: "Scholarship deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Error deleting scholarship",
      error: error.message,
    });
  }
};
// ------------------------ UPDATE STATUS ------------------------
exports.updateScholarshipStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // allowed statuses
    const allowed = ["pending", "approved", "rejected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const updated = await Scholarship.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Scholarship not found" });
    }

    res.json({
      message: "Status updated successfully",
      scholarship: updated,
    });

  } catch (error) {
    res.status(500).json({
      message: "Error updating scholarship status",
      error: error.message,
    });
  }
};
exports.getScholarshipByUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const forms = await Scholarship.find({ createdBy: userId })
      .sort({ createdAt: -1 });

    res.json(forms);

  } catch (error) {
    res.status(500).json({
      message: "Error fetching user scholarship forms",
      error: error.message,
    });
  }
};
