const JainGranth = require("../model/JainGranthModel");
const { convertS3UrlToCDN } = require('../utils/s3Utils');

exports.uploadGranth = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File is required!" });
    }

    const { title, description } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required!" });
    }

    const fileUrl = convertS3UrlToCDN(req.file.location); // ✅ CDN conversion

    const newGranth = new JainGranth({ title, description, fileUrl }); // Added description
    await newGranth.save();

    res.status(201).json({ message: "Granth uploaded successfully!", granth: newGranth });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

exports.getAllGranths = async (req, res) => {
  try {
    const granths = await JainGranth.find().sort({ createdAt: -1 });
    res.status(200).json(granths);
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};
