const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../middlewares/authMiddlewares");
const upload = require("../../middlewares/upload");
const { getMyProducts, getProductsByBusiness, getAllProducts, uploadProduct, getProductById, updateProduct, deleteProduct } = require("../../controller/VyaparControllers/Productcontroller");


// ─── Protected — auth required for all product routes ───
router.use(authMiddleware);

// ─── LIST endpoints ─────────────────────────────────────────
// ⚠️ ORDER MATTERS — specific routes BEFORE dynamic /:productId

// Seller's own products
// GET /api/vyapar/products/my/list
router.get("/my/list", getMyProducts);

// Products of a specific business
// GET /api/vyapar/products/business/:vyaparId
router.get("/business/:vyaparId", getProductsByBusiness);

// All products (marketplace with filters + pagination)
// GET /api/vyapar/products
router.get("/", getAllProducts);

// ─── CRUD ────────────────────────────────────────────────────

// Create — seller uploads a new product
// POST /api/vyapar/products/upload
router.post("/upload", upload.productUpload, uploadProduct);

// Read single — product details screen
// GET /api/vyapar/products/:productId
router.get("/:productId", getProductById);

// Update — edit product (owner only, supports adding/replacing photos)
// PUT /api/vyapar/products/:productId
router.put("/:productId", upload.productUpload, updateProduct);

// Delete — soft delete (owner only)
// DELETE /api/vyapar/products/:productId
router.delete("/:productId", deleteProduct);

module.exports = router;
