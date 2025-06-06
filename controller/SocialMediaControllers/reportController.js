// controllers/reportController.js
const Report = require('../../model/SocialMediaModels/Report');
const StoryReport = require('../../model/SocialMediaModels/StoryReport');

exports.createReport = async (req, res) => {
  try {
    const { postId, reason } = req.body;
    const reportedBy = req.user._id; // from auth middleware

    // Optional: Prevent duplicate reports from same user for same post
    const alreadyReported = await Report.findOne({ postId, reportedBy });
    if (alreadyReported) {
      return res.status(400).json({ message: 'You already reported this post' });
    }

    const report = new Report({ postId, reportedBy, reason });
    await report.save();
    res.status(201).json({ message: 'Report submitted successfully', report });
  } catch (error) {
    res.status(500).json({ message: 'Error creating report', error });
  }
};

exports.getAllReports = async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('postId', 'caption media') // Adjust fields as needed
      .populate('reportedBy', 'fullName');
    res.status(200).json({ reports });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching reports', error });
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
