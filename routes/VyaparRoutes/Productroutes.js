// routes/MarketplaceRoutes/productRoutes.js
// ─────────────────────────────────────────────────────────────
// Mounted from vyaparRoutes.js via `router.use("/products", productRoutes)`,
// so every path here is relative to `/products`.
//
// Uploads reuse the existing middlewares/upload.js chain — nothing in that
// file was changed. `upload.productUpload` is already defined there as:
//     upload.fields([{ name: "productPhotos", maxCount: 6 }])
//       → compressFiles → uploadToS3
// and getS3Folder already routes "productPhotos" to "products/photos/".
// ─────────────────────────────────────────────────────────────
const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../../middlewares/authMiddlewares");
const upload = require("../../middlewares/upload");

const {
  getMarketplaceProducts,
  getSellerProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProductPhoto,
} = require("../../controller/VyaparControllers/Productcontroller");

router.use(authMiddleware);

// `/seller/:vyaparId` must come BEFORE `/:id`, otherwise "seller"
// gets read as a product id.
router.get("/seller/:vyaparId", getSellerProducts);

router.get("/", getMarketplaceProducts);
router.get("/:id", getProductById);

// Field name must stay "productPhotos" — that is what UploadProduct.jsx
// sends and what upload.js is configured for. Spreading the array runs
// multer → compressFiles → uploadToS3 in order, so by the time the
// controller runs, every file already carries `file.location` (S3 URL).
router.post("/", ...upload.productUpload, createProduct);
router.patch("/:id", ...upload.productUpload, updateProduct);

router.delete("/:id/photo/:index", deleteProductPhoto);
router.delete("/:id", deleteProduct);

// Turns "Unexpected field" / "File too large" into a clean 400
router.use(upload.handleMulterError);

module.exports = router;
