const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Cart = require("../../model/VyaparModels/Cartmodel");
const Wishlist = require("../../model/VyaparModels/Wishlistmodel");
const VyaparProduct = require("../../model/VyaparModels/Productmodel");

// ══════════════════════════════════════════════════════════
// Small helper — populate query for cart items
// ══════════════════════════════════════════════════════════
const CART_POPULATE = {
  path: "items.productId",
  select:
    "name category price mrp stock unit photos badge status isDeleted vyaparId",
  populate: {
    path: "vyaparId",
    select: "businessName businessCode businessLogo location",
  },
};

// ══════════════════════════════════════════════════════════
// Enrich cart response — add computed totals + availability
// ══════════════════════════════════════════════════════════
const buildCartResponse = (cart) => {
  if (!cart) {
    return {
      _id: null,
      items: [],
      totals: { subtotal: 0, totalMrp: 0, discount: 0, itemCount: 0 },
    };
  }

  let subtotal = 0;
  let totalMrp = 0;
  let itemCount = 0;

  const items = (cart.items || []).map((item) => {
    const p = item.productId; // populated OR null (if deleted)
    const isAvailable = !!p && !p.isDeleted && p.status === "active";
    const livePrice = p?.price ?? item.priceAtAddTime;
    const liveMrp = p?.mrp ?? item.mrpAtAddTime;
    const priceChanged = p && p.price !== item.priceAtAddTime;

    subtotal += item.priceAtAddTime * item.qty;
    totalMrp += (item.mrpAtAddTime || item.priceAtAddTime) * item.qty;
    itemCount += item.qty;

    return {
      _id: item._id,
      productId: p?._id || null,
      qty: item.qty,
      priceAtAddTime: item.priceAtAddTime,
      mrpAtAddTime: item.mrpAtAddTime,
      addedAt: item.addedAt,
      isAvailable,
      priceChanged,
      livePrice,
      liveMrp,
      // Merged view — live data if available, else snapshot
      name: p?.name || item.snapshot?.name || "",
      photo: p?.photos?.[0] || item.snapshot?.photo || "",
      category: p?.category || item.snapshot?.category || "",
      unit: p?.unit || item.snapshot?.unit || "piece",
      stock: p?.stock ?? null,
      badge: p?.badge || "",
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
    _id: cart._id,
    items,
    totals: {
      subtotal,
      totalMrp,
      discount: Math.max(0, totalMrp - subtotal),
      itemCount,
    },
    updatedAt: cart.updatedAt,
  };
};

// ══════════════════════════════════════════════════════════
// @desc    Add product to cart (increments qty if exists)
// @route   POST /api/cart/add
// @access  Private
// @body    { productId, qty (default 1) }
// ══════════════════════════════════════════════════════════
const addToCart = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    const { productId, qty = 1 } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid productId required" });
    }

    const qtyNum = Math.max(1, Math.min(99, parseInt(qty) || 1));

    // Fetch product to validate + snapshot
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
        message: "This product is not available for purchase",
      });
    }
    // Stock check (if stock is tracked)
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

    // Find or create cart
    let cart = await Cart.findOne({ userId });
    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }

    // Check if product already in cart
    const existingIdx = cart.items.findIndex(
      (item) => String(item.productId) === String(productId),
    );

    if (existingIdx >= 0) {
      // Increment qty — respect stock limit
      const newQty = cart.items[existingIdx].qty + qtyNum;
      if (
        product.stock !== null &&
        product.stock !== undefined &&
        newQty > product.stock
      ) {
        return res.status(400).json({
          success: false,
          message: `Cannot add more — only ${product.stock} in stock (you have ${cart.items[existingIdx].qty} in cart)`,
        });
      }
      cart.items[existingIdx].qty = Math.min(99, newQty);
    } else {
      // Push new line item with snapshot
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
    // Re-fetch with populate for response
    const populated = await Cart.findById(cart._id).populate(CART_POPULATE);

    return res.status(200).json({
      success: true,
      message: "Added to cart",
      data: buildCartResponse(populated),
    });
  } catch (error) {
    console.error("❌ addToCart error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while adding to cart",
      error: error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Get my cart (populated + enriched)
// @route   GET /api/cart
// @access  Private
// ══════════════════════════════════════════════════════════
const getMyCart = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const cart = await Cart.findOne({ userId }).populate(CART_POPULATE);
    return res.status(200).json({
      success: true,
      message: "Cart fetched",
      data: buildCartResponse(cart),
    });
  } catch (error) {
    console.error("❌ getMyCart error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Update qty of an item in cart
// @route   PATCH /api/cart/item/:productId
// @access  Private
// @body    { qty }   (if qty <= 0 → item is removed)
// ══════════════════════════════════════════════════════════
const updateCartItemQty = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    const { productId } = req.params;
    const { qty } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid productId" });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    const idx = cart.items.findIndex(
      (item) => String(item.productId) === String(productId),
    );
    if (idx < 0) {
      return res
        .status(404)
        .json({ success: false, message: "Item not in cart" });
    }

    const newQty = parseInt(qty);
    if (isNaN(newQty)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid qty required" });
    }

    if (newQty <= 0) {
      // Remove item
      cart.items.splice(idx, 1);
    } else {
      // Validate against stock
      const product = await VyaparProduct.findById(productId).select(
        "stock status isDeleted",
      );
      if (
        product &&
        product.stock !== null &&
        product.stock !== undefined &&
        newQty > product.stock
      ) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} in stock`,
        });
      }
      cart.items[idx].qty = Math.min(99, newQty);
    }

    await cart.save();
    const populated = await Cart.findById(cart._id).populate(CART_POPULATE);
    return res.status(200).json({
      success: true,
      message: newQty <= 0 ? "Item removed" : "Quantity updated",
      data: buildCartResponse(populated),
    });
  } catch (error) {
    console.error("❌ updateCartItemQty error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Remove single item from cart
// @route   DELETE /api/cart/item/:productId
// @access  Private
// ══════════════════════════════════════════════════════════
const removeCartItem = asyncHandler(async (req, res) => {
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

    const cart = await Cart.findOneAndUpdate(
      { userId },
      { $pull: { items: { productId } } },
      { new: true },
    ).populate(CART_POPULATE);

    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Item removed from cart",
      data: buildCartResponse(cart),
    });
  } catch (error) {
    console.error("❌ removeCartItem error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Clear entire cart
// @route   DELETE /api/cart/clear
// @access  Private
// ══════════════════════════════════════════════════════════
const clearCart = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const cart = await Cart.findOneAndUpdate(
      { userId },
      { $set: { items: [] } },
      { new: true, upsert: false },
    );

    return res.status(200).json({
      success: true,
      message: "Cart cleared",
      data: buildCartResponse(cart),
    });
  } catch (error) {
    console.error("❌ clearCart error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Get cart item count (for header badge)
// @route   GET /api/cart/count
// @access  Private
// ══════════════════════════════════════════════════════════
const getCartCount = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const cart = await Cart.findOne({ userId }).select("items.qty");
    const count = cart ? cart.items.reduce((s, it) => s + (it.qty || 0), 0) : 0;
    return res.status(200).json({
      success: true,
      data: { count, uniqueItems: cart?.items?.length || 0 },
    });
  } catch (error) {
    console.error("❌ getCartCount error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

// ══════════════════════════════════════════════════════════
// @desc    Move a cart item to wishlist
// @route   POST /api/cart/move-to-wishlist/:productId
// @access  Private
// ══════════════════════════════════════════════════════════
const moveCartItemToWishlist = asyncHandler(async (req, res) => {
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

    // Get cart + find item
    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }
    const idx = cart.items.findIndex(
      (item) => String(item.productId) === String(productId),
    );
    if (idx < 0) {
      return res
        .status(404)
        .json({ success: false, message: "Item not in cart" });
    }
    const cartItem = cart.items[idx];

    // Add to wishlist (if not already there)
    let wishlist = await Wishlist.findOne({ userId });
    if (!wishlist) {
      wishlist = new Wishlist({ userId, items: [] });
    }
    const alreadyInWishlist = wishlist.items.some(
      (w) => String(w.productId) === String(productId),
    );
    if (!alreadyInWishlist) {
      wishlist.items.unshift({
        productId,
        vyaparId: cartItem.vyaparId,
        snapshot: {
          name: cartItem.snapshot?.name,
          photo: cartItem.snapshot?.photo,
          category: cartItem.snapshot?.category,
          price: cartItem.priceAtAddTime,
          mrp: cartItem.mrpAtAddTime,
        },
        addedAt: new Date(),
      });
      await wishlist.save();
    }

    // Remove from cart
    cart.items.splice(idx, 1);
    await cart.save();

    const populated = await Cart.findById(cart._id).populate(CART_POPULATE);
    return res.status(200).json({
      success: true,
      message: alreadyInWishlist
        ? "Removed from cart (already in wishlist)"
        : "Moved to wishlist",
      data: buildCartResponse(populated),
    });
  } catch (error) {
    console.error("❌ moveCartItemToWishlist error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

module.exports = {
  addToCart,
  getMyCart,
  updateCartItemQty,
  removeCartItem,
  clearCart,
  getCartCount,
  moveCartItemToWishlist,
};
