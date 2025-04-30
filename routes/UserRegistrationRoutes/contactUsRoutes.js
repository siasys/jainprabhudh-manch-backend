const express = require('express');
const router = express.Router();
const upload = require('../../middlewares/upload'); // for image uploads
const { createContactUs, getAllContactUs } = require('../../controller/UserRegistrationControllers/contactUsController');

router.post('/', upload.single('profilePicture'), createContactUs);
router.get('/get', getAllContactUs);

module.exports = router;
