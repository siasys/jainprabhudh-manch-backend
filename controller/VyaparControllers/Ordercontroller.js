const mongoose = require("mongoose");
const crypto = require("crypto");
const Order = require("../../model/VyaparModels/Ordermodel");
const { makeOrderNumber } = require("../../model/VyaparModels/Ordermodel");
const Cart = require("../../model/VyaparModels/Cartmodel");
const Product = require("../../model/VyaparModels/Productmodel");
const JainVyapar = require("../../model/VyaparModels/vyaparModel");
const {
  notifySellersNewOrders,
  notifyBuyerStatusChange,
} = require("../../utils/Ordernotify");

// ── Shipping rules — these match the constants in Cart.jsx ──
const FREE_SHIP_THRESHOLD = 299;
const SHIPPING_FEE = 49;

// ── Cancellation window ──────────────────────────────────────
// A customer may cancel for this long after placing the order. After that
// the seller has usually bought packaging or blocked stock, so cancelling
// is a support request rather than a self-service action.
// Keep CANCEL_WINDOW_MS in sync with MyOrders.jsx.
const CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

// Single source of truth for "can this still be cancelled by the buyer".
// Used by cancelOrder and echoed on every order the customer reads, so the
// screen never offers a button the server would reject.
const cancelState = (order) => {
  const placedAt = new Date(order?.createdAt || 0).getTime();
  const expiresAt = placedAt + CANCEL_WINDOW_MS;
  const msLeft = expiresAt - Date.now();

  // Once the seller packs it the window is irrelevant — it has left the shelf
  const stageOk = ["placed", "confirmed"].includes(order?.status);
  const timeOk = msLeft > 0;

  return {
    canCancel: stageOk && timeOk,
    stageOk,
    timeOk,
    msLeft: Math.max(0, msLeft),
    expiresAt: new Date(expiresAt).toISOString(),
    windowMs: CANCEL_WINDOW_MS,
  };
};

// Attaches the window to a plain order object for the customer-facing reads
const withCancelInfo = (order) => {
  if (!order) return order;
  const raw = typeof order.toObject === "function" ? order.toObject() : order;
  return { ...raw, cancel: cancelState(raw) };
};

const ok = (res, data, message = "Success") =>
  res.status(200).json({ success: true, message, data });

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));

// ── Variants and bulk pricing ─────────────────────────────────
// Mirrors the helpers in Cartcontroller.js. The order has to arrive at
// the same price the cart showed, or the buyer is charged something they
// never agreed to.

const findVariant = (product, variantId) => {
  if (!product?.hasVariants || !product.variants?.length) return null;
  if (!variantId) {
    return product.variants.find((v) => v.isDefault) || product.variants[0];
  }
  return (
    product.variants.find((v) => String(v._id) === String(variantId)) || null
  );
};

const unitPriceFor = (product, variant, qty) => {
  const base = Number(variant?.price ?? product?.price ?? 0);
  if (!product?.wholesaleEnabled) return base;

  const rows = product.hasVariants
    ? variant?.bulkPricing || []
    : product.bulkPricing || [];

  const q = Number(qty) || 0;
  const slab = [...rows]
    .sort((a, b) => a.minQty - b.minQty)
    .find((s) => q >= s.minQty && (!s.maxQty || q <= s.maxQty));

  return slab ? Number(slab.price) : base;
};

const stockFor = (product, variant) =>
  Number(variant ? (variant.stock ?? 0) : (product?.stock ?? 0));

// Orders are split one-per-seller, and the split key comes from
// product.vyaparId. That field is normally a plain ObjectId, but if it ever
// arrives populated — a nested populate anywhere up the chain, a schema
// plugin — then String(obj) becomes "[object Object]" and EVERY product
// collapses into a single group. The customer then gets one order holding
// items from several sellers, and only the first seller ever sees it.
// Reading the id explicitly makes that impossible.
const sellerIdOf = (product) => {
  const v = product?.vyaparId;
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v._id) return String(v._id); // populated document
  return String(v); // ObjectId
};

// ── Payload normalisers ───────────────────────────────────────
// Checkout.jsx posts `shippingAddress` with house/area fields and calls the
// gateway "razorpay". The schema uses `address` with line1/line2 and "online".
// These adapters accept either shape so neither side has to change.

const normPayment = (v) => {
  const s = String(v || "").toLowerCase();
  if (s === "cod") return "cod";
  if (s === "online" || s === "razorpay" || s === "prepaid") return "online";
  return null;
};

const normAddress = (body) => {
  const a = body?.address || body?.shippingAddress || {};
  return {
    line1: a.line1 || a.house || a.addressLine1 || a.street || a.address || "",
    line2: a.line2 || a.area || a.addressLine2 || a.locality || "",
    city: a.city || a.district || "",
    state: a.state || "",
    pincode: String(a.pincode || a.pinCode || a.zip || a.postalCode || ""),
    landmark: a.landmark || "",
    _fullName: a.fullName || a.name || "",
    _phone: a.phone || a.mobile || a.phoneNumber || "",
  };
};

// Which status is allowed to move to which
const NEXT_ALLOWED = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

// ══════════════════════════════════════════════════════════════
// POST /order/create
// Splits the cart by seller and creates one order per seller.
// ══════════════════════════════════════════════════════════════
exports.createOrder = async (req, res) => {
  const result = await placeOrders(req);
  if (result.error) return fail(res, result.error[0], result.error[1]);

  return res.status(201).json({
    success: true,
    message: "Order placed",
    data: result.data,
  });
};

// Shared by POST /order/create and POST /order/create-payment.
// Returns { data } on success or { error: [status, message] }.
async function placeOrders(req) {
  const claimed = []; // { productId, qty } — used for rollback

  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return { error: [401, "Not authenticated"] };

    const paymentMethod = normPayment(req.body?.paymentMethod);
    const address = normAddress(req.body);
    const couponCode = req.body?.couponCode;
    const discount = req.body?.discount ?? req.body?.amounts?.productDiscount;
    const codFee =
      paymentMethod === "cod" ? Number(req.body?.amounts?.codFee) || 0 : 0;

    if (!paymentMethod) {
      return { error: [400, "Choose a payment method"] };
    }

    if (!address.line1 || !address.city || !address.pincode) {
      return { error: [400, "A complete delivery address is required"] };
    }

    const cart = await Cart.findOne({ userId }).populate({
      path: "items.productId",
      select:
        "name photos category unit stock price mrp vyaparId isDeleted isHidden status codAvailable shippingMode " +
        // Without these the order falls back to the product-level price
        // and ignores both the chosen option and any bulk slab
        "hasVariants variantType variants wholesaleEnabled allowRetail " +
        "bulkPricing moq maxQty",
    });

    if (!cart || cart.items.length === 0) {
      return { error: [400, "Your cart is empty"] };
    }

    // ── 1. Validate everything before touching stock ──────────
    const valid = [];
    for (const item of cart.items) {
      const p = item.productId;

      if (!p || p.isDeleted || p.isHidden || p.status !== "active") {
        return {
          error: [400, `"${p?.name || "An item"}" is no longer available`],
        };
      }
      // Which option was bought — stock and price both hang off it
      const variant = findVariant(p, item.variantId);
      const label = variant?.label ? `${p.name} (${variant.label})` : p.name;

      if (p.hasVariants && item.variantId && !variant) {
        return {
          error: [
            400,
            `The option you chose for "${p.name}" is no longer sold. Remove it and try again.`,
          ],
        };
      }

      const available = stockFor(p, variant);
      if (available < item.qty) {
        return {
          error: [
            400,
            `Only ${available} left of "${label}". Update the quantity and try again.`,
          ],
        };
      }

      // A wholesale-only seller will not fill an order below their floor
      if (p.wholesaleEnabled && p.allowRetail === false) {
        const min = Math.max(1, Number(p.moq) || 1);
        if (item.qty < min) {
          return {
            error: [
              400,
              `"${p.name}" has a minimum order of ${min} ${p.unit || "units"}`,
            ],
          };
        }
      }

      if (paymentMethod === "cod" && p.codAvailable === false) {
        return {
          error: [400, `"${p.name}" is not available for cash on delivery`],
        };
      }

      valid.push({ product: p, qty: item.qty, variant, label });
    }

    // ── 2. Claim stock atomically ─────────────────────────────
    // With variants the count that matters sits inside the array, so the
    // decrement targets that element via arrayFilters. Doing it on the
    // product-level figure would let two buyers take the same last pack.
    for (const { product, qty, variant, label } of valid) {
      let updated;

      if (variant) {
        updated = await Product.findOneAndUpdate(
          {
            _id: product._id,
            isDeleted: false,
            variants: {
              $elemMatch: { _id: variant._id, stock: { $gte: qty } },
            },
          },
          {
            $inc: { "variants.$[v].stock": -qty, stock: -qty },
          },
          {
            new: true,
            arrayFilters: [{ "v._id": variant._id, "v.stock": { $gte: qty } }],
          },
        );
      } else {
        updated = await Product.findOneAndUpdate(
          { _id: product._id, stock: { $gte: qty }, isDeleted: false },
          { $inc: { stock: -qty } },
          { new: true },
        );
      }

      if (!updated) {
        // Someone else took the last one between validate and claim
        await rollbackStock(claimed);
        return {
          error: [
            409,
            `"${label}" just went out of stock. Please review your cart.`,
          ],
        };
      }

      claimed.push({ productId: product._id, qty, variantId: variant?._id });
    }

    // ── 3. Group by seller ────────────────────────────────────
    const bySeller = new Map();
    for (const { product, qty, variant } of valid) {
      const key = sellerIdOf(product);

      // Without a seller there is nothing to group on. Merging these into
      // one bucket would hand another seller someone else's item, so stop
      // and give the stock back instead.
      if (!key || !isId(key)) {
        await rollbackStock(claimed);
        console.error(
          "placeOrders: product has no usable vyaparId",
          product?._id,
        );
        return {
          error: [
            400,
            `"${product?.name || "An item"}" is not linked to a seller. Remove it from your cart and try again.`,
          ],
        };
      }

      if (!bySeller.has(key)) bySeller.set(key, []);
      bySeller.get(key).push({ product, qty, variant });
    }

    const groupId = crypto.randomBytes(8).toString("hex");
    const totalDiscount = Math.max(0, Number(discount) || 0);
    const sellerCount = bySeller.size;

    // Spread the coupon discount across the sellers
    const discountPerSeller =
      sellerCount > 0 ? Math.round(totalDiscount / sellerCount) : 0;

    const docs = [];
    for (const [vyaparId, entries] of bySeller.entries()) {
      const items = entries.map(({ product, qty, variant }) => ({
        productId: product._id,
        variantId: variant?._id || null,
        variantLabel: variant?.label || "",
        name: product.name,
        photo: product.photos?.[0]?.url || "",
        // Resolved here, not read off the product: a variant has its own
        // price, and a bulk slab may lower it further at this quantity
        price: unitPriceFor(product, variant, qty),
        mrp: Number(variant?.mrp ?? product.mrp ?? 0),
        unit: product.unit,
        qty,
      }));

      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const shippingFee = subtotal >= FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE;
      const thisDiscount = Math.min(discountPerSeller, subtotal);
      // COD handling fee is charged once per checkout, not per seller
      const thisCodFee = docs.length === 0 ? codFee : 0;
      const total = Math.max(
        0,
        subtotal + shippingFee + thisCodFee - thisDiscount,
      );

      // Carry the shipping mode of the seller's first product onto the order
      const shippingMode = entries[0].product.shippingMode || "jaintva";

      docs.push({
        orderNumber: makeOrderNumber(),
        groupId,
        // How many orders this one checkout produced, so MyOrders can show
        // "Order 1 of 3" instead of looking like duplicate charges
        groupSize: sellerCount,
        groupIndex: docs.length + 1,
        userId,
        vyaparId,
        customerName:
          req.body.customerName ||
          address._fullName ||
          req.user?.fullName ||
          "",
        customerPhone:
          req.body.customerPhone ||
          address._phone ||
          req.user?.phoneNumber ||
          "",
        address: {
          line1: address.line1,
          line2: address.line2 || "",
          city: address.city,
          state: address.state || "",
          pincode: address.pincode,
          landmark: address.landmark || "",
        },
        items,
        subtotal,
        shippingFee,
        discount: thisDiscount,
        codFee: thisCodFee,
        total,
        couponCode: couponCode || "",
        paymentMethod,
        paymentStatus: "pending",
        status: "placed",
        shippingMode,
        statusHistory: [{ status: "placed", at: new Date(), by: userId }],
      });
    }

    const orders = await Order.insertMany(docs);

    // ── 4. Clear the cart now for COD; after payment for online ──
    if (paymentMethod === "cod") {
      await Cart.findOneAndUpdate({ userId }, { $set: { items: [] } });

      // COD is confirmed the moment it is placed, so the seller is told now.
      // Online orders wait for verifyPayment — nobody should start packing
      // something that has not been paid for.
      // Fire-and-forget: a failed push must not fail the order.
      notifySellersNewOrders(orders);
    }

    const grandTotal = orders.reduce((s, o) => s + o.total, 0);

    return {
      data: {
        groupId,
        // So the success screen can say "cancel free within 2 hours"
        cancelWindowMs: CANCEL_WINDOW_MS,
        orders,
        // Checkout.jsx reads `orderId`; keep both spellings available
        orderId: orders[0]?._id,
        orderIds: orders.map((o) => o._id),
        orderNumbers: orders.map((o) => o.orderNumber),
        grandTotal,
        sellerCount,
      },
    };
  } catch (err) {
    console.error("placeOrders error:", err);
    await rollbackStock(claimed);
    return { error: [500, "Could not place the order"] };
  }
}

// Give the claimed stock back
async function rollbackStock(claimed) {
  for (const c of claimed) {
    try {
      if (c.variantId) {
        // Both counters were decremented, so both go back
        await Product.updateOne(
          { _id: c.productId },
          { $inc: { "variants.$[v].stock": c.qty, stock: c.qty } },
          { arrayFilters: [{ "v._id": c.variantId }] },
        );
      } else {
        await Product.updateOne(
          { _id: c.productId },
          { $inc: { stock: c.qty } },
        );
      }
    } catch (e) {
      console.error(
        "rollbackStock failed for",
        String(c.productId),
        e?.message,
      );
    }
  }
}

// ══════════════════════════════════════════════════════════════
// POST /order/create-payment
// Two ways in:
//   • { groupId }        → an order already exists, just start payment
//   • full checkout body → place the order here, then start payment
// Checkout.jsx uses the second form, so the order is created up front and
// only marked paid once verify-payment succeeds.
// ══════════════════════════════════════════════════════════════
exports.createPaymentOrder = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return fail(res, 401, "Not authenticated");

    let groupId = req.body?.groupId;
    let orders;

    if (groupId) {
      orders = await Order.find({ groupId, userId });
      if (!orders.length) return fail(res, 404, "Order not found");
    } else {
      // Force "online" — a COD order should never reach the gateway
      const result = await placeOrders({
        ...req,
        body: { ...req.body, paymentMethod: "online" },
      });
      if (result.error) return fail(res, result.error[0], result.error[1]);

      groupId = result.data.groupId;
      orders = result.data.orders;
    }

    if (orders.every((o) => o.paymentStatus === "paid")) {
      return fail(res, 400, "This order is already paid");
    }

    const amount = orders.reduce((s, o) => s + o.total, 0);

    const Razorpay = require("razorpay");
    const instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const rpOrder = await instance.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      receipt: `mp_${groupId}`.slice(0, 40),
      notes: { groupId, userId: String(userId) },
    });

    await Order.updateMany(
      { groupId, userId },
      { $set: { razorpayOrderId: rpOrder.id } },
    );

    return ok(res, {
      razorpayOrderId: rpOrder.id,
      amount: rpOrder.amount,
      currency: rpOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
      groupId,
      // Checkout.jsx destructures `orderId` and sends it back on verify
      orderId: orders[0]?._id,
      orderIds: orders.map((o) => o._id),
    });
  } catch (err) {
    console.error("createPaymentOrder error:", err);
    return fail(res, 500, "Could not start the payment");
  }
};

// ══════════════════════════════════════════════════════════════
// POST /order/verify-payment
// { groupId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
// ══════════════════════════════════════════════════════════════
exports.verifyPayment = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const {
      orderId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return fail(res, 400, "Payment details are incomplete");
    }

    // Checkout.jsx sends orderId; resolve it to the sibling group
    let groupId = req.body?.groupId;
    if (!groupId && orderId) {
      const one = await Order.findOne({ _id: orderId, userId }).select(
        "groupId",
      );
      if (!one) return fail(res, 404, "Order not found");
      groupId = one.groupId;
    }
    if (!groupId) {
      // Last resort — match on the Razorpay order id we stored earlier
      const one = await Order.findOne({
        razorpayOrderId: razorpay_order_id,
        userId,
      }).select("groupId");
      if (!one) return fail(res, 400, "Order reference is missing");
      groupId = one.groupId;
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      await Order.updateMany(
        { groupId, userId },
        { $set: { paymentStatus: "failed" } },
      );
      return fail(res, 400, "Payment could not be verified");
    }

    await Order.updateMany(
      { groupId, userId },
      {
        $set: {
          paymentStatus: "paid",
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
        },
      },
    );

    // Only clear the cart once payment has gone through
    await Cart.findOneAndUpdate({ userId }, { $set: { items: [] } });

    const orders = await Order.find({ groupId, userId });

    // Payment cleared — now the sellers can be told to start packing
    notifySellersNewOrders(orders);

    return ok(res, { orders, groupId }, "Payment successful");
  } catch (err) {
    console.error("verifyPayment error:", err);
    return fail(res, 500, "Could not verify the payment");
  }
};

// ══════════════════════════════════════════════════════════════
// GET /order/my
// ══════════════════════════════════════════════════════════════
exports.getMyOrders = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20),
    );

    const query = { userId };
    if (req.query.status) query.status = req.query.status;

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("vyaparId", "businessName location businessLogo")
        .sort({ createdAt: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    const shaped = orders.map((o) => ({
      ...o,
      vyapar: o.vyaparId && typeof o.vyaparId === "object" ? o.vyaparId : null,
      sellerName: o.vyaparId?.businessName || "",
      // Lets MyOrders show a live countdown without guessing the rule
      cancel: cancelState(o),
    }));

    return ok(res, { orders: shaped, total, page, limit });
  } catch (err) {
    console.error("getMyOrders error:", err);
    return fail(res, 500, "Could not load your orders");
  }
};

// ══════════════════════════════════════════════════════════════
// GET /order/seller/:vyaparId
// ══════════════════════════════════════════════════════════════
exports.getSellerOrders = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { vyaparId } = req.params;

    if (!isId(vyaparId)) return fail(res, 400, "Invalid business id");

    const vyapar = await JainVyapar.findById(vyaparId).select("userId");
    if (!vyapar) return fail(res, 404, "Business not found");

    if (String(vyapar.userId) !== String(userId)) {
      return fail(res, 403, "You cannot view these orders");
    }

    const limit = Math.min(
      300,
      Math.max(1, parseInt(req.query.limit, 10) || 200),
    );

    const query = { vyaparId };
    if (req.query.status) query.status = req.query.status;

    const orders = await Order.find(query)
      .sort({ createdAt: -1, _id: 1 })
      .limit(limit)
      .lean();

    return ok(res, { orders, total: orders.length });
  } catch (err) {
    console.error("getSellerOrders error:", err);
    return fail(res, 500, "Could not load orders");
  }
};

// ══════════════════════════════════════════════════════════════
// @desc    Everything the seller console needs on one screen
// @route   GET /api/order/seller/:vyaparId/summary
// @access  Private (that seller only)
//
// Done with aggregation rather than by pulling every order and adding
// it up in the browser — a shop with a thousand orders would otherwise
// ship a thousand documents to render four numbers.
// ══════════════════════════════════════════════════════════════
exports.getSellerSummary = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { vyaparId } = req.params;

    if (!isId(vyaparId)) return fail(res, 400, "Invalid business id");

    // Same ownership rule as getSellerOrders — one seller must never see
    // another's takings.
    const vyapar = await JainVyapar.findById(vyaparId).select("userId");
    if (!vyapar) return fail(res, 404, "Business not found");
    if (String(vyapar.userId) !== String(userId)) {
      return fail(res, 403, "This is not your business");
    }

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - 6);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const sellerId = new mongoose.Types.ObjectId(String(vyaparId));

    // Cancelled orders are excluded from every revenue figure — money
    // that was never collected is not income.
    const EARNED = { $nin: ["cancelled"] };

    const [revenue, statusCounts, topProducts, topCustomers, payouts, recent] =
      await Promise.all([
        // ── Revenue over four windows, in one pass ──
        Order.aggregate([
          { $match: { vyaparId: sellerId, status: EARNED } },
          {
            $group: {
              _id: null,
              allTime: { $sum: "$total" },
              allCount: { $sum: 1 },
              today: {
                $sum: {
                  $cond: [{ $gte: ["$createdAt", startOfDay] }, "$total", 0],
                },
              },
              todayCount: {
                $sum: { $cond: [{ $gte: ["$createdAt", startOfDay] }, 1, 0] },
              },
              week: {
                $sum: {
                  $cond: [{ $gte: ["$createdAt", startOfWeek] }, "$total", 0],
                },
              },
              weekCount: {
                $sum: { $cond: [{ $gte: ["$createdAt", startOfWeek] }, 1, 0] },
              },
              month: {
                $sum: {
                  $cond: [{ $gte: ["$createdAt", startOfMonth] }, "$total", 0],
                },
              },
              monthCount: {
                $sum: { $cond: [{ $gte: ["$createdAt", startOfMonth] }, 1, 0] },
              },
              // Last month in full, so the month figure has something to
              // be compared against
              prevMonth: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ["$createdAt", startOfPrevMonth] },
                        { $lt: ["$createdAt", startOfMonth] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
            },
          },
        ]),

        // ── How many orders sit at each stage ──
        Order.aggregate([
          { $match: { vyaparId: sellerId } },
          { $group: { _id: "$status", n: { $sum: 1 } } },
        ]),

        // ── What actually sells ──
        Order.aggregate([
          { $match: { vyaparId: sellerId, status: EARNED } },
          { $unwind: "$items" },
          {
            $group: {
              // Variants are counted separately — "5 kg sells, 1 kg does
              // not" is the useful answer, not "Poha sells"
              _id: {
                productId: "$items.productId",
                variantLabel: "$items.variantLabel",
              },
              name: { $first: "$items.name" },
              photo: { $first: "$items.photo" },
              unit: { $first: "$items.unit" },
              units: { $sum: "$items.qty" },
              revenue: { $sum: { $multiply: ["$items.price", "$items.qty"] } },
              orders: { $sum: 1 },
            },
          },
          { $sort: { revenue: -1 } },
          { $limit: 8 },
        ]),

        // ── Who buys ──
        Order.aggregate([
          { $match: { vyaparId: sellerId, status: EARNED } },
          {
            $group: {
              _id: "$userId",
              name: { $last: "$customerName" },
              phone: { $last: "$customerPhone" },
              city: { $last: "$address.city" },
              orders: { $sum: 1 },
              spent: { $sum: "$total" },
              lastOrderAt: { $max: "$createdAt" },
            },
          },
          { $sort: { spent: -1 } },
          { $limit: 8 },
        ]),

        // ── Money in and money still owed ──
        Order.aggregate([
          { $match: { vyaparId: sellerId, status: EARNED } },
          {
            $group: {
              _id: null,
              // Cash the seller collects at the door
              codPending: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$paymentMethod", "cod"] },
                        { $ne: ["$paymentStatus", "paid"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              codCollected: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$paymentMethod", "cod"] },
                        { $eq: ["$paymentStatus", "paid"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              // Paid to the platform, owed to the seller
              onlinePaid: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$paymentMethod", "cod"] },
                        { $eq: ["$paymentStatus", "paid"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
              // Already handed over — nothing left to settle
              onlineSettled: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$paymentMethod", "cod"] },
                        { $eq: ["$paymentStatus", "paid"] },
                        { $eq: ["$status", "delivered"] },
                      ],
                    },
                    "$total",
                    0,
                  ],
                },
              },
            },
          },
        ]),

        // ── A short tail, so the screen has something concrete on it ──
        Order.find({ vyaparId: sellerId })
          .select(
            "orderNumber status total customerName paymentMethod createdAt items",
          )
          .sort({ createdAt: -1, _id: -1 })
          .limit(5)
          .lean(),
      ]);

    const r = revenue[0] || {};
    const p = payouts[0] || {};

    const byStatus = {};
    statusCounts.forEach((s) => {
      byStatus[s._id] = s.n;
    });

    const monthNow = r.month || 0;
    const monthPrev = r.prevMonth || 0;

    return ok(res, {
      revenue: {
        today: r.today || 0,
        todayCount: r.todayCount || 0,
        week: r.week || 0,
        weekCount: r.weekCount || 0,
        month: monthNow,
        monthCount: r.monthCount || 0,
        prevMonth: monthPrev,
        // Null rather than 0 when there is no previous month — "no
        // change" and "no history" are different things to show
        monthChangePct: monthPrev
          ? Math.round(((monthNow - monthPrev) / monthPrev) * 100)
          : null,
        allTime: r.allTime || 0,
        allCount: r.allCount || 0,
        avgOrder: r.allCount ? Math.round(r.allTime / r.allCount) : 0,
      },

      // What the seller has to do next
      todo: {
        toAccept: byStatus.placed || 0,
        toPack: byStatus.confirmed || 0,
        toShip: byStatus.packed || 0,
        inTransit: byStatus.shipped || 0,
        delivered: byStatus.delivered || 0,
        cancelled: byStatus.cancelled || 0,
      },

      payouts: {
        codPending: p.codPending || 0,
        codCollected: p.codCollected || 0,
        onlinePaid: p.onlinePaid || 0,
        onlineSettled: p.onlineSettled || 0,
        // Online money for orders that have not been delivered yet
        awaitingSettlement: (p.onlinePaid || 0) - (p.onlineSettled || 0),
      },

      topProducts: topProducts.map((t) => ({
        productId: String(t._id.productId || ""),
        variantLabel: t._id.variantLabel || "",
        name: t.name,
        photo: t.photo,
        unit: t.unit,
        units: t.units,
        revenue: t.revenue,
        orders: t.orders,
      })),

      topCustomers: topCustomers.map((c) => ({
        userId: String(c._id || ""),
        name: c.name || "Customer",
        phone: c.phone || "",
        city: c.city || "",
        orders: c.orders,
        spent: c.spent,
        lastOrderAt: c.lastOrderAt,
        repeat: c.orders > 1,
      })),

      recent,
    });
  } catch (err) {
    console.error("getSellerSummary error:", err);
    return fail(res, 500, "Could not load the summary");
  }
};

// ══════════════════════════════════════════════════════════════
// @desc    What this account has bought from other sellers
// @route   GET /api/order/my/summary
// @access  Private
//
// A business account both sells and buys. This is the buying half —
// what it spent, with whom, and how much GST it can claim back.
// ══════════════════════════════════════════════════════════════
exports.getMyPurchaseSummary = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const buyerId = new mongoose.Types.ObjectId(String(userId));

    const [totals, bySeller] = await Promise.all([
      Order.aggregate([
        { $match: { userId: buyerId, status: { $nin: ["cancelled"] } } },
        {
          $group: {
            _id: null,
            allTime: { $sum: "$total" },
            allCount: { $sum: 1 },
            month: {
              $sum: {
                $cond: [{ $gte: ["$createdAt", startOfMonth] }, "$total", 0],
              },
            },
            monthCount: {
              $sum: { $cond: [{ $gte: ["$createdAt", startOfMonth] }, 1, 0] },
            },
          },
        },
      ]),

      Order.aggregate([
        { $match: { userId: buyerId, status: { $nin: ["cancelled"] } } },
        {
          $group: {
            _id: "$vyaparId",
            orders: { $sum: 1 },
            spent: { $sum: "$total" },
            lastOrderAt: { $max: "$createdAt" },
          },
        },
        { $sort: { spent: -1 } },
        { $limit: 8 },
        // The order stores only the seller's id, so the name is joined
        // here rather than denormalised onto every order document.
        {
          $lookup: {
            from: "jainvyapars",
            localField: "_id",
            foreignField: "_id",
            as: "shop",
          },
        },
        {
          $addFields: {
            name: { $ifNull: [{ $first: "$shop.businessName" }, "Seller"] },
            city: { $first: "$shop.location.city" },
          },
        },
        { $project: { shop: 0 } },
      ]),
    ]);

    const t = totals[0] || {};

    return ok(res, {
      allTime: t.allTime || 0,
      allCount: t.allCount || 0,
      month: t.month || 0,
      monthCount: t.monthCount || 0,
      suppliers: bySeller.map((s) => ({
        vyaparId: String(s._id || ""),
        name: s.name || "Seller",
        city: s.city || "",
        orders: s.orders,
        spent: s.spent,
        lastOrderAt: s.lastOrderAt,
      })),
    });
  } catch (err) {
    console.error("getMyPurchaseSummary error:", err);
    return fail(res, 500, "Could not load your purchases");
  }
};

// ══════════════════════════════════════════════════════════════
// GET /order/:id
// ══════════════════════════════════════════════════════════════
exports.getOrderById = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    if (!isId(id)) return fail(res, 400, "Invalid order id");

    const order = await Order.findById(id)
      .populate("vyaparId", "businessName location userId")
      .lean();

    if (!order) return fail(res, 404, "Order not found");

    const isBuyer = String(order.userId) === String(userId);
    const isSeller = String(order.vyaparId?.userId) === String(userId);

    if (!isBuyer && !isSeller) {
      return fail(res, 403, "You cannot view this order");
    }

    return ok(res, { order: isBuyer ? withCancelInfo(order) : order });
  } catch (err) {
    console.error("getOrderById error:", err);
    return fail(res, 500, "Could not load the order");
  }
};

// ══════════════════════════════════════════════════════════════
// PATCH /order/:id/status   { status, note }
// The seller advances the order
// ══════════════════════════════════════════════════════════════
exports.updateOrderStatus = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;
    const { status, note } = req.body;

    if (!isId(id)) return fail(res, 400, "Invalid order id");

    const order = await Order.findById(id).populate("vyaparId", "userId");
    if (!order) return fail(res, 404, "Order not found");

    if (String(order.vyaparId?.userId) !== String(userId)) {
      return fail(res, 403, "You cannot update this order");
    }

    const allowed = NEXT_ALLOWED[order.status] || [];
    if (!allowed.includes(status)) {
      return fail(
        res,
        400,
        `An order that is "${order.status}" cannot move to "${status}"`,
      );
    }

    // Put the stock back on cancel
    if (status === "cancelled") {
      for (const item of order.items) {
        await Product.updateOne(
          { _id: item.productId },
          { $inc: { stock: item.qty } },
        );
      }
      order.cancelledAt = new Date();
      order.cancelReason = note || "Cancelled by seller";
    }

    if (status === "delivered") {
      order.deliveredAt = new Date();
      // COD money only arrives on delivery
      if (order.paymentMethod === "cod") order.paymentStatus = "paid";
    }

    order.status = status;
    order.statusHistory.push({
      status,
      at: new Date(),
      by: userId,
      note: note || "",
    });

    await order.save();

    // Keep the buyer in the loop on every step
    notifyBuyerStatusChange(order, status, userId);

    return ok(res, { order }, `Order marked ${status}`);
  } catch (err) {
    console.error("updateOrderStatus error:", err);
    return fail(res, 500, "Could not update the status");
  }
};

// ══════════════════════════════════════════════════════════════
// PATCH /order/:id/shipment
// { shippingMode, courierName, trackingNumber, status }
// ══════════════════════════════════════════════════════════════
exports.setShipment = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;
    const { shippingMode, courierName, trackingNumber } = req.body;

    if (!isId(id)) return fail(res, 400, "Invalid order id");

    const order = await Order.findById(id).populate("vyaparId", "userId");
    if (!order) return fail(res, 404, "Order not found");

    if (String(order.vyaparId?.userId) !== String(userId)) {
      return fail(res, 403, "You cannot update this order");
    }

    if (!["placed", "confirmed", "packed"].includes(order.status)) {
      return fail(res, 400, "This order can no longer be shipped");
    }

    const mode = shippingMode === "self" ? "self" : "jaintva";

    if (mode === "self" && (!courierName?.trim() || !trackingNumber?.trim())) {
      return fail(
        res,
        400,
        "Courier name and tracking number are both required",
      );
    }

    order.shippingMode = mode;

    if (mode === "self") {
      order.courierName = courierName.trim();
      order.trackingNumber = trackingNumber.trim();
    } else {
      order.courierName = "Jaintva Logistics";
      order.trackingNumber = "";
      order.pickupRequestedAt = new Date();
      // TODO: send the pickup request to the aggregator (Shiprocket /
      //       Delhivery) here and save the returned AWB on the order.
    }

    order.status = "shipped";
    order.statusHistory.push({
      status: "shipped",
      at: new Date(),
      by: userId,
      note:
        mode === "self"
          ? `Self ship · ${order.courierName}`
          : "Jaintva pickup requested",
    });

    await order.save();

    // Buyer gets the courier and tracking number in the message
    notifyBuyerStatusChange(order, "shipped", userId);

    return ok(
      res,
      { order },
      mode === "jaintva" ? "Pickup requested" : "Tracking details saved",
    );
  } catch (err) {
    console.error("setShipment error:", err);
    return fail(res, 500, "Could not save the shipment");
  }
};

// ══════════════════════════════════════════════════════════════
// PATCH /order/:id/cancel   — customer side
// ══════════════════════════════════════════════════════════════
exports.cancelOrder = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    if (!isId(id)) return fail(res, 400, "Invalid order id");

    const order = await Order.findOne({ _id: id, userId });
    if (!order) return fail(res, 404, "Order not found");

    // ⚠️ Checked server-side as well as in the UI — the button can be stale
    //    by the time the request lands, and a request can be forged.
    const state = cancelState(order);

    if (!state.stageOk) {
      return fail(
        res,
        400,
        "This order has already been packed and can no longer be cancelled here",
      );
    }

    if (!state.timeOk) {
      const hrs = Math.round(CANCEL_WINDOW_MS / 3600000);
      return fail(
        res,
        400,
        `The ${hrs}-hour cancellation window for this order has closed. Contact the seller for help.`,
      );
    }

    for (const item of order.items) {
      await Product.updateOne(
        { _id: item.productId },
        { $inc: { stock: item.qty } },
      );
    }

    order.status = "cancelled";
    order.cancelledAt = new Date();
    order.cancelReason = req.body.reason || "Cancelled by customer";
    order.statusHistory.push({
      status: "cancelled",
      at: new Date(),
      by: userId,
      note: order.cancelReason,
    });

    if (order.paymentStatus === "paid") {
      // TODO: call the Razorpay refund API here
      order.paymentStatus = "refunded";
    }

    await order.save();

    return ok(res, { order: withCancelInfo(order) }, "Order cancelled");
  } catch (err) {
    console.error("cancelOrder error:", err);
    return fail(res, 500, "Could not cancel the order");
  }
};
