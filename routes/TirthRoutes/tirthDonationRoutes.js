const express = require("express");
const router = express.Router();

const {
  getTirthDonationInfo,
} = require("../../controller/TirthControllers/tirthDonationController");

router.get("/info/:tirthId", getTirthDonationInfo);

module.exports = router;
