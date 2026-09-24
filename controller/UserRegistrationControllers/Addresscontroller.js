// controller/UserRegistrationControllers/Addresscontroller.js
// ─────────────────────────────────────────────────────────────
// Saved delivery addresses for marketplace checkout.
//
// Every handler reads req.user._id and never trusts a userId from the
// body or query — that is what keeps one customer's address book out of
// another's checkout.
// ─────────────────────────────────────────────────────────────
const mongoose = require("mongoose");
const User = require("../../model/UserRegistrationModels/userModel");

const ok = (res, data, message = "Success") =>
  res.status(200).json({ success: true, message, data });

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));

const MAX_ADDRESSES = 15;

// Only these keys are ever written. Anything else in the body — isDefault
// spoofing, _id overwrites, stray fields — is dropped.
const sanitize = (body = {}) => ({
  fullName: String(body.fullName || "").trim(),
  phone: String(body.phone || "").trim(),
  altPhone: String(body.altPhone || "").trim(),
  pincode: String(body.pincode || "").trim(),
  house: String(body.house || "").trim(),
  area: String(body.area || "").trim(),
  landmark: String(body.landmark || "").trim(),
  city: String(body.city || "").trim(),
  state: String(body.state || "").trim(),
  type: ["Home", "Work", "Other"].includes(body.type) ? body.type : "Home",
});

// Mirrors the checks in Checkout.jsx so a forged request cannot save a
// half-empty address that later breaks order placement.
const validate = (a) => {
  if (!a.fullName || a.fullName.length < 2) return "Enter the full name";
  if (!/^\d{10}$/.test(a.phone)) return "Enter a valid 10-digit phone number";
  if (a.altPhone && !/^\d{10}$/.test(a.altPhone))
    return "The alternate number must be 10 digits";
  if (!/^\d{6}$/.test(a.pincode)) return "Enter a valid 6-digit pincode";
  if (!a.house) return "Enter the house or flat details";
  if (!a.area) return "Enter the area or street";
  if (!a.city) return "Enter the city";
  if (!a.state) return "Enter the state";
  return null;
};

// Exactly one default, and never zero while addresses exist
const normaliseDefaults = (list, preferId = null) => {
  if (!list.length) return list;

  let chosen = null;
  if (preferId) chosen = list.find((a) => String(a._id) === String(preferId));
  if (!chosen) chosen = list.find((a) => a.isDefault);
  if (!chosen) chosen = list[0];

  list.forEach((a) => {
    a.isDefault = String(a._id) === String(chosen._id);
  });
  return list;
};

// ══════════════════════════════════════════════════════════
// @desc    My saved addresses
// @route   GET /api/address
// ══════════════════════════════════════════════════════════
exports.getMyAddresses = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");

    const user = await User.findById(userId).select("addresses").lean();
    const list = user?.addresses || [];

    // Default first, then newest — matches what checkout wants to show
    list.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    return ok(res, { addresses: list, count: list.length });
  } catch (err) {
    console.error("getMyAddresses error:", err);
    return fail(res, 500, "Could not load your addresses");
  }
};

// ══════════════════════════════════════════════════════════
// @desc    Add an address
// @route   POST /api/address
// ══════════════════════════════════════════════════════════
exports.addAddress = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");

    const address = sanitize(req.body);
    const error = validate(address);
    if (error) return fail(res, 400, error);

    const user = await User.findById(userId).select("addresses");
    if (!user) return fail(res, 404, "User not found");

    if ((user.addresses || []).length >= MAX_ADDRESSES) {
      return fail(
        res,
        400,
        `You can save up to ${MAX_ADDRESSES} addresses. Delete one to add another.`,
      );
    }

    // First address is the default; after that only if asked for
    const wantsDefault =
      req.body.isDefault === true ||
      req.body.isDefault === "true" ||
      user.addresses.length === 0;

    address.isDefault = false;
    address.createdAt = new Date();
    address.updatedAt = new Date();

    user.addresses.push(address);
    const added = user.addresses[user.addresses.length - 1];

    normaliseDefaults(user.addresses, wantsDefault ? added._id : null);
    await user.save();

    return ok(
      res,
      { address: added, addresses: user.addresses },
      "Address saved",
    );
  } catch (err) {
    console.error("addAddress error:", err);
    return fail(res, 500, "Could not save the address");
  }
};

// ══════════════════════════════════════════════════════════
// @desc    Update an address
// @route   PATCH /api/address/:addressId
// ══════════════════════════════════════════════════════════
exports.updateAddress = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { addressId } = req.params;

    if (!userId) return fail(res, 401, "Unauthorized");
    if (!isId(addressId)) return fail(res, 400, "Invalid address id");

    const user = await User.findById(userId).select("addresses");
    if (!user) return fail(res, 404, "User not found");

    // ⚠️ Looked up inside this user's own array, so one customer can never
    //    edit another's address even with a valid id.
    const existing = user.addresses.id(addressId);
    if (!existing) return fail(res, 404, "Address not found");

    const address = sanitize(req.body);
    const error = validate(address);
    if (error) return fail(res, 400, error);

    Object.assign(existing, address, { updatedAt: new Date() });

    const wantsDefault =
      req.body.isDefault === true || req.body.isDefault === "true";
    normaliseDefaults(user.addresses, wantsDefault ? existing._id : null);

    await user.save();

    return ok(
      res,
      { address: existing, addresses: user.addresses },
      "Address updated",
    );
  } catch (err) {
    console.error("updateAddress error:", err);
    return fail(res, 500, "Could not update the address");
  }
};

// ══════════════════════════════════════════════════════════
// @desc    Delete an address
// @route   DELETE /api/address/:addressId
// ══════════════════════════════════════════════════════════
exports.deleteAddress = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { addressId } = req.params;

    if (!userId) return fail(res, 401, "Unauthorized");
    if (!isId(addressId)) return fail(res, 400, "Invalid address id");

    const user = await User.findById(userId).select("addresses");
    if (!user) return fail(res, 404, "User not found");

    const existing = user.addresses.id(addressId);
    if (!existing) return fail(res, 404, "Address not found");

    const wasDefault = existing.isDefault;
    user.addresses.pull(addressId);

    // Deleting the default promotes the next one, so checkout always has
    // something preselected.
    if (wasDefault) normaliseDefaults(user.addresses);

    await user.save();

    return ok(res, { addresses: user.addresses }, "Address removed");
  } catch (err) {
    console.error("deleteAddress error:", err);
    return fail(res, 500, "Could not remove the address");
  }
};

// ══════════════════════════════════════════════════════════
// @desc    Mark an address as the default
// @route   PATCH /api/address/:addressId/default
// ══════════════════════════════════════════════════════════
exports.setDefaultAddress = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { addressId } = req.params;

    if (!userId) return fail(res, 401, "Unauthorized");
    if (!isId(addressId)) return fail(res, 400, "Invalid address id");

    const user = await User.findById(userId).select("addresses");
    if (!user) return fail(res, 404, "User not found");

    const existing = user.addresses.id(addressId);
    if (!existing) return fail(res, 404, "Address not found");

    normaliseDefaults(user.addresses, existing._id);
    await user.save();

    return ok(res, { addresses: user.addresses }, "Default address set");
  } catch (err) {
    console.error("setDefaultAddress error:", err);
    return fail(res, 500, "Could not set the default address");
  }
};
