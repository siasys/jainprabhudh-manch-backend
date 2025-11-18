const Scholarship = require("../../model/Scholarship Modal/scholarshipModal");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");

// ------------------------ CREATE ------------------------
exports.applyScholarship = async (req, res) => {
  try {
    const data = req.body;

    // Basic validation
    if (!data.categoryType) {
      return res.status(400).json({ message: "Category type is required" });
    }

    // Required fields
    const requiredFields = [
      "name",
      "dob",
      "address",
      "gender",
      "fatherName",
      "fatherOccupation",
      "fatherMonthlyIncome",
      "contact",
      "bankDetails",
      //"scholarshipAmount",
    ];

    for (let field of requiredFields) {
      if (!data[field]) {
        return res.status(400).json({ message: `${field} is required` });
      }
    }

     const marksheetFiles = (req.files?.lastYearMarksheet || []).map((file) => ({
      fileUrl: convertS3UrlToCDN(file.location),
      fileType: file.mimetype,
    }));

    // Save in DB
    const scholarship = new Scholarship({
      ...data,
      lastYearMarksheet: marksheetFiles
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
