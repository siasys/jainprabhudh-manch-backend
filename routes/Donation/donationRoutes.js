const express = require('express');
const router = express.Router();
const { donationUpload } = require('../../middlewares/upload');
const { createDonation, getAllDonations, getDonationById, updateDonation} = require('../../controller/Donation/donationController');

router.post('/create', donationUpload, createDonation);
router.put('/update/:donationId', donationUpload, updateDonation);

router.get('/all', getAllDonations);

router.get('/:donationId', getDonationById);

module.exports = router;
