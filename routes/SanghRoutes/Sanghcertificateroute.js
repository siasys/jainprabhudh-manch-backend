const express = require("express");
const { generateSanghCertificate } = require("../../controller/SanghControllers/Generatesanghcertificate");
const router = express.Router();

router.get("/:sanghId", generateSanghCertificate);

module.exports = router;
