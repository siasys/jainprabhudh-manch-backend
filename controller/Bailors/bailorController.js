const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const Bailor = require('../../model/Bailor/Bailor');

const createBailor = async (req, res) => {
  try {
    const imageFiles = req.files?.bailorImage || [];

    // ✅ Convert S3 URLs to CDN URLs
    const imageUrls = imageFiles.map(file => convertS3UrlToCDN(file.location));

    const bailor = new Bailor({
      images: imageUrls,
    });

    await bailor.save();

    res.status(201).json({ message: 'Bailor created successfully', bailor });
  } catch (error) {
    console.error('Error in creating bailor:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
const getAllBailors = async (req, res) => {
  try {
    const bailors = await Bailor.find().sort({ createdAt: -1 }); // latest first
    res.status(200).json({ bailors });
  } catch (error) {
    console.error('Error in fetching bailors:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
module.exports = {
  createBailor,
  getAllBailors
};
