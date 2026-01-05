const express = require("express");
const router = express.Router();
const { createBoostPlan, getAllBoostPlans } = require("../../controller/BoostPlan/boostController");
const upload = require("../../middlewares/upload");

router.post("/create", upload.boostUploads, createBoostPlan);
router.get("/boost-plans", getAllBoostPlans);

module.exports = router;
