// controllers/reportController.js
const Report = require('../../model/SocialMediaModels/Report');
const StoryReport = require('../../model/SocialMediaModels/StoryReport');

// POST /api/reports
exports.createReport = async (req, res) => {
  try {
    const { postId, reportedUser, reportType, reason } = req.body;

    if (!reportType || !reason) {
      return res.status(400).json({ message: "Report type and reason are required." });
    }

    const report = new Report({
      postId: postId || null,
      reportedUser: reportedUser || null,
      reportedBy: req.user._id,
      reportType,
      reason,
    });

    await report.save();

    res.status(201).json({ success: true, message: "Report submitted successfully.", report });
  } catch (error) {
    console.error("Create Report Error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

exports.getAllReports = async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('reportedBy', 'fullName email profilePicture')
      .populate('postId', 'caption media')
      .populate('reportedUser', 'fullName email profilePicture')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, reports });
  } catch (error) {
    console.error("Get All Reports Error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
// GET /api/reports/:id
exports.getReportById = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('reportedBy', 'fullName email')
      .populate('postId', 'caption media')
      .populate('reportedUser', 'fullName email');

    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }

    res.status(200).json({ success: true, report });
  } catch (error) {
    console.error("Get Report by ID Error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
// GET /api/reports/my
exports.getMyReports = async (req, res) => {
  try {
    const reports = await Report.find({ reportedBy: req.user._id })
      .populate('postId', 'caption media')
      .populate('reportedUser', 'fullName email profilePicture')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, reports });
  } catch (error) {
    console.error("Get My Reports Error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
exports.createStoryReport = async (req, res) => {
  try {
    const { storyId, reason } = req.body;
    const reportedBy = req.user._id;

    const alreadyReported = await StoryReport.findOne({ storyId, reportedBy });
    if (alreadyReported) {
      return res.status(400).json({ message: 'You already reported this story' });
    }

    const report = new StoryReport({ storyId, reportedBy, reason });
    await report.save();
    res.status(201).json({ message: 'Story reported successfully', report });
  } catch (error) {
    res.status(500).json({ message: 'Error creating story report', error });
  }
};

exports.getAllStoryReports = async (req, res) => {
  try {
    const reports = await StoryReport.find()
      .populate({
        path: 'storyId',
        select: 'media type userId',
        populate: {
          path: 'userId',
          select: 'fullName profilePicture'
        }
      })
      .populate('reportedBy', 'fullName');

    res.status(200).json({ reports });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching story reports', error });

  }
};
