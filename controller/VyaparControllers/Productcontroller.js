const mongoose = require("mongoose");
const Product = require("../../model/VyaparModels/Productmodel");
const JainVyapar = require("../../model/VyaparModels/vyaparModel");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");

// ── helpers ───────────────────────────────────────────────────
const ok = (res, data, message = "Success") =>
  res.status(200).json({ success: true, message, data });

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));

// Multipart bodies are flat text, so Uploadproduct.jsx sends arrays and
// objects as JSON strings. These parse them back and never throw.
const parseList = (raw) => {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw))
    return raw.map((s) => String(s).trim()).filter(Boolean);
  try {
    const out = JSON.parse(raw);
    if (!Array.isArray(out)) return null;
    return out.map((s) => String(s).trim()).filter(Boolean);
  } catch {
    // Tolerate a plain comma-separated string too
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
};

const parseSpecs = (raw) => {
  if (raw == null || raw === "") return null;
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  return arr
    .map((r) => ({
      key: String(r?.key ?? "").trim(),
      value: String(r?.value ?? "").trim(),
    }))
    .filter((r) => r.key && r.value);
};

const asBool = (v, fallback = false) => {
  if (v === undefined || v === null || v === "") return fallback;
  return v === true || v === "true" || v === "1" || v === 1;
};

// A number, or undefined when the field was left blank
const asNum = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

// Wholesale slabs arrive as a JSON string, like specs and tags do.
// Rows are normalised, sorted by minQty and de-duplicated here so the
// stored array is always in a shape the cart can trust.
const parseSlabs = (raw) => {
  if (raw == null || raw === "") return null;

  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;

  const rows = arr
    .map((s) => ({
      minQty: Math.floor(Number(s?.minQty)) || 0,
      // 0 / blank / null all mean "and above"
      maxQty:
        s?.maxQty === "" || s?.maxQty == null
          ? 0
          : Math.floor(Number(s.maxQty)) || 0,
      price: Number(s?.price),
    }))
    .filter((s) => s.minQty > 0 && Number.isFinite(s.price) && s.price >= 0);

  rows.sort((a, b) => a.minQty - b.minQty);
  return rows;
};

// A malformed ladder silently overcharges or undercharges every bulk
// order, so the rules are enforced here rather than trusted from the form.
const validateSlabs = (rows, { moq = 1, retailPrice = 0 } = {}) => {
  if (!rows.length) return "Add at least one price slab";
  if (rows.length > 6) return "You can add up to 6 price slabs";

  for (let i = 0; i < rows.length; i += 1) {
    const s = rows[i];
    const prev = rows[i - 1];

    if (s.maxQty && s.maxQty < s.minQty)
      return `Slab ${i + 1}: the "to" quantity is below the "from" quantity`;

    if (s.price > retailPrice && retailPrice > 0)
      return `Slab ${i + 1}: a bulk price above the retail price makes no sense`;

    if (!prev) {
      if (s.minQty < moq)
        return `The first slab must start at the minimum order quantity (${moq})`;
      continue;
    }

    // Two open-ended slabs would make the second unreachable
    if (!prev.maxQty)
      return `Slab ${i}: only the last slab may be left open-ended`;

    if (s.minQty <= prev.maxQty) return `Slab ${i + 1} overlaps slab ${i}`;

    if (s.minQty > prev.maxQty + 1)
      return `There is a gap between slab ${i} and slab ${i + 1}`;

    // Buying more must never cost more per unit
    if (s.price > prev.price)
      return `Slab ${i + 1} costs more per unit than slab ${i}`;
  }

  return null;
};

// Variants arrive as a JSON string, like slabs and specs do.
// Existing _id values are preserved so a cart holding a variant does not
// lose its reference when the seller edits the product.
const parseVariants = (raw) => {
  if (raw == null || raw === "") return null;

  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;

  return arr
    .map((v) => {
      const row = {
        label: String(v?.label ?? "").trim(),
        price: Number(v?.price),
        mrp: Number(v?.mrp) || 0,
        stock: Math.max(0, Math.floor(Number(v?.stock)) || 0),
        sku: String(v?.sku ?? "").trim(),
        cost: Number(v?.cost) || 0,
        isDefault: v?.isDefault === true || v?.isDefault === "true",
        bulkPricing: parseSlabs(v?.bulkPricing) || [],
      };
      // Keep the id when the client sends one back, so cart references hold
      if (v?._id && isId(v._id)) row._id = v._id;
      return row;
    })
    .filter((v) => v.label && Number.isFinite(v.price) && v.price >= 0);
};

// Two variants with the same label are impossible to tell apart in the
// cart, and a product with none is just a broken listing.
const validateVariants = (rows, { wholesaleEnabled = false, moq = 1 } = {}) => {
  if (!rows.length) return "Add at least one option";
  if (rows.length > 12) return "You can add up to 12 options";

  const seen = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const v = rows[i];
    const key = v.label.toLowerCase();

    if (seen.has(key)) return `"${v.label}" is listed twice`;
    seen.add(key);

    if (v.mrp && v.mrp < v.price)
      return `${v.label}: MRP cannot be below the price`;

    if (v.cost && v.cost > v.price)
      return `${v.label}: cost is above the selling price`;

    if (wholesaleEnabled && v.bulkPricing.length) {
      const slabError = validateSlabs(v.bulkPricing, {
        moq,
        retailPrice: v.price,
      });
      if (slabError) return `${v.label} — ${slabError}`;
    }
  }

  return null;
};

// Exactly one default, and never zero
const normaliseVariantDefault = (rows) => {
  if (!rows.length) return rows;
  const chosen = rows.find((v) => v.isDefault) || rows[0];
  rows.forEach((v) => {
    v.isDefault = v === chosen;
  });
  return rows;
};

// `cost` is the seller's own figure — it must never reach a buyer.
const BUYER_HIDDEN = "-cost";

// The `productUpload` chain in upload.js uses `upload.fields()`, so
// `req.files` arrives as an object: { productPhotos: [file, file, ...] }.
// Both shapes are handled in case it is ever switched to `upload.array()`.
const collectFiles = (reqFiles) => {
  if (!reqFiles) return [];
  if (Array.isArray(reqFiles)) return reqFiles;
  // fields() shape — prefer productPhotos, otherwise take whatever came in
  if (Array.isArray(reqFiles.productPhotos)) return reqFiles.productPhotos;
  return Object.values(reqFiles).flat().filter(Boolean);
};

// Rewrites a raw S3 URL to the CloudFront domain — same helper the business
// form uses. Falls back to the original string if the URL is not an S3 one
// (local disk paths in dev) so nothing breaks either way.
const toCdn = (url) => {
  if (!url) return "";
  try {
    return convertS3UrlToCDN(url) || url;
  } catch (err) {
    console.log("convertS3UrlToCDN skipped:", err?.message);
    return url;
  }
};

// Turns the uploaded files into the schema shape.
// uploadToS3 sets `file.location`, so by this point the URL is ready.
const filesToPhotos = (reqFiles) =>
  collectFiles(reqFiles)
    .map((f) => ({
      url: toCdn(
        f.location || f.url || (f.path ? `/${f.path.replace(/\\/g, "/")}` : ""),
      ),
      caption: "",
    }))
    .filter((p) => p.url);

// Confirm the logged-in user actually owns this vyapar and it's approved.
const assertOwnership = async (vyaparId, userId) => {
  if (!isId(vyaparId)) return { error: [400, "Invalid business id"] };

  const vyapar = await JainVyapar.findById(vyaparId).select(
    "userId applicationStatus businessName status",
  );

  if (!vyapar) return { error: [404, "Business not found"] };

  if (String(vyapar.userId) !== String(userId)) {
    return { error: [403, "You do not own this business"] };
  }

  if (vyapar.applicationStatus !== "approved") {
    return {
      error: [
        403,
        "Your business is not approved yet. Products can be listed once it is approved.",
      ],
    };
  }

  return { vyapar };
};

// ══════════════════════════════════════════════════════════════
// GET /vyapar/products
// Public marketplace listing
// ══════════════════════════════════════════════════════════════
exports.getMarketplaceProducts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 24),
    );
    const skip = (page - 1) * limit;

    const query = {
      isDeleted: false,
      isHidden: false,
      status: "active",
    };

    if (req.query.category && req.query.category !== "All") {
      query.category = req.query.category;
    }

    if (req.query.vyaparId && isId(req.query.vyaparId)) {
      query.vyaparId = req.query.vyaparId;
    }

    if (req.query.inStock === "true") {
      query.stock = { $gt: 0 };
    }

    const min = Number(req.query.minPrice);
    const max = Number(req.query.maxPrice);
    if (!Number.isNaN(min) || !Number.isNaN(max)) {
      query.price = {};
      if (!Number.isNaN(min)) query.price.$gte = min;
      if (!Number.isNaN(max)) query.price.$lte = max;
    }

    const q = (req.query.q || "").trim();
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } },
      ];
    }

    // ✅ Secondary sort on _id keeps pagination stable — without it,
    //    same-value documents shuffle between pages and produce duplicates.
    const sortMap = {
      price_low: { price: 1, _id: 1 },
      price_high: { price: -1, _id: 1 },
      rating: { rating: -1, _id: 1 },
      newest: { createdAt: -1, _id: 1 },
    };
    const sort = sortMap[req.query.sort] || { createdAt: -1, _id: 1 };

    const [products, total] = await Promise.all([
      Product.find(query)
        // ⚠️ `cost` is the seller's private figure — never send it to buyers
        .select(BUYER_HIDDEN)
        .populate(
          "vyaparId",
          "businessName location businessCategory businessLogo",
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    // The frontend reads `p.vyapar.businessName`
    const shaped = products.map((p) => ({
      ...p,
      vyapar: p.vyaparId && typeof p.vyaparId === "object" ? p.vyaparId : null,
      vyaparId:
        p.vyaparId && typeof p.vyaparId === "object"
          ? p.vyaparId._id
          : p.vyaparId,
    }));

    return ok(res, {
      products: shaped,
      total,
      page,
      limit,
      hasMore: skip + shaped.length < total,
    });
  } catch (err) {
    console.error("getMarketplaceProducts error:", err);
    return fail(res, 500, "Could not load products");
  }
};

// ══════════════════════════════════════════════════════════════
// GET /vyapar/products/seller/:vyaparId
// Seller catalog — includes hidden + out-of-stock
// ══════════════════════════════════════════════════════════════
exports.getSellerProducts = async (req, res) => {
  try {
    const { vyaparId } = req.params;
    if (!isId(vyaparId)) return fail(res, 400, "Invalid business id");

    const limit = Math.min(
      300,
      Math.max(1, parseInt(req.query.limit, 10) || 200),
    );

    const products = await Product.find({
      vyaparId,
      isDeleted: false,
    })
      .sort({ createdAt: -1, _id: 1 })
      .limit(limit)
      .lean();

    return ok(res, { products, total: products.length });
  } catch (err) {
    console.error("getSellerProducts error:", err);
    return fail(res, 500, "Could not load catalog");
  }
};

// ══════════════════════════════════════════════════════════════
// GET /vyapar/products/:id
// ══════════════════════════════════════════════════════════════
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isId(id)) return fail(res, 400, "Invalid product id");

    const product = await Product.findOne({ _id: id, isDeleted: false })
      // ⚠️ Buyers never see `cost`
      .select(BUYER_HIDDEN)
      .populate(
        "vyaparId",
        "businessName location businessCategory businessLogo ownerName contactPerson",
      )
      .lean();

    if (!product) return fail(res, 404, "Product not found");

    const shaped = {
      ...product,
      vyapar:
        product.vyaparId && typeof product.vyaparId === "object"
          ? product.vyaparId
          : null,
      vyaparId:
        product.vyaparId && typeof product.vyaparId === "object"
          ? product.vyaparId._id
          : product.vyaparId,
    };

    return ok(res, { product: shaped });
  } catch (err) {
    console.error("getProductById error:", err);
    return fail(res, 500, "Could not load product");
  }
};

// ══════════════════════════════════════════════════════════════
// POST /vyapar/products   (multipart, field name: "photos")
// ══════════════════════════════════════════════════════════════
exports.createProduct = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return fail(res, 401, "Not authenticated");

    const { vyaparId } = req.body;

    const { error } = await assertOwnership(vyaparId, userId);
    if (error) return fail(res, error[0], error[1]);

    const name = (req.body.name || "").trim();
    const category = (req.body.category || "").trim();
    const price = Number(req.body.price);
    const stock = Number(req.body.stock);

    if (!name) return fail(res, 400, "Product name is required");
    if (!category) return fail(res, 400, "Category is required");
    if (!price || price <= 0)
      return fail(res, 400, "Price must be more than 0");
    if (Number.isNaN(stock) || stock < 0)
      return fail(res, 400, "Stock must be 0 or more");

    const mrp = Number(req.body.mrp) || 0;
    if (mrp && mrp < price)
      return fail(res, 400, "MRP cannot be lower than the selling price");

    const photos = filesToPhotos(req.files);
    if (photos.length === 0)
      return fail(res, 400, "At least one product photo is required");

    // ── Extra validation for the new numeric fields ──
    const cost = asNum(req.body.cost);
    if (cost !== undefined && cost > price)
      return fail(res, 400, "Cost cannot be higher than the selling price");

    const moq = asNum(req.body.moq) ?? 1;
    const maxQty = asNum(req.body.maxQty) ?? 0;
    if (maxQty && maxQty < moq)
      return fail(
        res,
        400,
        "Maximum order quantity cannot be below the minimum",
      );

    // ── Wholesale + variants ──
    // Read together, because where the price ladder lives depends on
    // whether variants are on:
    //   variants off → one ladder on the product
    //   variants on  → one ladder per option, product ladder stays empty
    // A 5 kg pack in bulk is not priced like a 1 kg pack, so a shared
    // ladder would silently overwrite every option's price.
    const wholesaleEnabled = asBool(req.body.wholesaleEnabled);
    const allowRetail = asBool(req.body.allowRetail, true);
    const hasVariants = asBool(req.body.hasVariants);

    let bulkPricing = [];
    let variants = [];

    if (hasVariants) {
      variants = parseVariants(req.body.variants) || [];
      // validateVariants checks each option's own ladder
      const vError = validateVariants(variants, { wholesaleEnabled, moq });
      if (vError) return fail(res, 400, vError);
      normaliseVariantDefault(variants);
    } else if (wholesaleEnabled) {
      bulkPricing = parseSlabs(req.body.bulkPricing) || [];
      const slabError = validateSlabs(bulkPricing, {
        moq,
        retailPrice: price,
      });
      if (slabError) return fail(res, 400, slabError);
    }

    const badges = parseList(req.body.badges) || [];
    const highlights = parseList(req.body.highlights) || [];
    const tags = parseList(req.body.tags) || [];
    const specs = parseSpecs(req.body.specs) || [];

    // "Save as draft" arrives as status=inactive + isHidden=true
    const wantsDraft =
      req.body.status === "inactive" || asBool(req.body.isHidden);

    const product = await Product.create({
      vyaparId,
      userId,
      name,
      category,
      description: (req.body.description || "").trim(),
      shortDescription: (req.body.shortDescription || "").trim(),
      brand: (req.body.brand || "").trim(),
      condition: req.body.condition || "New",
      highlights,
      tags,
      specs,
      price,
      mrp,
      cost: cost ?? 0,
      gstRate: asNum(req.body.gstRate) ?? null,
      hsnCode: (req.body.hsnCode || "").trim(),
      taxIncluded: asBool(req.body.taxIncluded, true),
      unit: req.body.unit || "piece",
      stock,
      lowStock: asNum(req.body.lowStock) ?? 0,
      moq,
      maxQty,
      wholesaleEnabled,
      allowRetail,
      bulkPricing,
      hasVariants,
      variantType: (req.body.variantType || "").trim(),
      variants,
      photos,
      // badges[0] mirrors into the legacy single field
      badge: req.body.badge || badges[0] || "",
      badges,
      specialOffer: (req.body.specialOffer || "").trim(),
      shippingMode: req.body.shippingMode === "self" ? "self" : "jaintva",
      codAvailable: String(req.body.codAvailable) !== "false",
      returnDays: Number(req.body.returnDays) || 0,
      warranty: (req.body.warranty || "").trim(),
      status: wantsDraft ? "inactive" : "active",
      isHidden: wantsDraft,
    });

    return res.status(201).json({
      success: true,
      message: product.isHidden
        ? "Product saved as draft"
        : "Product published",
      data: { product },
    });
  } catch (err) {
    console.error("createProduct error:", err);
    return fail(res, 500, "Could not save the product");
  }
};

// ══════════════════════════════════════════════════════════════
// PATCH /vyapar/products/:id
// Stock / visibility / details. Photos optional (multipart).
// ══════════════════════════════════════════════════════════════
exports.updateProduct = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    if (!isId(id)) return fail(res, 400, "Invalid product id");

    const product = await Product.findOne({ _id: id, isDeleted: false });
    if (!product) return fail(res, 404, "Product not found");

    if (String(product.userId) !== String(userId)) {
      return fail(res, 403, "You cannot edit this product");
    }

    const b = req.body || {};

    // ── Scalar fields ──
    if (b.name !== undefined) product.name = String(b.name).trim();
    if (b.category !== undefined) product.category = String(b.category).trim();
    if (b.description !== undefined)
      product.description = String(b.description).trim();
    if (b.unit !== undefined) product.unit = b.unit;
    if (b.badge !== undefined) product.badge = b.badge;
    if (b.specialOffer !== undefined)
      product.specialOffer = String(b.specialOffer).trim();

    // ── New text fields ──
    if (b.shortDescription !== undefined)
      product.shortDescription = String(b.shortDescription).trim();
    if (b.brand !== undefined) product.brand = String(b.brand).trim();
    if (b.condition !== undefined) product.condition = b.condition;
    if (b.hsnCode !== undefined) product.hsnCode = String(b.hsnCode).trim();
    if (b.warranty !== undefined) product.warranty = String(b.warranty).trim();

    // ── Lists. Sent as JSON strings; an empty array clears them. ──
    if (b.highlights !== undefined) {
      const v = parseList(b.highlights);
      if (v) product.highlights = v;
    }
    if (b.tags !== undefined) {
      const v = parseList(b.tags);
      if (v) product.tags = v;
    }
    if (b.badges !== undefined) {
      const v = parseList(b.badges);
      if (v) {
        product.badges = v;
        // Keep the legacy single field in step unless it was sent explicitly
        if (b.badge === undefined) product.badge = v[0] || "";
      }
    }
    if (b.specs !== undefined) {
      const v = parseSpecs(b.specs);
      if (v) product.specs = v;
    }

    // ── Tax ──
    if (b.gstRate !== undefined) {
      const v = asNum(b.gstRate);
      product.gstRate = v === undefined ? null : v;
    }
    if (b.taxIncluded !== undefined)
      product.taxIncluded = asBool(b.taxIncluded, true);

    if (b.price !== undefined) {
      const price = Number(b.price);
      if (!price || price <= 0)
        return fail(res, 400, "Price must be more than 0");
      product.price = price;
    }

    if (b.mrp !== undefined) {
      const mrp = Number(b.mrp) || 0;
      if (mrp && mrp < product.price)
        return fail(res, 400, "MRP cannot be lower than the selling price");
      product.mrp = mrp;
    }

    if (b.stock !== undefined) {
      const stock = Number(b.stock);
      if (Number.isNaN(stock) || stock < 0)
        return fail(res, 400, "Stock must be 0 or more");
      product.stock = stock;
    }

    // ── Cost must stay at or below the selling price ──
    if (b.cost !== undefined) {
      const cost = asNum(b.cost) ?? 0;
      if (cost > product.price)
        return fail(res, 400, "Cost cannot be higher than the selling price");
      product.cost = cost;
    }

    // ── Wholesale ──
    if (b.wholesaleEnabled !== undefined)
      product.wholesaleEnabled = asBool(b.wholesaleEnabled);
    if (b.allowRetail !== undefined)
      product.allowRetail = asBool(b.allowRetail, true);

    if (b.bulkPricing !== undefined) {
      const rows = parseSlabs(b.bulkPricing);
      if (rows) product.bulkPricing = rows;
    }

    // ── Variants ──
    if (b.hasVariants !== undefined)
      product.hasVariants = asBool(b.hasVariants);
    if (b.variantType !== undefined)
      product.variantType = String(b.variantType).trim();

    if (b.variants !== undefined) {
      const rows = parseVariants(b.variants);
      if (rows) product.variants = normaliseVariantDefault(rows);
    }

    // ── Order limits ──
    if (b.lowStock !== undefined) product.lowStock = asNum(b.lowStock) ?? 0;
    if (b.moq !== undefined) product.moq = Math.max(1, asNum(b.moq) ?? 1);
    if (b.maxQty !== undefined) product.maxQty = asNum(b.maxQty) ?? 0;

    if (product.maxQty && product.maxQty < product.moq)
      return fail(
        res,
        400,
        "Maximum order quantity cannot be below the minimum",
      );

    // Same reasoning as the slab re-check below — a price edit can make a
    // variant's own ladder invalid.
    if (product.hasVariants) {
      const vError = validateVariants(
        (product.variants || []).map((v) =>
          typeof v.toObject === "function" ? v.toObject() : v,
        ),
        { wholesaleEnabled: product.wholesaleEnabled, moq: product.moq },
      );
      if (vError) return fail(res, 400, vError);
    }

    // Editing the retail price or the MOQ can invalidate a ladder that was
    // fine when it was saved, so it is checked again on every update.
    // Skipped when variants are on — their ladders were just checked
    // above, and the product-level array is empty by design.
    if (product.wholesaleEnabled && !product.hasVariants) {
      const slabError = validateSlabs(product.bulkPricing || [], {
        moq: product.moq,
        retailPrice: product.price,
      });
      if (slabError) return fail(res, 400, slabError);
    }

    // Switching variants on leaves a stale product ladder behind that
    // would undercut every option on the buyer's side.
    if (product.hasVariants && (product.bulkPricing || []).length) {
      product.bulkPricing = [];
    }

    if (b.isHidden !== undefined)
      product.isHidden = b.isHidden === true || b.isHidden === "true";

    if (b.shippingMode !== undefined)
      product.shippingMode = b.shippingMode === "self" ? "self" : "jaintva";

    if (b.codAvailable !== undefined)
      product.codAvailable =
        b.codAvailable === true || b.codAvailable === "true";

    if (b.returnDays !== undefined)
      product.returnDays = Number(b.returnDays) || 0;

    // ── Photos: append any new files, never drop the existing ones ──
    const incoming = filesToPhotos(req.files);
    if (incoming.length) {
      product.photos = [...(product.photos || []), ...incoming].slice(0, 6);
    }

    await product.save();

    return ok(res, { product }, "Product updated");
  } catch (err) {
    console.error("updateProduct error:", err);
    return fail(res, 500, "Could not update the product");
  }
};

// ══════════════════════════════════════════════════════════════
// DELETE /vyapar/products/:id   (soft delete)
// ══════════════════════════════════════════════════════════════
exports.deleteProduct = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    if (!isId(id)) return fail(res, 400, "Invalid product id");

    const product = await Product.findOne({ _id: id, isDeleted: false });
    if (!product) return fail(res, 404, "Product not found");

    if (String(product.userId) !== String(userId)) {
      return fail(res, 403, "You cannot delete this product");
    }

    // Soft delete — the item snapshot survives on past orders
    product.isDeleted = true;
    product.isHidden = true;
    await product.save();

    return ok(res, { productId: id }, "Product deleted");
  } catch (err) {
    console.error("deleteProduct error:", err);
    return fail(res, 500, "Could not delete the product");
  }
};

// ══════════════════════════════════════════════════════════════
// DELETE /vyapar/products/:id/photo/:index
// ══════════════════════════════════════════════════════════════
exports.deleteProductPhoto = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id, index } = req.params;

    if (!isId(id)) return fail(res, 400, "Invalid product id");

    const product = await Product.findOne({ _id: id, isDeleted: false });
    if (!product) return fail(res, 404, "Product not found");

    if (String(product.userId) !== String(userId)) {
      return fail(res, 403, "You cannot edit this product");
    }

    const i = parseInt(index, 10);
    if (Number.isNaN(i) || i < 0 || i >= (product.photos || []).length) {
      return fail(res, 400, "Photo not found");
    }

    if (product.photos.length <= 1) {
      return fail(res, 400, "A product needs at least one photo");
    }

    product.photos.splice(i, 1);
    await product.save();

    return ok(res, { product }, "Photo removed");
  } catch (err) {
    console.error("deleteProductPhoto error:", err);
    return fail(res, 500, "Could not remove the photo");
  }
};
