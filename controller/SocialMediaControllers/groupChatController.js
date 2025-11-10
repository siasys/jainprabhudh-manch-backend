const {GroupChat, decrypt} = require('../../model/SocialMediaModels/groupChatModel');
const mongoose = require('mongoose');
const path = require('path');
const { getIo } = require('../../websocket/socket');
const { s3Client, DeleteObjectCommand } = require('../../config/s3Config');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const JainAadhar = require('../../model/UserRegistrationModels/jainAadharModel')
const { convertS3UrlToCDN } = require('../../utils/s3Utils');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel')
const User = require('../../model/UserRegistrationModels/userModel');
const fuzzysort = require('fuzzysort');
// 1. Create Group Chat
exports.createGroupChat = async (req, res) => {
  try {
    let { groupName, groupMembers, creator } = req.body;

    // Directly use uploaded image if available, else set it to undefined
    let groupImage = req.file ? req.file.location : undefined;

    console.log("Uploaded file:", groupImage);
    if (groupImage) {
      groupImage = convertS3UrlToCDN(groupImage);
    }
    if (!groupName) groupName = "New Group";

    if (!groupMembers || !Array.isArray(groupMembers) || groupMembers.length === 0) {
      return res.status(400).json({ message: "At least one group member is required." });
    }

    // Ensure creator is included in group members
    if (!groupMembers.includes(creator)) {
      groupMembers.push(creator);
    }

    const newGroup = new GroupChat({
      groupName,
      groupMembers: groupMembers.map(memberId => ({
        user: memberId,
        role: memberId === creator ? 'admin' : 'member'
      })),
      groupImage, // This can now be undefined if frontend doesn't send an image
      creator,
      admins: [creator]
    });

    await newGroup.save();

    // Prepare a simplified group object for socket emission
    const groupForSocket = {
      _id: newGroup._id,
      groupName: newGroup.groupName,
      groupImage: newGroup.groupImage,
      creator: newGroup.creator,
      createdAt: newGroup.createdAt
    };

    // Notify all group members via Socket.io
    const io = getIo();
    if (io) {
      console.log(`Notifying ${groupMembers.length} members about new group ${newGroup._id}`);
      groupMembers.forEach(memberId => {
        io.to(memberId.toString()).emit('newGroup', groupForSocket);
        console.log(`Emitted newGroup event to user ${memberId}`);
        io.to(memberId.toString()).emit('addedToGroup', {
          groupId: newGroup._id,
          groupName: newGroup.groupName
        });
      });
    } else {
      console.error('Socket.io instance not available');
    }

    return successResponse(res, newGroup, "Group created successfully", 201);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
exports.createOrFindCityGroup = async (req, res) => {
  try {
    const { creator } = req.body;

    const creatorData = await User.findById(creator);
    if (!creatorData || !creatorData.location?.city) {
      return res.status(400).json({ message: "User city not found" });
    }

    let cityName = creatorData.location.city.trim();

    // ✅ Advanced normalization
    const normalizeCity = (name) => {
      return name
        .toLowerCase()
        .replace(/[^\u0900-\u097Fa-z]/g, "") // remove special chars, keep hindi+english
        .replace(/\s+/g, "") // remove spaces
        .replace(/[aeiou]/g, ""); // remove vowels
    };

    const normalizedCity = normalizeCity(cityName);
    const hindiGroupName = `सकल जैन समाज ${cityName}`;

    // ✅ Fuzzy match existing group — agar koi similar normalized city pe group bana ho
    const allGroups = await GroupChat.find({ isCityGroup: true });
    const existingGroup = allGroups.find(
      (g) => normalizeCity(g.normalizedCity || "") === normalizedCity
    );

    if (existingGroup) {
      return res.status(200).json({
        success: false,
        message: "City group already exists",
        group: existingGroup,
      });
    }

    // ✅ Find all city users matching fuzzy normalized city
    const allUsers = await User.find().select("_id location.city");
    const cityUsers = allUsers.filter((u) => {
      if (!u.location?.city) return false;
      return normalizeCity(u.location.city) === normalizedCity;
    });

    if (cityUsers.length === 0) {
      return res.status(400).json({ message: "No users found for this city" });
    }

    const groupImage = req?.file?.location || null;

    const groupMembers = cityUsers.map((u) => ({
      user: u._id,
      role: u._id.toString() === creator.toString() ? "admin" : "member",
    }));

    const newGroup = await GroupChat.create({
      groupName: hindiGroupName,
      normalizedCity,
      isCityGroup: true,
      creator,
      admins: [creator],
      groupImage,
      createdAt: new Date(),
      groupMembers,
    });

    // 🔹 Socket emit
    const io = getIo();
    if (io) {
      groupMembers.forEach((member) => {
        io.to(member.user.toString()).emit("newGroup", {
          _id: newGroup._id,
          groupName: newGroup.groupName,
          groupImage: newGroup.groupImage,
          creator: newGroup.creator,
          createdAt: newGroup.createdAt,
        });
      });
    }

    res.status(201).json({
      success: true,
      message: "City-based 'Sakal Jain Samaj' group created successfully",
      group: newGroup,
    });
  } catch (error) {
    console.error("Error creating city group:", error);
    res.status(500).json({ error: error.message });
  }
};




exports.getGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!groupId) {
      return res.status(400).json({ message: "Group ID is required." });
    }

    const group = await GroupChat.findById(groupId)
      .populate('creator', 'fullName profilePicture accountType businessName sadhuName')
      .populate('admins', 'fullName profilePicture accountType businessName sadhuName')
      .populate('groupMembers.user', 'fullName profilePicture accountType businessName sadhuName');

    if (!group) {
      return res.status(404).json({ message: "Group not found." });
    }

    if (group.groupImage) {
      group.groupImage = convertS3UrlToCDN(group.groupImage);
    }

    res.status(200).json({ group });
  } catch (error) {
    console.error("Error fetching group details:", error);
    res.status(500).json({ error: error.message });
  }
};

//  Create or Find Gotra Group Automatically
exports.createOrFindGotraGroup = async (req, res) => {
  try {
    const { creator } = req.body;

    // Creator ka Gotra Jain Aadhar se fetch karein
    const creatorData = await JainAadhar.findOne({ userId: creator });
    if (!creatorData || !creatorData.gotra) {
      return res.status(400).json({ message: "Gotra not found for the creator" });
    }

    const gotra = creatorData.gotra.trim();

    // Gotra ke basis par saare Jain Aadhar users fetch karein
    const gotraUsers = await JainAadhar.find({
      gotra: { $regex: new RegExp(`^${gotra}$`, "i") },
    }).select("userId");

    if (gotraUsers.length === 0) {
      return res.status(400).json({ message: "No users found for this Gotra" });
    }

    const groupMembers = gotraUsers.map((user) => user.userId.toString());

    // 🔹 Group Name Hindi me banao
    const hindiGroupName = `${gotra} गोत्र ग्रुप`;

    // Check if group already exists (case-insensitive)
    let existingGroup = await GroupChat.findOne({
      groupName: new RegExp(`^${gotra}\\s*गोत्र\\s*ग्रुप$`, "i"),
    });

    let groupImage = req.file ? req.file.location : null;

    if (existingGroup) {
      // Update existing group members if not already in
      groupMembers.forEach((memberId) => {
        if (!existingGroup.groupMembers.some((m) => m.user.toString() === memberId)) {
          existingGroup.groupMembers.push({ user: memberId, role: "member" });
        }
      });

      if (req.file) {
        existingGroup.groupImage = groupImage;
      }

      await existingGroup.save();
    } else {
      // 🔹 Gotra Group create with Hindi Name
      existingGroup = new GroupChat({
        groupName: hindiGroupName,
        groupMembers: groupMembers.map((memberId) => ({
          user: memberId,
          role: memberId === creator ? "admin" : "member",
        })),
        groupImage,
        isGotraGroup: true,
        creator,
        admins: [creator],
      });

      await existingGroup.save();
    }

    // 🔹 Notify all members via Socket.io
    const io = getIo();
    if (io) {
      groupMembers.forEach((memberId) => {
        io.to(memberId.toString()).emit("newGroup", {
          _id: existingGroup._id,
          groupName: existingGroup.groupName,
          groupImage: existingGroup.groupImage,
          creator: existingGroup.creator,
          createdAt: existingGroup.createdAt,
        });

        io.to(memberId.toString()).emit("addedToGroup", {
          groupId: existingGroup._id,
          groupName: existingGroup.groupName,
        });
      });
    } else {
      console.error("Socket.io instance not available");
    }

    return res.status(201).json({
      success: true,
      message: "Gotra-based group created or updated successfully",
      group: existingGroup,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

exports.createOrFindHierarchicalSanghGroup = async (req, res) => {
  try {
    const { sanghId } = req.body;

    const sangh = await HierarchicalSangh.findById(sanghId);
    if (!sangh) return res.status(404).json({ message: "Sangh not found" });

    const groupName = sangh.name?.trim(); // ✅ Sangh name
    const groupImage = sangh.sanghImage || null; // ✅ Sangh image
    const creator = sangh.createdBy;

    // ✅ Collect unique userIds from officeBearers and members
    const officeBearerUserIds = sangh.officeBearers.map(ob => ob.userId?.toString());
    const memberUserIds = sangh.members.map(m => m.userId?.toString());
    const groupMembers = Array.from(new Set([...officeBearerUserIds, ...memberUserIds]));

    // ✅ Check if group already exists
    let existingGroup = await GroupChat.findOne({ groupName: new RegExp(`^${groupName}$`, 'i') });

    if (existingGroup) {
      // Add missing members
      groupMembers.forEach(memberId => {
        if (!existingGroup.groupMembers.some(m => m.user.toString() === memberId)) {
          existingGroup.groupMembers.push({ user: memberId, role: "member" });
        }
      });
      existingGroup.groupImage = groupImage; // Update group image
      await existingGroup.save();
    } else {
      // ✅ Create new group
      existingGroup = new GroupChat({
        groupName, // Sangh name
        groupImage, // Sangh image
        groupMembers: groupMembers.map(memberId => ({
          user: memberId,
          role: memberId === creator.toString() ? "admin" : "member"
        })),
        isSanghGroup: true,
        creator,
        sanghId,
        admins: [creator]
      });
      await existingGroup.save();
    }

    // ✅ Emit via Socket.io
    const io = getIo();
    if (io) {
      groupMembers.forEach(memberId => {
        io.to(memberId).emit("newGroup", {
          _id: existingGroup._id,
          groupName: existingGroup.groupName,
          groupImage: existingGroup.groupImage,
          creator: existingGroup.creator,
          createdAt: existingGroup.createdAt
        });
        io.to(memberId).emit("addedToGroup", {
          groupId: existingGroup._id,
          groupName: existingGroup.groupName
        });
      });
    }

    return res.status(201).json({
      success: true,
      message: "Sangh group created or updated successfully",
      group: existingGroup
    });

  } catch (error) {
    console.error("Error in createOrFindHierarchicalSanghGroup:", error);
    res.status(500).json({ message: error.message });
  }
};


// ✅ Get All Groups (User + Sangh Account Compatible)
exports.getAllGroups = async (req, res) => {
  try {
    // 👇 Agar Sangh account se logged in hai to sanghId lo, warna userId
    const userId =
      req.accountType === "sangh"
        ? req.sangh?._id
        : req.user?._id;

    if (!userId) {
      return res.status(400).json({ message: "User or Sangh ID not found" });
    }

    // ✅ Fetch all non-gotra groups where this account is a member
    const normalGroups = await GroupChat.find({
      "groupMembers.user": userId,
      isGotraGroup: false,
    })
      .populate(
        "groupMembers.user",
        "firstName fullName lastName profilePicture accountType businessName sadhuName"
      )
      .populate(
        "creator",
        "firstName lastName fullName profilePicture accountType businessName sadhuName"
      )
      .populate("groupMessages");

    // ✅ Fetch gotra group (either user/sangh is member OR creator)
    const gotraGroup = await GroupChat.findOne({
      isGotraGroup: true,
      $or: [{ "groupMembers.user": userId }, { creator: userId }],
    })
      .populate(
        "groupMembers.user",
        "firstName fullName lastName profilePicture accountType businessName sadhuName"
      )
      .populate(
        "creator",
        "firstName lastName fullName profilePicture accountType businessName sadhuName"
      )
      .populate("groupMessages");

    // ✅ CDN URL conversion
    normalGroups.forEach((group) => {
      if (group.groupImage) {
        group.groupImage = convertS3UrlToCDN(group.groupImage);
      }
    });

    if (gotraGroup && gotraGroup.groupImage) {
      gotraGroup.groupImage = convertS3UrlToCDN(gotraGroup.groupImage);
    }

    let allGroups = [...normalGroups];
    if (gotraGroup) allGroups.push(gotraGroup);

    // ✅ Add messageCount
    allGroups = allGroups.map((group) => ({
      ...group.toObject(),
      messageCount: group.groupMessages ? group.groupMessages.length : 0,
    }));

    res.status(200).json({ groups: allGroups });
  } catch (error) {
    console.error("❌ getAllGroups Error:", error);
    res.status(500).json({ error: error.message });
  }
};


// Fetch All Gotra Groups
exports.getUserGotraGroups = async (req, res) => {
  try {
    const userId = req.user._id;
    const gotraGroups = await GroupChat.find({ 
      isGotraGroup: true, 
      "groupMembers.user": userId
    })
    .populate("groupMembers.user", "firstName lastName fullName profilePicture")
    .populate("creator", "firstName lastName fullName profilePicture");
    res.status(200).json({ success: true, gotraGroups });
  } catch (error) {
    console.error("Error fetching user Gotra Groups:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

//  Get All Group Chats
exports.getAllGroupChats = async (req, res) => {
  try {
    const groups = await GroupChat.find()
    .populate('groupMembers.user', 'firstName lastName fullName profilePicture')    
    .populate('creator', 'firstName lastName fullName profilePicture');
    res.status(200).json(groups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

//  Send Group Message
exports.sendGroupMessage = async (req, res) => {
  try {
    const { groupId, sender, message } = req.body;
    const group = await GroupChat.findById(groupId)
    .populate('groupMembers.user', 'firstName lastName fullName profilePicture');
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }
    if (!group) {
      // Delete uploaded file if group not found
      if (req.file) {
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: req.file.key
          }));
        } catch (error) {
          console.error('Error deleting file:', error);
        }
      }
      return errorResponse(res, "Group not found", 404);
    }

    // Check if sender is group member
    const isMember = group.groupMembers.some(
      member => member.user._id.toString() === sender.toString()
    );
    
    if (!isMember) {
      // Delete uploaded file if not a member
      if (req.file) {
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: req.file.key
          }));
        } catch (error) {
          console.error('Error deleting file:', error);
        }
      }
      return errorResponse(res, "Not a group member", 403);
    }

    const newMessage = {
      sender,
      message: message || 'Image',
      attachments: req.file ? [{
        type: 'image',
        url: convertS3UrlToCDN(req.file.location),
        name: req.file.originalname,
        size: req.file.size
      }] : [],
      readBy: [{ user: sender, readAt: new Date() }],
      createdAt: new Date()
    };
    group.groupMessages.push(newMessage);
    await group.save();
    // Get the last message (the one we just added)
   const sentMessage = group.groupMessages[group.groupMessages.length - 1];
  const plainSent = sentMessage.toObject();
  if (plainSent.message) {
      try {
        plainSent.message = decrypt(plainSent.message);
      } catch (e) {
        console.warn("Message decryption failed:", e.message);
      }
    }
    const senderInfo = group.groupMembers.find(
      member => member.user._id.toString() === sender.toString()
    );
    // Prepare message data for socket emission
    const messageData = {
      groupId,
      message: {
            ...plainSent,
        sender: {
          _id: senderInfo.user._id,
          fullName: `${senderInfo.user.firstName} ${senderInfo.user.lastName}`,
          profilePicture: senderInfo.user.profilePicture
        }
      }
    };
    // Emit message to all group members
    const io = getIo();
    if (io) {
      console.log(`Emitting new group message to room group:${groupId}`);
      // Emit to the group room
      io.to(`group:${groupId}`).emit('newGroupMessage', messageData);
      // Also emit individually to ensure delivery
      group.groupMembers.forEach(member => {
        const memberId = member.user._id.toString();
        io.to(memberId).emit('newGroupMessage', messageData);
       // console.log(`Emitted message to group member: ${memberId}`);
      });
    } else {
      console.error('Socket.io instance not available');
    }
    return successResponse(res, {
      ...plainSent,
      sender: {
        _id: senderInfo.user._id,
        fullName: `${senderInfo.user.firstName} ${senderInfo.user.lastName}`,
        profilePicture: senderInfo.user.profilePicture
      }
    }, "Message sent successfully", 200);
  } catch (error) {
    // Delete uploaded file if error occurs
    if (req.file) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: req.file.key
        }));
      } catch (deleteError) {
        console.error('Error deleting file:', deleteError);
      }
    }
    console.error('Send group message error:', error);
    return errorResponse(res, error.message, 500);
  }
};
// 2. Delete Group Chat
exports.deleteGroupChat = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return errorResponse(res, 400, "Invalid group ID.");
    }

    const group = await GroupChat.findById(groupId);

    if (!group) {
      return errorResponse(res, 404, "Group not found.");
    }

    // Check if user is creator or admin
    const isAdmin = group.admins.map(id => id.toString()).includes(userId.toString());
    const isCreator = group.creator.toString() === userId.toString();

    if (!isAdmin && !isCreator) {
      return errorResponse(res, 403, "Only creator or admins can delete the group.");
    }

    // Delete image from S3 if exists
    if (group.groupImage) {
      const imageKey = group.groupImage.split('/').pop(); // Assuming file name is at the end of the URL
      const deleteCommand = new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `uploads/${imageKey}`
      });

      await s3Client.send(deleteCommand);
      console.log("S3 image deleted.");
    }

    // Delete group from DB
    await GroupChat.findByIdAndDelete(groupId);

    // Notify members via socket
    const io = getIo();
    if (io) {
      group.groupMembers.forEach(member => {
        io.to(member.user.toString()).emit('groupDeleted', {
          groupId,
          message: `Group "${group.groupName}" has been deleted.`
        });
      });
    }

    return successResponse(res, null, "Group deleted successfully", 200);
  } catch (error) {
    console.error("Error deleting group:", error);
    return errorResponse(res, 500, "Failed to delete group.");
  }
};

exports.getGroupMessages = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user?._id || req.userId;

    const skip = (page - 1) * limit;

    const group = await GroupChat.findById(groupId)
      .populate('sanghId')
      .populate({
        path: 'groupMessages.sender',
        select: 'firstName lastName fullName profilePicture'
      })
      .populate({
        path: 'groupMessages.readBy.user',
        select: 'firstName lastName fullName profilePicture'
      })
      .slice('groupMessages', [skip, parseInt(limit)]);

    if (!group) {
      return errorResponse(res, "Group not found", 404);
    }

    const isMember = group.groupMembers.some(
      member => member.user.toString() === userId.toString()
    );

    if (!isMember) {
      return errorResponse(res, "Not authorized to view messages", 403);
    }

   // ✅ Decrypt & update readBy
const decryptedMessages = await Promise.all(
  group.groupMessages
    .filter(msg => {
      if (!msg.deletedFor) return true;
      return !msg.deletedFor.map(id => id.toString()).includes(userId.toString());
    })
    .map(async (msg) => {
      const plain = msg.toObject({ getters: true });

      // ✅ Check if already read
      const alreadyRead = msg.readBy.some(r => r.user.toString() === userId.toString());

      if (!alreadyRead) {
        msg.readBy.push({ user: userId, readAt: new Date() });
      }

      // ✅ Convert attachments to CDN url
      if (plain.attachments && plain.attachments.length > 0) {
        plain.attachments = plain.attachments.map(att => ({
          ...att,
          url: convertS3UrlToCDN(att.url)
        }));
      }

      return plain;
    })
);

await group.save();

return successResponse(res, {
  messages: decryptedMessages,
  pagination: {
    page: parseInt(page),
    limit: parseInt(limit),
    total: group.groupMessages.length
  }
}, "", 200);

  } catch (error) {
    console.error('Get group messages error:', error);
    return errorResponse(res, error.message, 500);
  }
};

exports.clearAllGroupMessagesForMe = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user?._id || req.userId;

    const group = await GroupChat.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    group.groupMessages.forEach(msg => {
      if (!msg.deletedFor) msg.deletedFor = [];
      if (!msg.deletedFor.includes(userId.toString())) {
        msg.deletedFor.push(userId.toString());
      }
    });

    await group.save();
    return res.status(200).json({ message: 'All group messages cleared for this user.' });
  } catch (err) {
    console.error('Clear all messages error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// 5. Delete Group Message
exports.deleteGroupMessage = async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const userId = req.user?._id || req.userId;
    if (!userId) {
      return res.status(401).json({ message: "User not found" });
    }
    const group = await GroupChat.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });
   // Find the message
   const messageIndex = group.groupMessages.findIndex(
    msg => msg._id.toString() === messageId
  );
  if (messageIndex === -1) {
    return errorResponse(res, "Message not found", 404);
  }
  const message = group.groupMessages[messageIndex];
    // Check if user is admin or message sender
    const isAdmin = group.admins.includes(userId);
    const isSender = message.sender.toString() === userId.toString();
    if (!isAdmin && !isSender) {
      return res.status(403).json({ message: "Not authorized to delete this message" });
    }
  // Delete attachments if any
  if (message.attachments && message.attachments.length > 0) {
    for (const attachment of message.attachments) {
      if (attachment.url) {
        try {
          // Extract key using URL parsing for more reliability
          const url = new URL(attachment.url);
          const key = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
          console.log(`Attempting to delete attachment from S3: ${key}`);
          if (!key) {
            console.error('Failed to extract S3 key from URL:', attachment.url);
            continue;
          }
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: key
        }));
        console.log(`Successfully deleted attachment from S3: ${key}`);
        } catch (error) {
          console.error('Error deleting attachment:', error.message);
          console.error('Attachment URL:', attachment.url);
        }
      }
    }
  }
     // Remove the message
     group.groupMessages.pull({ _id: messageId });
     await group.save();
     // Notify group members about message deletion
     const io = getIo();
     group.groupMembers.forEach(member => {
       io.to(member.user.toString()).emit('groupMessageDeleted', {
         groupId,
         messageId
       });
     });
     return successResponse(res, "", "Message deleted successfully", 200);
    } catch (error) {
      console.error('Delete group message error:', error);
      return errorResponse(res, error.message, 500);
    }
  };

  exports.deleteGroupMessageOnlyForMe = async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const userId = req.user?._id || req.userId;

    if (!userId) {
      return res.status(401).json({ message: "User not found" });
    }

    const group = await GroupChat.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const message = group.groupMessages.id(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Check if deletedFor array exists, else initialize
    if (!message.deletedFor) {
      message.deletedFor = [];
    }

    // Avoid double insert
    if (!message.deletedFor.includes(userId.toString())) {
      message.deletedFor.push(userId.toString());
    }

    await group.save();

    return res.status(200).json({ message: "Message deleted for you only" });
  } catch (error) {
    console.error("Error in deleteGroupMessageOnlyForMe:", error.message);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// 6. Update Group Message
exports.updateGroupMessage = async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const { message } = req.body;
    const userId = req.user._id;

    if (!message || message.trim() === '') {
      return res.status(400).json({ message: "Message content is required" });
    }

    // Find group where message exists and user is the sender
    const group = await GroupChat.findOneAndUpdate(
      {
        _id: groupId,
        "groupMessages._id": messageId,
        "groupMessages.sender": userId
      },
      {
        $set: {
          "groupMessages.$.message": message,
          "groupMessages.$.edited": true
        }
      },
      { new: true }
    );

    if (!group) {
      return res.status(404).json({ message: "Message not found or unauthorized" });
    }

    // Emit update via socket
    const io = getIo();
    io.to(groupId).emit('messageEdited', {
      messageId,
      updatedMessage: message
    });

    res.status(200).json({ message: "Message updated successfully", groupId, messageId, updatedMessage: message });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// Update Group Details (Name, Image, Members)
exports.updateGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { groupName } = req.body;
    const userId = req.user._id;

    // Fetch group details
    const group = await GroupChat.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Check if user is an admin
    if (!group.admins.includes(userId)) {
      return errorResponse(res, "Only admins can update group details", 403);
    }

    // ✅ Group Name Update
    if (groupName) {
      group.groupName = groupName;
    }

    // ✅ Handle Group Image Update
    if (req.file) {
      // Delete Old Image from AWS S3
      if (group.groupImage) {
        const oldKey = group.groupImage.split('.com/')[1]; // Extract key from URL
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: oldKey
          }));
        } catch (deleteError) {
          console.error('Error deleting old icon:', deleteError);
          // Continue with update even if delete fails
        }
      }
      // ✅ Save New Image
      group.groupImage = convertS3UrlToCDN(req.file.location);
    }
    await group.save();
    // Notify group members about the update
    const io = getIo();
    group.groupMembers.forEach(member => {
      io.to(member.user.toString()).emit('groupUpdated', {
        groupId,
        groupName: group.groupName,
        groupImage: group.groupImage,
      });
    });
    console.log("Group updated successfully:", group);
    res.status(200).json({ message: "Group details updated successfully", group });
  } catch (error) {
    console.error("Error updating group details:", error);
    res.status(500).json({ error: error.message });
  }
};

// Add typing indicator for groups
exports.handleGroupTyping = async (socket, groupId) => {
  try {
    const group = await GroupChat.findById(groupId);
    if (!group) return;

    group.groupMembers.forEach(member => {
      if (member.user.toString() !== socket.userId.toString()) {
        socket.to(member.user.toString()).emit('userTypingInGroup', {
          userId: socket.userId,
          groupId
        });
      }
    });
  } catch (error) {
    console.error('Error handling group typing:', error);
  }
};

// Leave group
exports.leaveGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;
    const group = await GroupChat.findById(groupId);
    if (!group) {
      return errorResponse(res, "Group not found", 404);
    }
    // Check f user is in group
    const isMember = group.groupMembers.some(
      member => member.user.toString() === userId.toString()
    );

    if (!isMember) {
      return errorResponse(res, "You are not a member of this group", 400);
    }

    // Check admin status
    const isAdmin = group.admins.includes(userId);
    if (isAdmin) {
      // If there are other admins, allow leaving
      const otherAdmins = group.admins.filter(adminId => 
        adminId.toString() !== userId.toString()
      );

      if (otherAdmins.length === 0) {
        // If no other admins, make the longest-standing member an admin
        const oldestMember = group.groupMembers
          .filter(member => member.user.toString() !== userId.toString())
          .sort((a, b) => a.joinedAt - b.joinedAt)[0];

        if (oldestMember) {
          group.admins.push(oldestMember.user);
          const memberIndex = group.groupMembers.findIndex(
            m => m.user.toString() === oldestMember.user.toString()
          );
          if (memberIndex !== -1) {
            group.groupMembers[memberIndex].role = 'admin';
          }
        }
      }
    }

    // Remove user from group
    group.groupMembers = group.groupMembers.filter(
      member => member.user.toString() !== userId.toString()
    );
    group.admins = group.admins.filter(
      adminId => adminId.toString() !== userId.toString()
    );

    if (group.groupMembers.length === 0) {
      await group.deleteOne();
      return successResponse(res, "", "Group deleted as no members remain", 200);
    }

    await group.save();

    // Notify other members
    const io = getIo();
    group.groupMembers.forEach(member => {
      io.to(member.user.toString()).emit('groupMemberLeft', {
        groupId,
        userId,
        remainingMembers: group.groupMembers.length
      });
    });

    return successResponse(res, "", "Successfully left the group", 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
// Remove a user from group (Admin only)
exports.removeUserFromGroup = async (req, res) => {
  try {
    const { groupId, userIdToRemove } = req.body;
    const adminId = req.user._id;

    const group = await GroupChat.findById(groupId);
    if (!group) {
      return errorResponse(res, "Group not found", 404);
    }

    // Check if requesting user is an admin
    if (!group.admins.includes(adminId.toString())) {
      return errorResponse(res, "Only admins can remove members", 403);
    }

    // Check if user to be removed is in the group
    const isMember = group.groupMembers.some(
      member => member.user.toString() === userIdToRemove
    );
    if (!isMember) {
      return errorResponse(res, "User is not a member of this group", 400);
    }

    // Prevent removing self using this endpoint
    if (adminId.toString() === userIdToRemove.toString()) {
      return errorResponse(res, "Use leaveGroup to leave the group yourself", 400);
    }

    // Remove from members
    group.groupMembers = group.groupMembers.filter(
      member => member.user.toString() !== userIdToRemove
    );

    // Remove from admins (if admin)
    group.admins = group.admins.filter(
      adminId => adminId.toString() !== userIdToRemove
    );

    // If no members left, delete group
    if (group.groupMembers.length === 0) {
      await group.deleteOne();
      return successResponse(res, "", "Group deleted as no members remain", 200);
    }

    await group.save();

    // Notify members via socket.io
    const io = getIo();
    group.groupMembers.forEach(member => {
      io.to(member.user.toString()).emit('groupMemberRemoved', {
        groupId,
        removedUserId: userIdToRemove,
        by: adminId
      });
    });

    return successResponse(res, "", "User removed from group", 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// Update group icon
exports.updateGroupIcon = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;

    if (!req.file) {
      return errorResponse(res, "No image file provided", 400);
    }

    const group = await GroupChat.findById(groupId);
    if (!group) {
      return errorResponse(res, "Group not found", 404);
    }

    // Check if user is admin
    if (!group.admins.includes(userId)) {
      return errorResponse(res, "Only admins can update group icon", 403);
    }

    // Delete old icon if exists
    if (group.groupImage) {
      const oldKey = group.groupImage.split('.com/')[1]; // Extract key from URL
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: oldKey
        }));
      } catch (deleteError) {
        console.error('Error deleting old icon:', deleteError);
        // Continue with update even if delete fails
      }
    }

    // Update with new icon
    group.groupImage = req.file.location;
    await group.save();

    // Notify members
    const io = getIo();
    group.groupMembers.forEach(member => {
      io.to(member.user.toString()).emit('groupIconUpdated', {
        groupId,
        newIcon: group.groupImage
      });
    });

    return successResponse(res, { groupImage: group.groupImage }, "Group icon updated successfully", 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// Check group membership
exports.checkMembership = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;

    const group = await GroupChat.findById(groupId);
    if (!group) {
      return errorResponse(res, "Group not found", 404);
    }

    const isMember = group.groupMembers.some(
      member => member.user.toString() === userId.toString()
    );
    const isAdmin = group.admins.includes(userId);

    return successResponse(res, {
      isMember,
      isAdmin,
      memberCount: group.groupMembers.length
    }, "", 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// Add members to group
exports.addMembers = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { members } = req.body;
    const userId = req.user._id;

    const group = await GroupChat.findById(groupId);
    if (!group) {
      return errorResponse(res, "Group not found", 404);
    }

    // Check if user is admin
    if (!group.admins.includes(userId)) {
      return errorResponse(res, "Only admins can add members", 403);
    }

    // Filter out existing members
    const newMembers = members.filter(memberId => 
      !group.groupMembers.some(m => m.user.toString() === memberId)
    );

    // Add new members
    group.groupMembers.push(...newMembers.map(memberId => ({
      user: memberId,
      role: 'member'
    })));

    await group.save();

    // Notify new members
    const io = getIo();
    newMembers.forEach(memberId => {
      io.to(memberId.toString()).emit('addedToGroup', {
        groupId: group._id,
        groupName: group.groupName
      });
    });

    return successResponse(res, { addedMembers: newMembers }, "Members added successfully", 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// Update group name
exports.updateGroupName = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { groupName } = req.body;
    const userId = req.user._id;

    const group = await GroupChat.findById(groupId);
    if (!group) {
      return errorResponse(res, "Group not found", 404);
    }

    // Check if user is admin
    if (!group.admins.includes(userId)) {
      return errorResponse(res, "Only admins can update group name", 403);
    }

    group.groupName = groupName;
    await group.save();

    // Notify members
    const io = getIo();
    group.groupMembers.forEach(member => {
      io.to(member.user.toString()).emit('groupUpdated', {
        groupId: group._id,
        groupName: group.groupName
      });
    });

    return successResponse(res, { groupName: group.groupName }, "Group name updated successfully", 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
// Promote a group member to admin
exports.makeAdmin = async (req, res) => {
  const { groupId } = req.params;
  const { targetUserId } = req.body;
  const currentUserId = req.user._id;

  const group = await GroupChat.findById(groupId);
  const isCurrentUserAdmin = group.admins.includes(currentUserId);
  if (!isCurrentUserAdmin) return res.status(403).send("Not authorized");

  // Update role
  const member = group.groupMembers.find(m => m.user.toString() === targetUserId);
  if (member) member.role = 'admin';

  if (!group.admins.includes(targetUserId)) {
    group.admins.push(targetUserId);
  }

  await group.save();
  return res.status(200).send("User promoted to admin");
};
// Remove admin role from a group member
exports.removeAdmin = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { targetUserId } = req.body;
    const currentUserId = req.user._id;

    const group = await GroupChat.findById(groupId);
    if (!group) return res.status(404).send("Group not found");

    // Check if current user is admin
    const isCurrentUserAdmin = group.admins.includes(currentUserId.toString());
    if (!isCurrentUserAdmin) {
      return res.status(403).send("Not authorized");
    }

    // Check if target user is actually admin
    if (!group.admins.includes(targetUserId.toString())) {
      return res.status(400).send("User is not an admin");
    }

    // Update role in groupMembers
    const member = group.groupMembers.find(
      m => m.user.toString() === targetUserId
    );
    if (member) {
      member.role = "member"; // 👈 downgrade
    }

    // Remove from admins array
    group.admins = group.admins.filter(id => id.toString() !== targetUserId);

    await group.save();

    return res.status(200).send("Admin rights removed successfully");
  } catch (error) {
    console.error("Error removing admin:", error);
    return res.status(500).send("Server error");
  }
};
