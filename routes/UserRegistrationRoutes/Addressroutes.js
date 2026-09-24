const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../middlewares/authMiddlewares");
const {
  getMyAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} = require("../../controller/UserRegistrationControllers/Addresscontroller");

// ─── Protected — an address book is private to its owner ───
router.use(authMiddleware);

// GET    /api/address                       → my saved addresses
router.get("/", getMyAddresses);

// POST   /api/address                       → add one
router.post("/", addAddress);

// ⚠️ Fixed segment before the dynamic one, or "default" would be read as an id
// PATCH  /api/address/:addressId/default    → make it the default
router.patch("/:addressId/default", setDefaultAddress);

// PATCH  /api/address/:addressId            → edit one
router.patch("/:addressId", updateAddress);

// DELETE /api/address/:addressId            → remove one
router.delete("/:addressId", deleteAddress);

module.exports = router;
