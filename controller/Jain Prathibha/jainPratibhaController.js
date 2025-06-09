const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const JainPratibha = require('../../model/Jain Prathibha/JainPratibhaModal');

// POST /api/jainpratibha
exports.createPost = async (req, res) => {
  try {
    const { userId, talent, description } = req.body;
    const image = req.file ? convertS3UrlToCDN(req.file.location) : '';

    const newPost = new JainPratibha({
      userId,
      talent,
      description,
      image
    });

    await newPost.save();
    res.status(201).json({ message: 'Post created successfully', post: newPost });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create post' });
  }
};
// Get all posts
exports.getAllPosts = async (req, res) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;

    let query = {};
    if (search && search.trim() !== '') {
      // Search in talent and description fields
      query = {
        $or: [
          { talent: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const posts = await JainPratibha.find(query)
      .populate('userId', 'fullName profilePicture')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await JainPratibha.countDocuments(query);

    res.json({
      totalCount,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / limit),
      posts: posts,
    });
  } catch (error) {
    console.error('Error fetching JainPratibha posts:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
// Like or Unlike Post
exports.toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = await JainPratibha.findById(postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const alreadyLiked = post.likes.includes(userId);

    if (alreadyLiked) {
      post.likes.pull(userId);
      await post.save();
      return res.status(200).json({ message: 'Post unliked' });
    } else {
      post.likes.push(userId);
      await post.save();
      return res.status(200).json({ message: 'Post liked' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle like' });
  }
};
exports.deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const loggedInUserId = req.user._id;
    const userRole = req.user.role;

    const post = await JainPratibha.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // ✅ Only owner or superadmin can delete
    if (!post.userId.equals(loggedInUserId) && userRole !== 'superadmin') {
      return res.status(403).json({ message: 'You are not authorized to delete this post' });
    }

    await JainPratibha.findByIdAndDelete(postId);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: 'Server error while deleting post' });
  }
};