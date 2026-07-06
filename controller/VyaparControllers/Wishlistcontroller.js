const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Wishlist = require("../../model/VyaparModels/Wishlistmodel");
const Cart = require("../../model/VyaparModels/Cartmodel");
const VyaparProduct = require("../../model/VyaparModels/Productmodel");

// ══════════════════════════════════════════════════════════
// Populate query for wishlist items
// ══════════════════════════════════════════════════════════
const WISHLIST_POPULATE = {
  path: "items.productId",
  select:
    "name category price mrp stock unit photos badge status isDeleted vyaparId",
  populate: {
    path: "vyaparId",
    select: "businessName businessCode businessLogo location",
  },
};

// ══════════════════════════════════════════════════════════
// Enrich wishlist response with computed fields
// ══════════════════════════════════════════════════════════
const buildWishlistResponse = (wishlist) => {
  if (!wishlist) {
    return { _id: null, items: [], count: 0 };
  }

  const items = (wishlist.items || []).map((item) => {
    const p = item.productId; // populated OR null
    const isAvailable = !!p && !p.isDeleted && p.status === "active";

    return {
      _id: item._id,
      productId: p?._id || null,
      addedAt: item.addedAt,
      isAvailable,
      // Merged view — live if available, else snapshot
      name: p?.name || item.snapshot?.name || "",
      photo: p?.photos?.[0] || item.snapshot?.photo || "",
      category: p?.category || item.snapshot?.category || "",
      price: p?.price ?? item.snapshot?.price ?? 0,
      mrp: p?.mrp ?? item.snapshot?.mrp ?? 0,
      stock: p?.stock ?? null,
      badge: p?.badge || "",
      status: p?.status || "unavailable",
      unit: p?.unit || "piece",
      vyapar: p?.vyaparId
        ? {
            _id: p.vyaparId._id,
            businessName: p.vyaparId.businessName,
            businessLogo: p.vyaparId.businessLogo,
          }
        : null,
    };
  });

  return {
    _id: wishlist._id,
    items,
    count: items.length,
    updatedAt: wishlist.updatedAt,
  };
};

// ══════════════════════════════════════════════════════════
// @desc    Toggle wishlist — add if absent, remove if present
// @route   POST /api/wishlist/toggle/:productId
// @access  Private
// ══════════════════════════════════════════════════════════
const toggleWishlistItem = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    const { productId } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid productId" });
    }

    // Find or create wishlist
    let wishlist = await Wishlist.findOne({ userId });
    if (!wishlist) {
      wishlist = new Wishlist({ userId, items: [] });
    }

    const idx = wishlist.items.findIndex(
      (item) => String(item.productId) === String(productId),
    );

    let action;
    if (idx >= 0) {
      // Remove
      wishlist.items.splice(idx, 1);
      action = "removed";
    } else {
      // Add — fetch product for snapshot
      const product = await VyaparProduct.findOne({
        _id: productId,
        isDeleted: false,
      });
      if (!product) {
        return res
          .status(404)
          .json({ success: false, message: "Product not found" });
      }
      wishlist.items.unshift({
        productId: product._id,
        vyaparId: product.vyaparId,
        snapshot: {
          name: product.name,
          photo: product.photos?.[0] || "",
          category: product.category,
          price: product.price,
          mrp: product.mrp || 0,
        },
        addedAt: new Date(),
      });
      action = "added";
    }

    await wishlist.save();
    const populated = await Wishlist.findById(wishlist._id).populate(
      WISHLIST_POPULATE,
    );

    return res.status(200).json({
      success: true,
      message:
        action === "added" ? "Added to wishlist" : "Removed from wishlist",
      action, // "added" | "removed"
      inWishlist: action === "added",
      data: buildWishlistResponse(populated),
    });
  } catch (error) {
    console.error("❌ toggleWishlistItem error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Get my wishlist
// @route   GET /api/wishlist
// @access  Private
// ══════════════════════════════════════════════════════════
const getMyWishlist = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const wishlist = await Wishlist.findOne({ userId }).populate(
      WISHLIST_POPULATE,
    );
    return res.status(200).json({
      success: true,
      message: "Wishlist fetched",
      data: buildWishlistResponse(wishlist),
    });
  } catch (error) {
    console.error("❌ getMyWishlist error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Remove single item from wishlist
// @route   DELETE /api/wishlist/item/:productId
// @access  Private
// ══════════════════════════════════════════════════════════
const removeWishlistItem = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    const { productId } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid productId" });
    }

    const wishlist = await Wishlist.findOneAndUpdate(
      { userId },
      { $pull: { items: { productId } } },
      { new: true },
    ).populate(WISHLIST_POPULATE);

    if (!wishlist) {
      return res
        .status(404)
        .json({ success: false, message: "Wishlist not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Removed from wishlist",
      data: buildWishlistResponse(wishlist),
    });
  } catch (error) {
    console.error("❌ removeWishlistItem error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Clear entire wishlist
// @route   DELETE /api/wishlist/clear
// @access  Private
// ══════════════════════════════════════════════════════════
const clearWishlist = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const wishlist = await Wishlist.findOneAndUpdate(
      { userId },
      { $set: { items: [] } },
      { new: true, upsert: false },
    );

    return res.status(200).json({
      success: true,
      message: "Wishlist cleared",
      data: buildWishlistResponse(wishlist),
    });
  } catch (error) {
    console.error("❌ clearWishlist error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Get wishlist item count (for header badge)
// @route   GET /api/wishlist/count
// @access  Private
// ══════════════════════════════════════════════════════════
const getWishlistCount = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const wishlist = await Wishlist.findOne({ userId }).select("items._id");
    const count = wishlist?.items?.length || 0;
    return res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    console.error("❌ getWishlistCount error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Move a wishlist item to cart
// @route   POST /api/wishlist/move-to-cart/:productId
// @access  Private
// ══════════════════════════════════════════════════════════
const moveWishlistItemToCart = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    const { productId } = req.params;
    const { qty = 1 } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid productId" });
    }

    // Validate product available
    const product = await VyaparProduct.findOne({
      _id: productId,
      isDeleted: false,
    });
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }
    if (product.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "Product is not available",
      });
    }
    const qtyNum = Math.max(1, Math.min(99, parseInt(qty) || 1));
    if (
      product.stock !== null &&
      product.stock !== undefined &&
      product.stock < qtyNum
    ) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} in stock`,
      });
    }

    // Remove from wishlist
    const wishlist = await Wishlist.findOneAndUpdate(
      { userId },
      { $pull: { items: { productId } } },
      { new: true },
    );

    // Add to cart
    let cart = await Cart.findOne({ userId });
    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }
    const existingIdx = cart.items.findIndex(
      (item) => String(item.productId) === String(productId),
    );
    if (existingIdx >= 0) {
      cart.items[existingIdx].qty = Math.min(
        99,
        cart.items[existingIdx].qty + qtyNum,
      );
    } else {
      cart.items.push({
        productId: product._id,
        vyaparId: product.vyaparId,
        qty: qtyNum,
        priceAtAddTime: product.price,
        mrpAtAddTime: product.mrp || 0,
        snapshot: {
          name: product.name,
          photo: product.photos?.[0] || "",
          category: product.category,
          unit: product.unit || "piece",
        },
        addedAt: new Date(),
      });
    }
    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Moved to cart",
      data: {
        wishlist: buildWishlistResponse(wishlist),
        cartItemCount: cart.items.reduce((s, it) => s + (it.qty || 0), 0),
      },
    });
  } catch (error) {
    console.error("❌ moveWishlistItemToCart error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

module.exports = {
  toggleWishlistItem,
  getMyWishlist,
  removeWishlistItem,
  clearWishlist,
  getWishlistCount,
  moveWishlistItemToCart,
};
