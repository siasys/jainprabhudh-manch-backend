const express = require("express");
const upload = require("../../middlewares/upload");
const {
  uploadGranth,
  getAllGranths,
  deleteGranth,
  incrementView,
  incrementDownload,
  uploadBhajan,
  getAllBhajans,
  incrementPlay,
} = require("../../controller/Jain Granth/jainGranthController");

const router = express.Router();

router.post("/upload", upload.jainGranthUpload, uploadGranth);
router.get("/all", getAllGranths);
router.delete("/delete/:id", deleteGranth);
router.patch("/view/:id", incrementView);
router.patch("/download/:id", incrementDownload);

// ─── BHAJAN routes (additive) ─ delete ke liye upar wala /delete/:id hi chalega ───
router.post("/bhajan/upload", upload.jainBhajanUpload, uploadBhajan);
router.get("/bhajan/all", getAllBhajans);
router.patch("/bhajan/play/:id", incrementPlay);

module.exports = router;
