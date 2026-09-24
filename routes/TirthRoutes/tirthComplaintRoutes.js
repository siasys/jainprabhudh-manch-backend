const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../../middlewares/authMiddlewares");
const {
  createComplaint,
  getMyComplaints,
  markReadByUser,
} = require("../../controller/TirthControllers/tirthComplaintController");

/* sab protected — login zaroori hai */
router.use(authMiddleware);

// user apni complaints dekhe
router.get("/my", getMyComplaints);

// jawab padh liya
router.patch("/:complaintId/read", markReadByUser);

// nayi complaint (ye sabse neeche, warna /my isse match kar jayega)
router.post("/:tirthId", createComplaint);

module.exports = router;
