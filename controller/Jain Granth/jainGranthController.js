const JainGranth = require("../../model/Jain Granth/JainGranthModel");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");

exports.uploadGranth = async (req, res) => {
  try {
    const files = req.files;
    if (!files || !files.jainGranth || !files.jainGranthImage) {
      return res
        .status(400)
        .json({ error: "Both Granth file and image are required!" });
    }
    const {
      userId,
      jainShravakId,
      title,
      description,
      panth,
      mulJain,
      author,
      publisher,
    } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Title is required!" });
    }
    // Convert S3 URLs to CDN URLs
    const granthFileUrl = convertS3UrlToCDN(files.jainGranth[0].location);
    const granthImageUrl = convertS3UrlToCDN(files.jainGranthImage[0].location);
    const newGranth = new JainGranth({
      userId,
      title,
      jainShravakId,
      description,
      panth,
      mulJain,
      author,
      publisher,
      fileUrl: granthFileUrl,
      imageUrl: granthImageUrl,
    });

    await newGranth.save();
    res
      .status(201)
      .json({ message: "Granth uploaded successfully!", granth: newGranth });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

exports.getAllGranths = async (req, res) => {
  try {
    const granths = await JainGranth.find()
      .sort({ createdAt: -1 })
      .populate("userId", "fullName profilePicture");

    res.status(200).json(granths);
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};
// ✅ Unique view count — ek user sirf ek baar count hoga
exports.incrementView = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.body.userId || req.query.userId;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // Check karo — kya ye user pehle se viewedBy mein hai
    const granth = await JainGranth.findById(id);
    if (!granth) return res.status(404).json({ error: "Granth not found!" });

    const alreadyViewed = granth.viewedBy?.some(
      (uid) => uid.toString() === userId.toString(),
    );

    if (alreadyViewed) {
      // Already dekha — count mat badho, current views return karo
      return res.status(200).json({ views: granth.views, alreadyViewed: true });
    }

    // Naya viewer — views increment + viewedBy mein add
    const updated = await JainGranth.findByIdAndUpdate(
      id,
      {
        $inc: { views: 1 },
        $addToSet: { viewedBy: userId }, // duplicate prevent karta hai
      },
      { new: true },
    );

    res.status(200).json({ views: updated.views, alreadyViewed: false });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

exports.deleteGranth = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Granth ID is required!" });
    }

    // Check if Granth exists
    const granth = await JainGranth.findById(id);
    if (!granth) {
      return res.status(404).json({ error: "Granth not found!" });
    }

    // Delete the granth
    await JainGranth.findByIdAndDelete(id);

    res.status(200).json({ message: "Granth deleted successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};
