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

// ══════════════════════════════════════════════════════════════════════
// @desc    Marketplace — list products with filters + pagination
// @route   GET /api/vyapar/products
// @access  Private (any authenticated user)
// @query   page, limit, category, minPrice, maxPrice, search, vyaparId, sort
// ══════════════════════════════════════════════════════════════════════
const getAllProducts = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      minPrice,
      maxPrice,
      search,
      vyaparId,
      sort = "newest",
      status,
    } = req.query;

    // Build filter
    const filter = { isDeleted: false };

    // Default only active products for public listing (admin/seller can override)
    if (status) {
      filter.status = status;
    } else {
      filter.status = "active";
    }

    if (category && category !== "All") {
      filter.category = category;
    }

    if (vyaparId && mongoose.Types.ObjectId.isValid(vyaparId)) {
      filter.vyaparId = vyaparId;
    }

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    // Text search on name + description (case-insensitive)
    if (search && String(search).trim()) {
      const q = String(search).trim();
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } },
      ];
    }

    // Sort options
    let sortObj = { createdAt: -1 };
    switch (sort) {
      case "price_asc":
        sortObj = { price: 1 };
        break;
      case "price_desc":
        sortObj = { price: -1 };
        break;
      case "popular":
        sortObj = { "ratingSummary.count": -1, createdAt: -1 };
        break;
      case "rating":
        sortObj = { "ratingSummary.average": -1, createdAt: -1 };
        break;
      case "oldest":
        sortObj = { createdAt: 1 };
        break;
      default:
        sortObj = { createdAt: -1 };
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Parallel query — data + count
    const [products, total] = await Promise.all([
      VyaparProduct.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .populate("vyaparId", "businessName businessCode businessLogo location")
        .lean(),
      VyaparProduct.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Products fetched successfully",
      data: products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasMore: skip + products.length < total,
      },
    });
  } catch (error) {
    console.error("❌ getAllProducts error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching products",
      error: error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════
// @desc    Get single product by ID (product details screen)
// @route   GET /api/vyapar/products/:productId
// @access  Private (any authenticated user)
// ══════════════════════════════════════════════════════════════════════
const getProductById = asyncHandler(async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const product = await VyaparProduct.findOne({
      _id: productId,
      isDeleted: false,
    }).populate(
      "vyaparId",
      "businessName businessCode businessLogo location contactPerson email alternativeNumber ownerName socialLinks workingHours",
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found or has been removed",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product fetched successfully",
      data: product,
    });
  } catch (error) {
    console.error("❌ getProductById error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching product",
      error: error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════
// @desc    Get all products of a specific business (public listing)
// @route   GET /api/vyapar/products/business/:vyaparId
// @access  Private (any authenticated user)
// @query   page, limit, sort
// ══════════════════════════════════════════════════════════════════════
const getProductsByBusiness = asyncHandler(async (req, res) => {
  try {
    const { vyaparId } = req.params;
    const { page = 1, limit = 20, sort = "newest", status } = req.query;

    if (!mongoose.Types.ObjectId.isValid(vyaparId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid business ID",
      });
    }

    // Verify business exists
    const vyapar = await JainVyapar.findById(vyaparId).select(
      "businessName businessCode businessLogo location applicationStatus",
    );
    if (!vyapar) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    // Build filter
    const filter = { vyaparId, isDeleted: false };
    if (status) {
      filter.status = status;
    } else {
      filter.status = "active";
    }

    // Sort
    let sortObj = { createdAt: -1 };
    if (sort === "price_asc") sortObj = { price: 1 };
    else if (sort === "price_desc") sortObj = { price: -1 };
    else if (sort === "popular")
      sortObj = { "ratingSummary.count": -1, createdAt: -1 };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      VyaparProduct.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      VyaparProduct.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Business products fetched successfully",
      data: {
        business: {
          _id: vyapar._id,
          businessName: vyapar.businessName,
          businessCode: vyapar.businessCode,
          businessLogo: vyapar.businessLogo,
          location: vyapar.location,
        },
        products,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasMore: skip + products.length < total,
      },
    });
  } catch (error) {
    console.error("❌ getProductsByBusiness error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching business products",
      error: error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════
// @desc    Get logged-in seller's own products
// @route   GET /api/vyapar/products/my/list
// @access  Private (seller — token identifies user)
// @query   page, limit, sort, status
// ══════════════════════════════════════════════════════════════════════
const getMyProducts = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    const { page = 1, limit = 20, sort = "newest", status } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Include ALL statuses by default for seller (they want to see out_of_stock etc.)
    const filter = { userId, isDeleted: false };
    if (status) filter.status = status;

    let sortObj = { createdAt: -1 };
    if (sort === "price_asc") sortObj = { price: 1 };
    else if (sort === "price_desc") sortObj = { price: -1 };
    else if (sort === "oldest") sortObj = { createdAt: 1 };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      VyaparProduct.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .populate("vyaparId", "businessName businessCode")
        .lean(),
      VyaparProduct.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Your products fetched successfully",
      data: products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasMore: skip + products.length < total,
      },
    });
  } catch (error) {
    console.error("❌ getMyProducts error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching your products",
      error: error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════
// @desc    Edit / update a product (owner only)
// @route   PUT /api/vyapar/products/:productId
// @access  Private + Ownership
// ══════════════════════════════════════════════════════════════════════
const updateProduct = asyncHandler(async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user?._id;
    const body = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    // Fetch existing product
    const product = await VyaparProduct.findOne({
      _id: productId,
      isDeleted: false,
    });
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Ownership check
    if (String(product.userId) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: "You do not own this product",
      });
    }

    // ─── Photos handling ───
    // Two things from client:
    //   1. existingPhotos → JSON array of current photo URLs to KEEP (deleted ones removed)
    //   2. productPhotos (files) → new photos to APPEND
    //
    // Final photos = keptExisting + newlyUploaded
    // If neither provided → keep existing untouched

    let finalPhotos = product.photos || [];

    // If client sent explicit existingPhotos list (even empty), respect it
    if (body.existingPhotos !== undefined) {
      const kept = parseJsonArray(body.existingPhotos);
      // Only keep photos that were actually in the product (security)
      finalPhotos = kept.filter((url) => product.photos.includes(url));
    }

    // Append newly uploaded photos
    if (req.files?.productPhotos?.length > 0) {
      const newUrls = req.files.productPhotos.map((f) =>
        convertS3UrlToCDN(f.location),
      );
      finalPhotos = [...finalPhotos, ...newUrls];
    }

    if (finalPhotos.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Product must have at least one image",
      });
    }

    // ─── Build update object ───
    const updates = { photos: finalPhotos };

    // Basic fields — only update if provided
    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n) {
        return res.status(400).json({
          success: false,
          message: "Product name cannot be empty",
        });
      }
      updates.name = n;
    }
    if (body.category !== undefined) {
      const c = String(body.category).trim();
      if (!c) {
        return res.status(400).json({
          success: false,
          message: "Category cannot be empty",
        });
      }
      updates.category = c;
    }
    if (body.description !== undefined)
      updates.description = String(body.description).trim();

    // Pricing
    let priceNum = product.price;
    if (body.price !== undefined) {
      priceNum = Number(body.price);
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid price",
        });
      }
      updates.price = priceNum;
    }
    let mrpNum = product.mrp;
    if (body.mrp !== undefined) {
      mrpNum = body.mrp === "" || body.mrp === null ? 0 : Number(body.mrp);
      if (isNaN(mrpNum) || mrpNum < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid MRP",
        });
      }
      updates.mrp = mrpNum;
    }
    if (mrpNum && mrpNum < priceNum) {
      return res.status(400).json({
        success: false,
        message: "MRP cannot be less than selling price",
      });
    }

    // Stock — updating stock may also flip status
    if (body.stock !== undefined) {
      const stockNum =
        body.stock === "" || body.stock === null ? null : Number(body.stock);
      updates.stock = stockNum;
      // Auto status update — only touch if seller isn't explicitly setting status
      if (body.status === undefined) {
        if (stockNum === 0) {
          updates.status = "out_of_stock";
        } else if (stockNum > 0 && product.status === "out_of_stock") {
          updates.status = "active";
        }
      }
    }

    if (body.unit !== undefined) updates.unit = body.unit || "piece";
    if (body.badge !== undefined) updates.badge = body.badge || "";

    // Variants
    if (body.sizes !== undefined) updates.sizes = parseJsonArray(body.sizes);
    if (body.colors !== undefined) updates.colors = parseJsonArray(body.colors);
    if (body.customOptions !== undefined)
      updates.customOptions = parseJsonArray(body.customOptions);

    if (body.material !== undefined) updates.material = body.material || "";
    if (body.metal !== undefined) updates.metal = body.metal || "";
    if (body.weight !== undefined) updates.weight = body.weight || "";
    if (body.batchNo !== undefined) updates.batchNo = body.batchNo || "";
    if (body.vegTag !== undefined) updates.vegTag = body.vegTag || "";
    if (body.language !== undefined) updates.language = body.language || "";
    if (body.format !== undefined) updates.format = body.format || "";

    if (body.expiryDate !== undefined) {
      if (!body.expiryDate) {
        updates.expiryDate = null;
      } else {
        const d = new Date(body.expiryDate);
        if (!isNaN(d.getTime())) updates.expiryDate = d;
      }
    }

    // Status — seller-controlled override (active/inactive/out_of_stock)
    if (body.status !== undefined) {
      const allowed = ["active", "inactive", "out_of_stock"];
      if (!allowed.includes(body.status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed: ${allowed.join(", ")}`,
        });
      }
      updates.status = body.status;
    }

    // ─── Apply update ───
    const updated = await VyaparProduct.findByIdAndUpdate(
      productId,
      { $set: updates },
      { new: true, runValidators: true },
    ).populate("vyaparId", "businessName businessCode");

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("❌ updateProduct error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating product",
      error: error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════
// @desc    Delete a product (soft delete — preserves order history)
// @route   DELETE /api/vyapar/products/:productId
// @access  Private + Ownership
// ══════════════════════════════════════════════════════════════════════
const deleteProduct = asyncHandler(async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const product = await VyaparProduct.findOne({
      _id: productId,
      isDeleted: false,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found or already deleted",
      });
    }

    // Ownership check
    if (String(product.userId) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: "You do not own this product",
      });
    }

    // Soft delete — preserves cart/wishlist/order history references
    product.isDeleted = true;
    product.status = "inactive";
    await product.save();

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully",
      data: { _id: product._id },
    });
  } catch (error) {
    console.error("❌ deleteProduct error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting product",
      error: error.message,
    });
  }
});

module.exports = {
  uploadProduct,
  getAllProducts,
  getProductById,
  getProductsByBusiness,
  getMyProducts,
  updateProduct,
  deleteProduct,
};
