const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/upload");
const {
  createGroupChat,
  getGroupDetails,
  getAllGroups,
  getAllGroupChats,
  sendGroupMessage,
  getGroupMessages,
  deleteGroupMessage,
  updateGroupDetails,
  updateGroupMessage,
  leaveGroup,
  updateGroupIcon,
  checkMembership,
  addMembers,
  updateGroupName,
  createOrFindGotraGroup,
  getAllGotraGroups,
  getUserGotraGroups,
  deleteGroupChat,
  makeAdmin,
  createOrFindHierarchicalSanghGroup,
  removeUserFromGroup,
  deleteGroupMessageOnlyForMe,
  clearAllGroupMessagesForMe,
  removeAdmin,
  createOrFindCityGroup,
  createSanghGlobalGroup,
  getGroupUnreadCounts,
  markGroupMessagesRead,
} = require("../../controller/SocialMediaControllers/groupChatController");
const { authenticate } = require("../../middlewares/authMiddlewares");
// Apply authentication to all routes
router.use(authenticate);

router.post(
  "/create",
  upload.single("groupImage"),
  upload.compressFiles,
  upload.uploadToS3,
  createGroupChat,
);
// ✅ FIX: compressFiles + uploadToS3 missing the -> groupImage S3 par nahi jaati thi.
router.post(
  "/create-gotra-group",
  upload.single("groupImage"),
  upload.compressFiles,
  upload.uploadToS3,
  createOrFindGotraGroup,
);
router.post(
  "/create-hierarchical-sangh-group",
  createOrFindHierarchicalSanghGroup,
);
router.post("/create-sangh-global-group", createSanghGlobalGroup);
router.post("/remove-user", removeUserFromGroup);
// ✅ FIX: compressFiles + uploadToS3 missing the -> groupImage S3 par nahi jaati thi.
router.post(
  "/create-city-group",
  upload.single("groupImage"),
  upload.compressFiles,
  upload.uploadToS3,
  createOrFindCityGroup,
);

// Get all groups for a user
router.get("/user-groups", getAllGroups);
router.get("/gotra-groups", getUserGotraGroups);
router.get("/unread-counts", getGroupUnreadCounts);
// Get group details
router.get("/:groupId", getGroupDetails);
// Get all group chats
router.get("/all-chats", getAllGroupChats);
// Send Group Message
router.post(
  "/send-message",
  upload.single("chatImage"),
  upload.compressFiles,
  upload.uploadToS3,
  sendGroupMessage,
); // Get All Messages for a Group
router.get("/messages/:groupId", getGroupMessages);
router.post("/mark-read/:groupId", markGroupMessagesRead);
router.delete("/delete/:groupId", deleteGroupChat);
// Delete Group Message
router.delete("/messages/onlyme/clearall/:groupId", clearAllGroupMessagesForMe);
router.delete("/messages/:groupId/:messageId", deleteGroupMessage);
router.delete(
  "/messages/onlyme/:groupId/:messageId",
  deleteGroupMessageOnlyForMe,
);

// Update Group Details (Name, Image, Members)
// ✅ FIX: `upload.compressFiles` aur `upload.uploadToS3` missing the.
// updateGroupDetails `req.file.location` padhta hai, jo sirf uploadToS3 set
// karta hai -- uske bina image kabhi S3 par jati hi nahi thi.
// Ye wahi chain hai jo /create aur /send-message par pehle se lagi hai.
router.put(
  "/update/:groupId",
  upload.single("groupImage"),
  upload.compressFiles,
  upload.uploadToS3,
  updateGroupDetails,
);
router.put("/make-admin/:groupId", makeAdmin);
router.put("/remove-admin/:groupId", removeAdmin);

// Leave group
router.post("/leave/:groupId", leaveGroup);
// Update group icon
// ✅ FIX: compressFiles + uploadToS3 missing the -> groupIcon S3 par nahi jaati thi.
router.post(
  "/icon/:groupId",
  upload.single("groupIcon"),
  upload.compressFiles,
  upload.uploadToS3,
  updateGroupIcon,
);
// Check group membership
router.get("/check-membership/:groupId", checkMembership);
// Add members to group
router.post("/add-members/:groupId", addMembers);
// Update group name
router.put("/update-name/:groupId", updateGroupName);
// Update Group Message
router.put("/update-messages/:groupId/:messageId", updateGroupMessage);

module.exports = router;
