// controllers/reportController.js
const Report = require('../../model/SocialMediaModels/Report');
const StoryReport = require('../../model/SocialMediaModels/StoryReport');
const CommentReport = require('../../model/SocialMediaModels/CommentReport');
const Post = require('../../model/SocialMediaModels/postModel');
const userModel = require('../../model/UserRegistrationModels/userModel');

//POST /api/reports
exports.createReport = async (req, res) => {
  try {
    const { postId, reportedUser, reportType, reason } = req.body;

    if (!reportType || !reason) {
      return res.status(400).json({ message: "Report type and reason are required." });
    }

    // ✅ Prevent Duplicate Report by Same User for Same Post
    if (postId) {
      const alreadyReported = await Report.findOne({
        postId,
        reportedBy: req.user._id
      });

      if (alreadyReported) {
        return res.status(400).json({
          success: false,
          message: "You have already reported this post."
        });
      }
    }

    // Save new report
    const report = new Report({
      postId: postId || null,
      reportedUser: reportedUser || null,
      reportedBy: req.user._id,
      reportType,
      reason,
    });

    await report.save();

    res.status(201).json({
      success: true,
      message: "Report submitted successfully.",
      report
    });

  } catch (error) {
    console.error("Create Report Error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};


exports.getAllReports = async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('reportedBy', 'fullName email profilePicture')
      .populate('postId', 'caption media postType')
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
      .populate('postId', 'caption media postType')
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
      .populate('postId', 'caption media postType')
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
    const { storyId, reason, reportType } = req.body;
    const reportedBy = req.user._id;

    const alreadyReported = await StoryReport.findOne({ storyId, reportedBy });
    if (alreadyReported) {
      return res.status(400).json({ message: 'You already reported this story' });
    }

    const report = new StoryReport({ storyId, reportedBy, reason,reportType });
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
exports.createCommentReport = async (req, res) => {
  try {
    const { commentId, reason, reportType, postId } = req.body;
    const reportedBy = req.user._id;

    // Validation
    if (!commentId || !reason || !reportType || !postId) {
      return res.status(400).json({
        success: false,
        message: "commentId, postId, reason, and reportType are required"
      });
    }

    if (!['Comment', 'Reply'].includes(reportType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reportType. Must be 'Comment' or 'Reply'"
      });
    }

    // Prevent Duplicate
    const alreadyReported = await CommentReport.findOne({ 
      commentId,
      reportedBy
    });
    if (alreadyReported) {
      return res.status(400).json({
        success: false,
        message: `You have already reported this ${reportType.toLowerCase()}`
      });
    }

    // Create report
    const report = new CommentReport({
      commentId,
      postId,         // ✅ NEW
      reportedBy,
      reason,
      reportType,
      status: 'Pending'
    });

    await report.save();

    res.status(201).json({
      success: true,
      message: `${reportType} reported successfully`,
      report
    });

  } catch (error) {
    console.error("Error creating comment report:", error);
    res.status(500).json({
      success: false,
      message: "Error creating comment report",
      error: error.message
    });
  }
};

exports.getAllCommentReports = async (req, res) => {
  try {
    const reports = await CommentReport.find()
      .populate("reportedBy", "fullName profilePicture")
      .sort({ createdAt: -1 });

    const finalReports = [];

    for (const report of reports) {
      const { commentId, postId } = report;

      // 🟦 1. Fetch Post
      const post = await Post.findById(postId)
        .populate("user", "fullName profilePicture")
        .lean();

      if (!post) continue;

      // 🟩 2. Find comment inside post.comments array
      const comment = post.comments?.find(
        (c) => c?._id?.toString() === commentId?.toString()
      );

      if (!comment) {
        console.log("⚠ Comment not found for commentId:", commentId);
      }

      // 🟧 3. Fetch commenting user
      let commentedUser = null;

      if (comment?.user) {
        commentedUser = await userModel.findById(comment.user).select(
          "fullName profilePicture"
        );
      }

      // 🟨 4. Prepare clean final object
      finalReports.push({
        ...report.toObject(),

        commentId: {
          _id: comment?._id || null,
          text: comment?.text || "",
          media: comment?.media || [],
          userId: commentedUser,
          createdAt: comment?.createdAt || null,
        },

        postId: {
          _id: post._id,
          media: post.media || [],
          postType: post.postType || "",
          caption: post.caption || "",
        }
      });
    }

    return res.status(200).json({
      success: true,
      reports: finalReports,
    });

  } catch (error) {
    console.error("❌ Error fetching comment reports:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching comment reports",
    });
  }
};

