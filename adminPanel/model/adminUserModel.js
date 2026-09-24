/**
 * ADMIN PANEL — AdminUser model
 *
 * NOTE: the model is named "AdminUser", deliberately different from the
 * older "Admin" model. Collection: adminusers
 */

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { ROLES, FULL_ACCESS_ROLES } = require("../config/permissions");

const adminUserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // excluded from queries by default
    },

    role: {
      type: String,
      enum: [ROLES.TRUSTEE, ROLES.CEO, ROLES.MEMBER],
      default: ROLES.MEMBER,
    },

    // Only relevant when role = "member".
    // Trustees and CEOs get full access automatically.
    permissions: {
      type: [String],
      default: [],
    },

    designation: {
      type: String,
      trim: true, // e.g. "Post Moderator", "Tirth Head"
    },

    profilePicture: {
      type: String,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: "" },
  },
  { timestamps: true },
);

adminUserSchema.index({ role: 1, isActive: 1 });

/* ───────────── Password hashing ─────────────
   IMPORTANT: always pass a PLAIN password to create/save.
   This hook does the hashing. Never hash manually beforehand,
   or the password gets double-hashed and login will fail.
------------------------------------------------ */
adminUserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

/* ───────────── Methods ───────────── */

adminUserSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

// Permission check — always true for Trustee and CEO
adminUserSchema.methods.can = function (permission) {
  if (FULL_ACCESS_ROLES.includes(this.role)) return true;
  return this.permissions.includes(permission);
};

// Safe object for the frontend (password stripped out)
adminUserSchema.methods.toSafeJSON = function () {
  const { ALL_PERMISSION_KEYS } = require("../config/permissions");
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    designation: this.designation,
    profilePicture: this.profilePicture,
    isActive: this.isActive,
    // Full-access roles receive the complete list so the frontend's
    // can() check stays consistent with the backend's
    permissions: FULL_ACCESS_ROLES.includes(this.role)
      ? ALL_PERMISSION_KEYS
      : this.permissions,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model("AdminUser", adminUserSchema);