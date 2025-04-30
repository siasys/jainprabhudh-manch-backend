const ContactUs = require('../../model/UserRegistrationModels/ContactUs');
const asyncHandler = require('express-async-handler');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

const createContactUs = asyncHandler(async (req, res) => {
  try {
    const { name, mobileNumber } = req.body;
    if (!name || !mobileNumber) {
      return res.status(400).json({ message: 'Name and mobile number are required' });
    }

    let profilePictureUrl = '';
    if (req.file) {
      const rawUrl = req.file.location || req.file.path;
      profilePictureUrl = convertS3UrlToCDN(rawUrl);
    }

    const contact = await ContactUs.create({
      name,
      mobileNumber,
      profilePicture: profilePictureUrl
    });

    res.status(201).json({ message: 'Contact form submitted', contact });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const getAllContactUs = asyncHandler(async (req, res) => {
  try {
    const contacts = await ContactUs.find().sort({ createdAt: -1 });
    res.status(200).json(contacts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = { createContactUs, getAllContactUs };
