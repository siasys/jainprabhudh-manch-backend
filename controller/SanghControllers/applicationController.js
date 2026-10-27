const Application = require("../../model/SanghModels/Application");
const HierarchicalSangh = require("../../model/SanghModels/hierarchicalSanghModel");

// ── check: ye user us sangh ka panch hai ya nahi ──
const isPanchOfSangh = async (userId, sanghId) => {
  if (!userId || !sanghId) return false;
  try {
    const sangh = await HierarchicalSangh.findById(sanghId)
      .select("panches")
      .lean();
    if (!sangh || !Array.isArray(sangh.panches)) return false;
    return sangh.panches.some((p) => String(p.userId) === String(userId));
  } catch (e) {
    return false;
  }
};

/**
 * CREATE APPLICATION
 * POST /api/applications
 */
exports.createApplication = async (req, res) => {
  try {
    const application = await Application.create(req.body);

    res.status(201).json({
      success: true,
      message: "Application submitted successfully",
      data: application,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * GET SINGLE APPLICATION
 * GET /api/applications/:id
 */
exports.getApplicationById = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id)
      .populate("userId", "fullName")
      .populate("sanghId", "name");

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    res.status(200).json({
      success: true,
      data: application,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * GET ALL APPLICATIONS
 * GET /api/applications
 */
exports.getAllApplications = async (req, res) => {
  try {
    const { userId, sanghId, status } = req.query;
    const requesterId = req.user?._id || req.user?.id;

    // Build filter object based on query parameters
    const filter = {};

    // ── sanghId ki applications sirf us sangh ka panch dekh sakta ──
    if (sanghId) {
      const allowed = await isPanchOfSangh(requesterId, sanghId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to view this Sangh's applications",
        });
      }
      filter.sanghId = sanghId;
    }

    if (userId) {
      filter.userId = userId;
    }
    if (status) {
      filter.status = status;
    }

    const applications = await Application.find(filter)
      .populate("userId", "fullName")
      .populate("sanghId", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: applications.length,
      data: applications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
/**
 * UPDATE APPLICATION
 * PUT /api/applications/:id
 */
exports.updateApplication = async (req, res) => {
  try {
    const requesterId = req.user?._id || req.user?.id;

    // ── status/response sirf us sangh ka panch change kar sakta ──
    const existing = await Application.findById(req.params.id).lean();
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }
    const allowed = await isPanchOfSangh(requesterId, existing.sanghId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this application",
      });
    }

    const application = await Application.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true },
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Application updated successfully",
      data: application,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
