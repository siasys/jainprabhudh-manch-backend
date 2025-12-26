const express = require('express');
const router = express.Router();

const { donationUpload } = require('../../middlewares/upload');
const { createDonation, getAllDonations, getDonationById} = require('../../controller/Donation/donationController');

router.post('/create', donationUpload, createDonation);

router.get('/all', getAllDonations);

router.get('/:donationId', getDonationById);

module.exports = router;
