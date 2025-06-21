const DeleteAccount = require('../../model/Delete Account Setting/DeleteAccount');
const User = require('../../model/UserRegistrationModels/userModel');
const Post = require('../../model/SocialMediaModels/postModel');
const Follow = require('../../model/SocialMediaModels/friendshipModel');
const { Message } = require('../../model/SocialMediaModels/messageModel');
const {GroupChat} = require('../../model/SocialMediaModels/groupChatModel');
const Notification = require('../../model/SocialMediaModels/notificationModel');
const Story = require('../../model/SocialMediaModels/storyModel');

exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ message: 'Reason is required' });
    }

    // 1. Save delete reason
    await DeleteAccount.create({ user: userId, reason });

    // 2. Delete posts
    await Post.deleteMany({
      $or: [{ postedBy: userId }, { user: userId }]
    });

    // 3. Delete follow records
    await Follow.deleteMany({
      $or: [{ follower: userId }, { following: userId }]
    });

    // 4. Delete messages (1-to-1)
    await Message.deleteMany({
      $or: [{ sender: userId }, { receiver: userId }]
    });

    // 5. Remove user's messages from group messages
    await GroupChat.updateMany(
      {},
      { $pull: { messages: { sender: userId } } }
    );

    // 6. Delete notifications where user is sender or receiver
    await Notification.deleteMany({
      $or: [{ senderId: userId }, { receiverId: userId }]
    });

    // 7. Delete stories by user
    await Story.deleteMany({ userId });

    // 8. Delete user
    await User.findByIdAndDelete(userId);

    res.status(200).json({ message: 'Account and all related data deleted successfully.' });

  } catch (error) {
    console.error('Delete Account Error:', error);
    res.status(500).json({ message: 'Server error while deleting account' });
  }
};