const mongoose = require("mongoose");
const Cart = require("../../model/VyaparModels/Cartmodel");
const Wishlist = require("../../model/VyaparModels/Wishlistmodel");
const Product = require("../../model/VyaparModels/Productmodel");

const ok = (res, data, message = "Success") =>
  res.status(200).json({ success: true, message, data });

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));

// Reshapes the cart into what the frontend expects.
// The frontend reads: it.productId, it.name, it.photo, it.price, it.qty,
//                     it.unit, it.stock, it.category, it.vyapar, it.vyaparId
// ── Variants and bulk pricing ─────────────────────────────────
// The cart used to read product.price and product.stock directly. With
// variants those live on the chosen option instead, and with wholesale
// the price depends on how many are being bought. Everything below
// resolves one line item to the price and stock that actually apply.

const findVariant = (product, variantId) => {
  if (!product?.hasVariants || !product.variants?.length) return null;
  if (!variantId) {
    return product.variants.find((v) => v.isDefault) || product.variants[0];
  }
  return (
    product.variants.find((v) => String(v._id) === String(variantId)) || null
  );
};

// Slabs live on the variant when there are variants, on the product
// otherwise. A product-level ladder is ignored once variants exist —
// it was priced against the anchor price and would undercut every option.
const slabsFor = (product, variant) => {
  if (!product?.wholesaleEnabled) return [];
  const rows = product.hasVariants
    ? variant?.bulkPricing || []
    : product.bulkPricing || [];
  return [...rows].sort((a, b) => a.minQty - b.minQty);
};

// The unit price for this quantity of this option
const unitPriceFor = (product, variant, qty) => {
  const base = Number(variant?.price ?? product?.price ?? 0);
  const q = Number(qty) || 0;
  const slab = slabsFor(product, variant).find(
    (s) => q >= s.minQty && (!s.maxQty || q <= s.maxQty),
  );
  return slab ? Number(slab.price) : base;
};

const stockFor = (product, variant) =>
  Number(variant ? (variant.stock ?? 0) : (product?.stock ?? 0));

// A wholesale-only seller sets allowRetail false, and then nobody may
// order fewer than the minimum.
const minQtyFor = (product) => {
  if (product?.wholesaleEnabled && product.allowRetail === false) {
    return Math.max(1, Number(product.moq) || 1);
  }
  return 1;
};

const maxQtyFor = (product) => Number(product?.maxQty) || 0;

// Two lines are the same line only if the option matches too — otherwise
// 500 g and 5 kg would merge and share one price.
const sameLine = (item, productId, variantId) =>
  String(item.productId?._id || item.productId) === String(productId) &&
  String(item.variantId || "") === String(variantId || "");

const shapeCart = (cart) => {
  const items = (cart?.items || [])
    .filter((i) => i.productId) // skip if populate failed
    .map((i) => {
      const p = i.productId;
      const isPopulated = p && typeof p === "object" && p.name;

      if (!isPopulated) return null;

      const variant = findVariant(p, i.variantId);
      // The option was removed by the seller after it was added
      const variantGone = p.hasVariants && i.variantId && !variant;

      const stock = variantGone ? 0 : stockFor(p, variant);
      const price = unitPriceFor(p, variant, i.qty);
      const listPrice = Number(variant?.price ?? p.price ?? 0);
      const mrp = Number(variant?.mrp ?? p.mrp ?? 0);

      const slabs = slabsFor(p, variant);
      const nextSlab = slabs.find((s) => s.minQty > i.qty);

      return {
        id: String(i._id),
        subId: String(i._id),
        productId: String(p._id),
        name: p.name,
        photo: p.photos?.[0]?.url || "",
        category: p.category,
        unit: p.unit,
        stock,
        // Show the live price, but send the add-time price too so the
        // frontend can flag "price changed".
        price,
        mrp,
        priceAtAddTime: i.priceAtAddTime,
        mrpAtAddTime: i.mrpAtAddTime,
        qty: i.qty,

        // ── Variant ──
        variantId: i.variantId ? String(i.variantId) : null,
        // Snapshot first — it survives the option being renamed
        variantLabel: i.variantLabel || variant?.label || "",
        variantType: p.variantType || "",
        variantGone,

        // ── Wholesale ──
        // listPrice is what one unit costs; price is what this quantity
        // costs each. They differ once a slab kicks in.
        listPrice,
        bulkApplied: price < listPrice,
        bulkSaving: Math.max(0, (listPrice - price) * i.qty),
        // Nudge: "add 4 more for ₹74 each"
        nextSlab: nextSlab
          ? { minQty: nextSlab.minQty, price: nextSlab.price }
          : null,
        minQty: minQtyFor(p),
        maxQty: maxQtyFor(p),

        vyaparId: String(i.vyaparId),
        vyapar:
          p.vyaparId && typeof p.vyaparId === "object" ? p.vyaparId : null,
        isAvailable: !p.isDeleted && !p.isHidden && stock > 0 && !variantGone,
      };
    })
    .filter(Boolean);

  const subtotal = items.reduce(
    (sum, i) => sum + Number(i.price || 0) * Number(i.qty || 0),
    0,
  );
  const savings = items.reduce((sum, i) => {
    const mrp = Number(i.mrp || 0);
    const price = Number(i.price || 0);
    return sum + (mrp > price ? (mrp - price) * Number(i.qty || 0) : 0);
  }, 0);

  return {
    items,
    count: items.reduce((sum, i) => sum + Number(i.qty || 0), 0),
    subtotal,
    savings,
  };
};

const populateCart = (query) =>
  query.populate({
    path: "items.productId",
    select:
      "name photos category unit stock price mrp isDeleted isHidden vyaparId " +
      // Needed to resolve which option was bought and what it costs at
      // this quantity — without these the cart falls back to the
      // product-level price and quietly charges the wrong amount.
      "hasVariants variantType variants wholesaleEnabled allowRetail " +
      "bulkPricing moq maxQty",
    populate: {
      path: "vyaparId",
      select: "businessName location",
    },
  });

// ══════════════════════════════════════════════════════════════
// GET /cart
// ══════════════════════════════════════════════════════════════
exports.getCart = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return fail(res, 401, "Not authenticated");

    const cart = await populateCart(Cart.findOne({ userId }));

    if (!cart) return ok(res, { items: [], count: 0, subtotal: 0, savings: 0 });

    return ok(res, shapeCart(cart));
  } catch (err) {
    console.error("getCart error:", err);
    return fail(res, 500, "Could not load the cart");
  }
};

// ══════════════════════════════════════════════════════════════
// POST /cart/add   { productId, qty }
// ══════════════════════════════════════════════════════════════
exports.addToCart = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return fail(res, 401, "Not authenticated");

    const { productId, variantId } = req.body;
    const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);

    if (!isId(productId)) return fail(res, 400, "Invalid product id");
    if (variantId && !isId(variantId))
      return fail(res, 400, "Invalid option id");

    const product = await Product.findOne({
      _id: productId,
      isDeleted: false,
      isHidden: false,
      status: "active",
    });

    if (!product) return fail(res, 404, "Product is no longer available");

    // ── Resolve the option ──
    const variant = findVariant(product, variantId);

    if (product.hasVariants && product.variants?.length) {
      if (!variant)
        return fail(res, 400, "Choose an option before adding to the cart");
    }

    const available = stockFor(product, variant);
    if (available <= 0) {
      return fail(
        res,
        400,
        variant
          ? `${variant.label} is out of stock`
          : "This product is out of stock",
      );
    }

    // A seller shouldn't be able to buy their own product
    if (String(product.userId) === String(userId)) {
      return fail(res, 400, "You cannot buy your own product");
    }

    let cart = await Cart.findOne({ userId });
    if (!cart) cart = new Cart({ userId, items: [] });

    // ⚠️ Matched on the option too. Without this, adding 5 kg to a cart
    //    that already holds 1 kg would bump the 1 kg line instead.
    const existing = cart.items.find((i) =>
      sameLine(i, productId, variant?._id),
    );

    const currentQty = existing ? existing.qty : 0;
    let nextQty = currentQty + qty;

    // Wholesale-only sellers refuse anything below their minimum
    const min = minQtyFor(product);
    if (nextQty < min) {
      // A first add is rounded up rather than rejected — the buyer asked
      // for this product, and the seller's floor is not their mistake.
      if (!existing) nextQty = min;
      else
        return fail(
          res,
          400,
          `This seller's minimum order is ${min} ${product.unit || "units"}`,
        );
    }

    const max = maxQtyFor(product);
    if (max && nextQty > max) {
      return fail(res, 400, `You can order at most ${max} of this product`);
    }

    if (nextQty > available) {
      return fail(
        res,
        400,
        variant
          ? `Only ${available} of ${variant.label} left`
          : `Only ${available} left in stock`,
      );
    }

    // Locked at the quantity being bought, so a slab price is honoured
    const unitPrice = unitPriceFor(product, variant, nextQty);
    const listMrp = Number(variant?.mrp ?? product.mrp ?? 0);

    if (existing) {
      existing.qty = nextQty;
      existing.priceAtAddTime = unitPrice;
      existing.mrpAtAddTime = listMrp;
      // Refresh the label in case the seller renamed the option
      if (variant) existing.variantLabel = variant.label;
    } else {
      cart.items.push({
        productId: product._id,
        vyaparId: product.vyaparId,
        variantId: variant?._id || null,
        variantLabel: variant?.label || "",
        qty: nextQty,
        priceAtAddTime: unitPrice,
        mrpAtAddTime: listMrp,
      });
    }

    await cart.save();

    const fresh = await populateCart(Cart.findOne({ userId }));
    return ok(res, shapeCart(fresh), "Added to cart");
  } catch (err) {
    console.error("addToCart error:", err);
    return fail(res, 500, "Could not add to cart");
  }
};

// ══════════════════════════════════════════════════════════════
// PATCH /cart/item/:productId   { qty }
// ══════════════════════════════════════════════════════════════
exports.updateCartItem = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { productId } = req.params;
    const qty = parseInt(req.body.qty, 10);

    if (!isId(productId)) return fail(res, 400, "Invalid product id");
    if (Number.isNaN(qty) || qty < 0)
      return fail(res, 400, "Quantity must be 0 or more");

    const cart = await Cart.findOne({ userId });
    if (!cart) return fail(res, 404, "Cart is empty");

    const item = cart.items.find(
      (i) => String(i.productId) === String(productId),
    );
    if (!item) return fail(res, 404, "Item not in cart");

    if (qty === 0) {
      cart.items = cart.items.filter(
        (i) => String(i.productId) !== String(productId),
      );
    } else {
      const product = await Product.findById(productId).select("stock");
      if (product && qty > product.stock) {
        return fail(res, 400, `Only ${product.stock} left in stock`);
      }
      item.qty = qty;
    }

    await cart.save();

    const fresh = await populateCart(Cart.findOne({ userId }));
    return ok(res, shapeCart(fresh), "Cart updated");
  } catch (err) {
    console.error("updateCartItem error:", err);
    return fail(res, 500, "Could not update the cart");
  }
};

// ══════════════════════════════════════════════════════════════
// DELETE /cart/item/:productId
// ══════════════════════════════════════════════════════════════
exports.removeCartItem = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { productId } = req.params;

    if (!isId(productId)) return fail(res, 400, "Invalid product id");

    const cart = await Cart.findOne({ userId });
    if (!cart) return fail(res, 404, "Cart is empty");

    const before = cart.items.length;
    // Two options of one product are two lines, so remove the line the
    // client named rather than every line sharing the product.
    const line = findLine(cart, productId);
    cart.items = line
      ? cart.items.filter((i) => String(i._id) !== String(line._id))
      : cart.items.filter((i) => String(i.productId) !== String(productId));

    if (cart.items.length === before) return fail(res, 404, "Item not in cart");

    await cart.save();

    const fresh = await populateCart(Cart.findOne({ userId }));
    return ok(res, shapeCart(fresh), "Item removed");
  } catch (err) {
    console.error("removeCartItem error:", err);
    return fail(res, 500, "Could not remove the item");
  }
};

// ══════════════════════════════════════════════════════════════
// DELETE /cart/clear
// ══════════════════════════════════════════════════════════════
exports.clearCart = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    await Cart.findOneAndUpdate({ userId }, { $set: { items: [] } });

    return ok(
      res,
      { items: [], count: 0, subtotal: 0, savings: 0 },
      "Cart cleared",
    );
  } catch (err) {
    console.error("clearCart error:", err);
    return fail(res, 500, "Could not clear the cart");
  }
};

// ══════════════════════════════════════════════════════════════
// GET /wishlist
// ══════════════════════════════════════════════════════════════
exports.getWishlist = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return fail(res, 401, "Not authenticated");

    const wl = await Wishlist.findOne({ userId }).populate({
      path: "items.productId",
      select:
        "name photos category price mrp stock unit rating reviews vyaparId isDeleted isHidden",
      populate: { path: "vyaparId", select: "businessName location" },
    });

    if (!wl) return ok(res, { items: [] });

    const items = (wl.items || [])
      .filter((i) => i.productId && !i.productId.isDeleted)
      .map((i) => ({
        ...i.productId.toObject(),
        productId: String(i.productId._id),
        vyapar:
          i.productId.vyaparId && typeof i.productId.vyaparId === "object"
            ? i.productId.vyaparId
            : null,
        addedAt: i.addedAt,
      }));

    return ok(res, { items });
  } catch (err) {
    console.error("getWishlist error:", err);
    return fail(res, 500, "Could not load the wishlist");
  }
};

// ══════════════════════════════════════════════════════════════
// POST /wishlist/toggle/:productId
// ══════════════════════════════════════════════════════════════
exports.toggleWishlist = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { productId } = req.params;

    if (!isId(productId)) return fail(res, 400, "Invalid product id");

    let wl = await Wishlist.findOne({ userId });
    if (!wl) wl = new Wishlist({ userId, items: [] });

    const idx = wl.items.findIndex(
      (i) => String(i.productId) === String(productId),
    );

    let saved;
    if (idx >= 0) {
      wl.items.splice(idx, 1);
      saved = false;
    } else {
      wl.items.push({ productId });
      saved = true;
    }

    await wl.save();

    return ok(
      res,
      { productId, saved, count: wl.items.length },
      saved ? "Saved to wishlist" : "Removed from wishlist",
    );
  } catch (err) {
    console.error("toggleWishlist error:", err);
    return fail(res, 500, "Could not update the wishlist");
  }
};

// ══════════════════════════════════════════════════════════════
// GET /cart/count   — lightweight badge count, no populate
// ══════════════════════════════════════════════════════════════
exports.getCartCount = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return fail(res, 401, "Not authenticated");

    const cart = await Cart.findOne({ userId }).select("items.qty").lean();
    const count = (cart?.items || []).reduce(
      (sum, i) => sum + Number(i.qty || 0),
      0,
    );

    return ok(res, { count });
  } catch (err) {
    console.error("getCartCount error:", err);
    return fail(res, 500, "Could not load the cart count");
  }
};

// ══════════════════════════════════════════════════════════════
// POST /cart/move-to-wishlist/:productId
// Removes the item from the cart and saves it to the wishlist.
// ══════════════════════════════════════════════════════════════
exports.moveCartItemToWishlist = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { productId } = req.params;

    if (!isId(productId)) return fail(res, 400, "Invalid product id");

    const cart = await Cart.findOne({ userId });
    if (!cart) return fail(res, 404, "Cart is empty");

    const before = cart.items.length;
    const line = findLine(cart, productId);
    cart.items = line
      ? cart.items.filter((i) => String(i._id) !== String(line._id))
      : cart.items.filter((i) => String(i.productId) !== String(productId));
    if (cart.items.length === before) return fail(res, 404, "Item not in cart");

    await cart.save();

    // Add to wishlist only if it isn't already there
    let wl = await Wishlist.findOne({ userId });
    if (!wl) wl = new Wishlist({ userId, items: [] });

    const already = wl.items.some(
      (i) => String(i.productId) === String(productId),
    );
    if (!already) {
      wl.items.push({ productId });
      await wl.save();
    }

    const fresh = await populateCart(Cart.findOne({ userId }));
    return ok(res, shapeCart(fresh), "Moved to wishlist");
  } catch (err) {
    console.error("moveCartItemToWishlist error:", err);
    return fail(res, 500, "Could not move the item");
  }
};
