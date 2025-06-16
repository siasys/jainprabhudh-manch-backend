const { convertS3UrlToCDN } = require('../utils/s3Utils');
const GovtYojana = require("../model/govtYojanaModel");


const MAX_FILE_SIZE_MB = 15;

exports.createYojana = async (req, res) => {
  try {
    const { yojanaName, userId, caption } = req.body;
    if (!req.file) {
      return res.status(400).json({ message: "PDF file is required" });
    }
    const fileSizeInMB = req.file.size / (1024 * 1024);
    if (fileSizeInMB > MAX_FILE_SIZE_MB) {
      return res.status(400).json({ message: "File size should not exceed 15MB" });
    }
    const fileUrl = convertS3UrlToCDN(req.file.location); // CDN conversion if using S3
    if (!yojanaName || !fileUrl || !userId) {
      return res.status(400).json({ message: "Name, File, and User ID are required" });
    }
    const newYojana = new GovtYojana({ yojanaName, fileUrl, userId,caption });
    await newYojana.save();
    res.status(201).json({ message: "Yojana created successfully", newYojana });
  } catch (error) {
    console.error("❌ Error in createYojana:", error);
    res.status(500).json({ message: "Server Error", error });
  }
};

  exports.getAllYojanas = async (req, res) => {
    try {
      const yojanas = await GovtYojana.find()
        .sort({ createdAt: -1 })
        .populate('userId', 'profilePicture firstName lastName fullName');
      res.status(200).json(yojanas);
    } catch (error) {
      res.status(500).json({ message: "Server Error", error });
    }
  };
  
exports.deleteYojana = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedYojana = await GovtYojana.findByIdAndDelete(id);
    if (!deletedYojana) {
      return res.status(404).json({ message: "Yojana not found" });
    }
    res.status(200).json({ message: "Yojana deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error });
  }
};
exports.toggleLikeYojana = async (req, res) => {
  try {
    const { yojanaId } = req.params;
    const { userId } = req.body;

    const yojana = await GovtYojana.findById(yojanaId);
    if (!yojana) {
      return res.status(404).json({ message: "Yojana not found" });
    }

    const isLiked = yojana.likes.includes(userId);

    if (isLiked) {
      // Unlike
      yojana.likes.pull(userId);
    } else {
      // Like
      yojana.likes.push(userId);
    }

    await yojana.save();

    res.status(200).json({
      message: isLiked ? "Unliked successfully" : "Liked successfully",
      totalLikes: yojana.likes.length,
      isLiked: !isLiked
    });
  } catch (error) {
    console.error("Error in toggleLikeYojana:", error);
    res.status(500).json({ message: "Server Error", error });
  }
};