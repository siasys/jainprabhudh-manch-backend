const express = require('express');
const {sendNotification, getNotifications, markAllNotificationsRead, deleteNotification} = require('../../controller/SocialMediaControllers/notificationController');
const router = express.Router();

router.post('/send', sendNotification);
router.get('/user/:userId', getNotifications);
router.put('/read/:userId', markAllNotificationsRead);
router.delete('/delete/:notificationId', deleteNotification);
module.exports = router;
