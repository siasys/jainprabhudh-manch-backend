const JainFood = require('../../model/JainFoodmodal/JainFoodModel');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

// Create a new JainFood post
exports.createPost = async (req, res) => {
  try {
    const { foodName, state, district, city, address, description } = req.body;
    const userId = req.user?._id || req.body.userId;
    if (!foodName || !state || !district || !city || !address || !description) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'Image is required' });
    }
    let s3Url = req.file.location || req.file.path; // aapke multer config pe depend karta hai
    // convertS3UrlToCDN ko call karo
    const cdnUrl = convertS3UrlToCDN(s3Url);
    const newPost = new JainFood({
      foodName,
      location: { state, district, city, address },
      description,
      image: cdnUrl,
      userId: userId,
      likes: [],
    });
    const savedPost = await newPost.save();
    res.status(201).json(savedPost);
  } catch (error) {
    console.error('Error creating JainFood post:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
// Get all JainFood posts (with optional search and pagination)
exports.getAllPosts = async (req, res) => {
  try {
    const { foodName, state, district, city, address, page = 1, limit = 10 } = req.query;

    const query = {};
    if (foodName) {
      query.foodName = { $regex: foodName, $options: 'i' };
    }

    if (state) {
      query['location.state'] = { $regex: state, $options: 'i' };
    }
    if (district) {
      query['location.district'] = { $regex: district, $options: 'i' };
    }
    if (city) {
      query['location.city'] = { $regex: city, $options: 'i' };
    }
    if (address) {
      query['location.address'] = { $regex: address, $options: 'i' };
    }

    // Pagination calculations
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const posts = await JainFood.find(query)
      .populate('userId', 'fullName profilePicture')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await JainFood.countDocuments(query);

    res.json({
      totalCount,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / limit),
      posts,
    });
  } catch (error) {
    console.error('Error fetching JainFood posts:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


exports.toggleLikePost = async (req, res) => {
  try {
    const postId = req.params.id;
      const userId = req.body.userId;

    const post = await JainFood.findById(postId); // Use your correct model
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const alreadyLiked = post.likes.includes(userId);

    if (alreadyLiked) {
      post.likes = post.likes.filter(id => id.toString() !== userId.toString());
      await post.save();
      return res.json({ message: 'Post unliked' });
    } else {
      post.likes.push(userId);
      await post.save();
      return res.json({ message: 'Post liked' });
    }
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Unlike a post
exports.unlikePost = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user._id;

    const post = await JainFood.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    post.likes = post.likes.filter(id => id.toString() !== userId.toString());
    await post.save();

    res.json({ message: 'Post unliked' });
  } catch (error) {
    console.error('Error unliking post:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
exports.deletePost = async (req, res) => {
  try {
    const postId = req.params.id;

    const deletedPost = await JainFood.findByIdAndDelete(postId);

    if (!deletedPost) {
      return res.status(404).json({ message: 'Post not found' });
    }

    res.status(200).json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting JainFood post:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
