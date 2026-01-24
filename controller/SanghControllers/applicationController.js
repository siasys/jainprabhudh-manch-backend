const Application = require('../../model/SanghModels/Application');

/**
 * CREATE APPLICATION
 * POST /api/applications
 */
exports.createApplication = async (req, res) => {
  try {
    const application = await Application.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
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
      .populate('userId', 'fullName')
      .populate('sanghId', 'name');

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
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
    // Build filter object based on query parameters
    const filter = {};
    if (userId) {
      filter.userId = userId;
    }
    if (sanghId) {
      filter.sanghId = sanghId;
    }
    if (status) {
      filter.status = status;
    }

    const applications = await Application.find(filter)
      .populate('userId', 'fullName')
      .populate('sanghId', 'name')
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
    const application = await Application.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Application updated successfully',
      data: application,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
