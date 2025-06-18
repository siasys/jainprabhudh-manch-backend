const Block = require('../../model/Block User/Block');

// Block a user
exports.blockUser = async (req, res) => {
  try {
    const { blockedUserId } = req.body;
    const blockerUserId = req.user._id; // assuming you're using auth middleware

    // Check if already blocked
    const existing = await Block.findOne({
      blocker: blockerUserId,
      blocked: blockedUserId,
    });

    if (existing) {
      return res.status(400).json({ message: 'User already blocked' });
    }

    const block = new Block({
      blocker: blockerUserId,
      blocked: blockedUserId,
    });

    await block.save();

    res.status(201).json({ message: 'User blocked successfully', block });
  } catch (error) {
    console.error('Block error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
};

// Unblock a user
exports.unblockUser = async (req, res) => {
  try {
    const { blockedUserId } = req.params;
    const blockerUserId = req.user._id;

    const deleted = await Block.findOneAndDelete({
      blocker: blockerUserId,
      blocked: blockedUserId,
    });

    if (!deleted) {
      return res.status(404).json({ message: 'Block not found' });
    }

    res.status(200).json({ message: 'User unblocked successfully' });
  } catch (error) {
    console.error('Unblock error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
};

// Get blocked users of logged in user
exports.getBlockedUsers = async (req, res) => {
  try {
    const blockerUserId = req.user._id;
    const blockedUsers = await Block.find({ blocker: blockerUserId }).populate('blocked', 'fullName profilePicture');

    res.status(200).json({ blockedUsers });
  } catch (error) {
    console.error('Get blocked users error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.isUserBlockedByMe = async (req, res) => {
  try {
    const { userId } = req.params;
    const blockerUserId = req.user._id;

    const isBlocked = await Block.findOne({
      blocker: blockerUserId,
      blocked: userId,
    });

    res.status(200).json({
      isBlocked: !!isBlocked, // true or false
    });
  } catch (error) {
    console.error('Check block error:', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
};