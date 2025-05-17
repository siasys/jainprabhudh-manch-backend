const JainGranth = require("../model/JainGranthModel");
const { convertS3UrlToCDN } = require('../utils/s3Utils');

exports.uploadGranth = async (req, res) => {
  try {
    const files = req.files;
    if (!files || !files.jainGranth || !files.jainGranthImage) {
      return res.status(400).json({ error: "Both Granth file and image are required!" });
    }
    const { userId, title, description } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Title is required!" });
    }
    // Convert S3 URLs to CDN URLs
    const granthFileUrl = convertS3UrlToCDN(files.jainGranth[0].location);
    const granthImageUrl = convertS3UrlToCDN(files.jainGranthImage[0].location);
    const newGranth = new JainGranth({ 
      userId,
      title,
      description,
      fileUrl: granthFileUrl,
      imageUrl: granthImageUrl // New field for image URL
    });

    await newGranth.save();

    res.status(201).json({ message: "Granth uploaded successfully!", granth: newGranth });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};
exports.getAllGranths = async (req, res) => {
  try {
    const granths = await JainGranth.find()
      .sort({ createdAt: -1 })
      .populate('userId', 'firstName lastName fullName profilePicture'); // ✅ Populate

    res.status(200).json(granths);
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};
