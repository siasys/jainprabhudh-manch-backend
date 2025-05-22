const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const JainHostal = require('../../model/Jain hostal/JainHostalModal');

exports.createHostal = async (req, res) => {
  try {
    const { userId, name, location, description } = req.body;

    if (!userId || !name || !location) {
      return res.status(400).json({ message: 'userId, name and location are required' });
    }

    // multer se file upload ho chuki hogi, file ka path yahan milega
    // req.file agar single file upload hua hai to
    let imageUrl = null;

    if (req.file && req.file.location) {
      // multer S3 storage ka use kar rahe ho jisme 'location' me S3 URL hota hai
      // Wo URL CDN ke according convert karna hai
      imageUrl = convertS3UrlToCDN(req.file.location);
    }

    const newHostal = new JainHostal({
      userId,
      name,
      location,
      description,
      image: imageUrl, // yahan CDN URL store kar rahe hain
    });

    await newHostal.save();

    res.status(201).json(newHostal);
  } catch (error) {
    console.error('Error creating JainHostal:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all Hostals
exports.getAllHostals = async (req, res) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;

    let query = {};
    if (search && search.trim() !== '') {
      // Search in both name and location fields
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { location: { $regex: search, $options: 'i' } }
        ]
      };
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const hostals = await JainHostal.find(query)
      .populate('userId', 'fullName profilePicture')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await JainHostal.countDocuments(query);

    res.json({
      totalCount,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / limit),
      posts: hostals,
    });
  } catch (error) {
    console.error('Error fetching JainHostal posts:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
exports.likeHostal = async (req, res) => {
  try {
    const { hostalId } = req.params;
    const { userId } = req.body;

    const hostal = await JainHostal.findById(hostalId);
    if (!hostal) {
      return res.status(404).json({ message: 'Hostal not found' });
    }

    // Check if already liked
    const alreadyLiked = hostal.likes.includes(userId);

    if (alreadyLiked) {
      // Unlike it
      hostal.likes.pull(userId);
    } else {
      // Like it
      hostal.likes.push(userId);
    }

    await hostal.save();

    res.status(200).json({
      message: alreadyLiked ? 'Hostal unliked' : 'Hostal liked',
      likesCount: hostal.likes.length,
      liked: !alreadyLiked,
    });
  } catch (error) {
    console.error('Error liking hostal:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
// Get Hostal by ID
exports.getHostalById = async (req, res) => {
  try {
    const hostal = await JainHostal.findById(req.params.id).populate('userId', 'name email');
    if (!hostal) {
      return res.status(404).json({ message: 'Hostal not found' });
    }
    res.json(hostal);
  } catch (error) {
    console.error('Error fetching hostal by ID:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update Hostal
exports.updateHostal = async (req, res) => {
  try {
    const { name, location, image } = req.body;
    const hostal = await JainHostal.findById(req.params.id);
    if (!hostal) {
      return res.status(404).json({ message: 'Hostal not found' });
    }

    if (name) hostal.name = name;
    if (location) hostal.location = location;
    if (image) hostal.image = image;

    await hostal.save();
    res.json(hostal);
  } catch (error) {
    console.error('Error updating hostal:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete Hostal
exports.deleteHostal = async (req, res) => {
  try {
    const hostal = await JainHostal.findByIdAndDelete(req.params.id);
    if (!hostal) {
      return res.status(404).json({ message: 'Hostal not found' });
    }
    res.json({ message: 'Hostal deleted successfully' });
  } catch (error) {
    console.error('Error deleting hostal:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
