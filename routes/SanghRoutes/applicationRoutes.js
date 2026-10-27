const express = require("express");
const {
  createApplication,
  getAllApplications,
  getApplicationById,
  updateApplication,
} = require("../../controller/SanghControllers/applicationController");
const { authMiddleware } = require("../../middlewares/authMiddlewares");
const router = express.Router();

// ── sab routes par auth (req.user milega — panch verify ke liye) ──
router.use(authMiddleware);

// POST
router.post("/", createApplication);

// GET ALL
router.get("/", getAllApplications);

// GET SINGLE
router.get("/:id", getApplicationById);

// UPDATE
router.put("/:id", updateApplication);

module.exports = router;
