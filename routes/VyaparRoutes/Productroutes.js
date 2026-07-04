const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../middlewares/authMiddlewares");
const upload = require("../../middlewares/upload");
const { uploadProduct } = require("../../controller/VyaparControllers/Productcontroller");

// ─── Protected — auth required for all product routes ───
router.use(authMiddleware);

router.post("/upload", upload.productUpload, uploadProduct);

module.exports = router;
