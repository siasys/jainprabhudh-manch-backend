const express = require("express");
const upload = require("../../middlewares/upload");
const { uploadGranth, getAllGranths, deleteGranth } = require("../../controller/Jain Granth/jainGranthController");

const router = express.Router();

router.post("/upload", upload.jainGranthUpload, uploadGranth);
router.get("/all", getAllGranths);
router.delete("/delete/:id", deleteGranth);

module.exports = router;
