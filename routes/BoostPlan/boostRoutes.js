const express = require("express");
const router = express.Router();
const { createBoostPlan } = require("../../controller/BoostPlan/boostController");
const upload = require("../../middlewares/upload");

router.post("/create", upload.boostUploads, createBoostPlan);

module.exports = router;
