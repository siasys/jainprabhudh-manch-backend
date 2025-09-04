const Block = require('../../model/Block User/Block');
const User = require('../../model/UserRegistrationModels/userModel'); // apna user model import karo

// Block a user
exports.blockUser = async (req, res) => {
  try {
    const { blockedUserId } = req.body;
    const blockerUserId = req.user._id;

    // Check if already blocked
    const existing = await Block.findOne({
      blocker: blockerUserId,
      blocked: blockedUserId,
    });

    if (existing) {
      return res.status(400).json({ message: "User already blocked" });
    }

    // 1. Block collection me save karo
    const block = new Block({
      blocker: blockerUserId,
      blocked: blockedUserId,
    });
    await block.save();

    // 2. User document me blockedUsers array update karo
    await User.findByIdAndUpdate(blockerUserId, {
      $addToSet: { blockedUsers: blockedUserId },
    });

    res.status(201).json({ message: "User blocked successfully", block });
  } catch (error) {
    console.error("Block error:", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

// Unblock a user
exports.unblockUser = async (req, res) => {
  try {
    const { blockedUserId } = req.params;
    const blockerUserId = req.user._id;

    // 1. Block collection se delete karo
    const deleted = await Block.findOneAndDelete({
      blocker: blockerUserId,
      blocked: blockedUserId,
    });

    if (!deleted) {
      return res.status(404).json({ message: "Block not found" });
    }

    // 2. User document se remove karo
    await User.findByIdAndUpdate(blockerUserId, {
      $pull: { blockedUsers: blockedUserId },
    });

    res.status(200).json({ message: "User unblocked successfully" });
  } catch (error) {
    console.error("Unblock error:", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};


// Get blocked users of logged in user
exports.getBlockedUsers = async (req, res) => {
  try {
    const blockerUserId = req.user._id;

    const blocks = await Block.find({ blocker: blockerUserId })
      .populate("blocked", "fullName profilePicture accountType businessName");

    const blockedUsers = blocks.map((b) => b.blocked);

    res.status(200).json({ blockedUsers });
  } catch (error) {
    console.error("Get blocked users error:", error);
    res.status(500).json({ message: "Something went wrong" });
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