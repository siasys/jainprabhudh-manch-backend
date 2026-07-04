const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
const VyaparProduct = require("../../model/VyaparModels/Productmodel");
const JainVyapar = require("../../model/VyaparModels/vyaparModel");

// ══════════════════════════════════════════════════════════
// Small helper — safely parse JSON string OR return array
// ══════════════════════════════════════════════════════════
const parseJsonArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    // If not JSON, treat as comma-separated string
    return String(val)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
};

// ══════════════════════════════════════════════════════════
// @desc    Seller uploads a new product for their business
// @route   POST /api/vyapar/products/upload
// @access  Private (auth required; must own the vyapar)
// ══════════════════════════════════════════════════════════
const uploadProduct = asyncHandler(async (req, res) => {
  try {
    const body = req.body;
    const userId = req.user?._id;

    // ─── 1. Auth sanity check ───
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized — please login again",
      });
    }

    // ─── 2. Validate required fields ───
    if (!body.vyaparId) {
      return res.status(400).json({
        success: false,
        message: "vyaparId is required",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(body.vyaparId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vyaparId",
      });
    }
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }
    if (!body.category || !String(body.category).trim()) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }
    if (body.price === undefined || body.price === null || body.price === "") {
      return res.status(400).json({
        success: false,
        message: "Price is required",
      });
    }
    const priceNum = Number(body.price);
    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid positive number",
      });
    }

    // ─── 3. Verify vyapar exists AND user owns it ───
    const vyapar = await JainVyapar.findById(body.vyaparId).select(
      "userId businessName applicationStatus",
    );
    if (!vyapar) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }
    if (String(vyapar.userId) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: "You do not own this business — cannot add products",
      });
    }
    if (vyapar.applicationStatus !== "approved") {
      return res.status(403).json({
        success: false,
        message:
          "Your business is not approved yet — cannot upload products until approval",
      });
    }

    // ─── 4. Handle photo uploads ───
    // Multer + uploadToS3 middleware sets req.files.productPhotos[i].location
    const photoUrls = (req.files?.productPhotos || []).map((f) =>
      convertS3UrlToCDN(f.location),
    );

    if (photoUrls.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one product image is required",
      });
    }

    // ─── 5. Parse MRP / stock / expiryDate ───
    const mrpNum =
      body.mrp !== undefined && body.mrp !== null && body.mrp !== ""
        ? Number(body.mrp)
        : 0;
    const stockNum =
      body.stock !== undefined && body.stock !== null && body.stock !== ""
        ? Number(body.stock)
        : null;

    // MRP sanity — if provided, must be >= price
    if (mrpNum && mrpNum < priceNum) {
      return res.status(400).json({
        success: false,
        message: "MRP cannot be less than selling price",
      });
    }

    let expiryDate = null;
    if (body.expiryDate) {
      const d = new Date(body.expiryDate);
      if (!isNaN(d.getTime())) expiryDate = d;
    }

    // ─── 6. Build product document ───
    const productDoc = {
      vyaparId: body.vyaparId,
      userId,

      name: String(body.name).trim(),
      category: String(body.category).trim(),
      description: body.description ? String(body.description).trim() : "",

      price: priceNum,
      mrp: mrpNum,
      stock: stockNum,
      unit: body.unit || "piece",

      photos: photoUrls,

      badge: body.badge || "",

      // Variant / extra info
      sizes: parseJsonArray(body.sizes),
      colors: parseJsonArray(body.colors),
      material: body.material || "",
      metal: body.metal || "",
      weight: body.weight || "",
      expiryDate,
      batchNo: body.batchNo || "",
      vegTag: body.vegTag || "",
      language: body.language || "",
      format: body.format || "",
      customOptions: parseJsonArray(body.customOptions),

      status: stockNum === 0 ? "out_of_stock" : "active",
      isDeleted: false,
    };

    // ─── 7. Create in DB ───
    const product = await VyaparProduct.create(productDoc);

    // ─── 8. Success response ───
    return res.status(201).json({
      success: true,
      message: "Product uploaded successfully",
      data: {
        _id: product._id,
        vyaparId: product.vyaparId,
        userId: product.userId,
        name: product.name,
        category: product.category,
        description: product.description,
        price: product.price,
        mrp: product.mrp,
        stock: product.stock,
        unit: product.unit,
        photos: product.photos,
        badge: product.badge,
        sizes: product.sizes,
        colors: product.colors,
        material: product.material,
        metal: product.metal,
        weight: product.weight,
        expiryDate: product.expiryDate,
        batchNo: product.batchNo,
        vegTag: product.vegTag,
        language: product.language,
        format: product.format,
        customOptions: product.customOptions,
        status: product.status,
        createdAt: product.createdAt,
        vyapar: {
          _id: vyapar._id,
          businessName: vyapar.businessName,
        },
      },
    });
  } catch (error) {
    console.error("❌ uploadProduct error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while uploading product",
      error: error.message,
    });
  }
});

module.exports = {
  uploadProduct,
};
