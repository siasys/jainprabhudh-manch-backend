// utils/orderNotify.js
// ─────────────────────────────────────────────────────────────
// Order notifications for both sides of the marketplace.
//
//   notifySellerNewOrder(order)          → seller gets "you have an order"
//   notifyBuyerStatusChange(order, next) → buyer gets "your order shipped"
//
// Every function here is fire-and-forget and swallows its own errors. A
// failed push must never roll back or block an order that was already
// written to the database.
// ─────────────────────────────────────────────────────────────
const Notification = require("../model/SocialMediaModels/notificationModel");
const User = require("../model/UserRegistrationModels/userModel");
const JainVyapar = require("../model/VyaparModels/vyaparModel");

// firebase-admin is loaded lazily so this module still works in
// environments where FCM is not configured (local dev, tests).
let messagingRef = null;
let messagingTried = false;

const getMessagingSafe = () => {
  if (messagingTried) return messagingRef;
  messagingTried = true;
  try {
    const { getApps } = require("firebase-admin/app");
    if (!getApps().length) {
      console.log("orderNotify: firebase app not initialised, push skipped");
      return null;
    }
    const { getMessaging } = require("firebase-admin/messaging");
    messagingRef = getMessaging();
  } catch (err) {
    console.log("orderNotify: firebase unavailable —", err?.message);
    messagingRef = null;
  }
  return messagingRef;
};

const inr = (n) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

// What the buyer reads for each status the seller sets
const BUYER_COPY = {
  confirmed: (o) => `${o.orderNumber} is confirmed and being prepared.`,
  packed: (o) => `${o.orderNumber} is packed and ready to ship.`,
  shipped: (o) =>
    o.trackingNumber
      ? `${o.orderNumber} is on the way. ${o.courierName} · ${o.trackingNumber}`
      : `${o.orderNumber} is on the way.`,
  delivered: (o) => `${o.orderNumber} has been delivered. Enjoy!`,
  cancelled: (o) => `${o.orderNumber} was cancelled.`,
};

// ── Push to every device the user is signed in on ─────────────
const pushToUser = async (userId, { title, body, data = {} }) => {
  try {
    const user = await User.findById(userId).select("fcmTokens").lean();
    const tokens = (user?.fcmTokens || []).filter(Boolean);
    if (!tokens.length) return;

    const messaging = getMessagingSafe();
    if (!messaging) return;

    // String values only — FCM rejects anything else in `data`
    const payloadData = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) payloadData[k] = String(v);
    }

    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: payloadData,
      android: { priority: "high", notification: { sound: "default" } },
      apns: { payload: { aps: { sound: "default" } } },
    });

    // Drop tokens the device no longer accepts, otherwise the array grows
    // forever and every send wastes time on dead entries.
    const dead = [];
    res.responses.forEach((r, i) => {
      const code = r?.error?.code || "";
      if (
        !r.success &&
        (code.includes("registration-token-not-registered") ||
          code.includes("invalid-argument") ||
          code.includes("invalid-registration-token"))
      ) {
        dead.push(tokens[i]);
      }
    });

    if (dead.length) {
      await User.updateOne(
        { _id: userId },
        { $pull: { fcmTokens: { $in: dead } } },
      );
    }
  } catch (err) {
    console.log("pushToUser failed:", err?.message);
  }
};

// ── Seller: a new order landed ────────────────────────────────
const notifySellerNewOrder = async (order) => {
  try {
    if (!order?.vyaparId) return;

    const vyapar = await JainVyapar.findById(order.vyaparId)
      .select("userId businessName")
      .lean();
    if (!vyapar?.userId) return;

    const items = Array.isArray(order.items) ? order.items : [];
    const units = items.reduce((s, i) => s + Number(i?.qty || 0), 0);
    const first = items[0]?.name || "an item";
    const extra = items.length > 1 ? ` +${items.length - 1} more` : "";

    const message = `New order ${order.orderNumber} · ${units} unit${
      units === 1 ? "" : "s"
    } · ${inr(order.total)}`;

    // In-app record. senderId is the buyer so the row can show who ordered.
    await Notification.create({
      senderId: order.userId,
      receiverId: vyapar.userId,
      type: "order_placed",
      orderId: order._id,
      vyaparId: order.vyaparId,
      message,
    });

    await pushToUser(vyapar.userId, {
      title: "New order received",
      body: `${first}${extra} · ${inr(order.total)}`,
      data: {
        type: "order_placed",
        orderId: String(order._id),
        vyaparId: String(order.vyaparId),
        orderNumber: order.orderNumber || "",
        screen: "SellerOrders",
      },
    });
  } catch (err) {
    console.log("notifySellerNewOrder failed:", err?.message);
  }
};

// Fan out across every seller in one checkout, without blocking the caller
const notifySellersNewOrders = (orders = []) => {
  Promise.allSettled(orders.map((o) => notifySellerNewOrder(o))).catch(
    () => {},
  );
};

// ── Buyer: the seller moved the order along ───────────────────
const notifyBuyerStatusChange = async (order, status, actorId) => {
  try {
    if (!order?.userId) return;

    const copy = BUYER_COPY[status];
    if (!copy) return; // nothing worth telling the buyer about

    const message = copy(order);

    await Notification.create({
      senderId: actorId || order.userId,
      receiverId: order.userId,
      type: "order_status",
      orderId: order._id,
      vyaparId: order.vyaparId,
      message,
    });

    const titles = {
      confirmed: "Order confirmed",
      packed: "Order packed",
      shipped: "Order on the way",
      delivered: "Order delivered",
      cancelled: "Order cancelled",
    };

    await pushToUser(order.userId, {
      title: titles[status] || "Order update",
      body: message,
      data: {
        type: "order_status",
        status,
        orderId: String(order._id),
        orderNumber: order.orderNumber || "",
        screen: "MyOrders",
      },
    });
  } catch (err) {
    console.log("notifyBuyerStatusChange failed:", err?.message);
  }
};

module.exports = {
  notifySellerNewOrder,
  notifySellersNewOrders,
  notifyBuyerStatusChange,
};
