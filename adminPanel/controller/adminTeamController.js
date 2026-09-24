const asyncHandler = require("express-async-handler");
const AdminUser = require("../model/adminUserModel");
const { ALL_PERMISSION_KEYS, ROLES } = require("../config/permissions");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { logAction } = require("../utils/audit");

/* Helper — returns any permission keys that don't exist */
const findInvalidPermissions = (perms = []) =>
  perms.filter((p) => !ALL_PERMISSION_KEYS.includes(p));

/**
 * Can `actor` manage `target`?
 *
 * Rules:
 *  - The Trustee sits at the top — nobody can manage them
 *  - The Trustee can manage everyone else
 *  - A CEO can only manage members they created themselves
 *  - One CEO cannot manage another CEO
 *  - Nobody can manage their own account through these routes
 */
const canManage = (actor, target) => {
  if (target.role === ROLES.TRUSTEE) return false;
  if (String(actor._id) === String(target._id)) return false;

  if (actor.role === ROLES.TRUSTEE) return true;

  if (actor.role === ROLES.CEO) {
    if (target.role === ROLES.CEO) return false;
    return String(target.createdBy) === String(actor._id);
  }

  return false;
};

const NO_ACCESS_MSG = "You don't have permission to manage this member";

/* ───────────── GET /api/admin-panel/team ───────────── */
const listMembers = asyncHandler(async (req, res) => {
  const { search = "", role, status } = req.query;

  const query = {};
  if (search.trim()) {
    query.$or = [
      { name: { $regex: search.trim(), $options: "i" } },
      { email: { $regex: search.trim(), $options: "i" } },
      { designation: { $regex: search.trim(), $options: "i" } },
    ];
  }
  if (role) query.role = role;
  if (status === "active") query.isActive = true;
  if (status === "inactive") query.isActive = false;

  const members = await AdminUser.find(query)
    .populate("createdBy", "name role")
    .sort({ createdAt: -1 });

  return successResponse(
    res,
    members.map((m) => ({
      ...m.toSafeJSON(),
      // raw permissions too — needed by the edit screen's checkboxes
      rawPermissions: m.permissions,
      createdBy: m.createdBy || null,
    })),
    "OK",
  );
});

/* ───────────── GET /api/admin-panel/team/:id ───────────── */
const getMember = asyncHandler(async (req, res) => {
  const member = await AdminUser.findById(req.params.id).populate(
    "createdBy",
    "name role",
  );
  if (!member) return errorResponse(res, "Member not found", 404);

  return successResponse(
    res,
    { ...member.toSafeJSON(), rawPermissions: member.permissions },
    "OK",
  );
});

/* ───────────── POST /api/admin-panel/team ─────────────
   Trustee / CEO only. Only the Trustee can create a CEO. */
const createMember = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    designation,
    role = ROLES.MEMBER,
    permissions = [],
  } = req.body;

  if (!name || !email || !password) {
    return errorResponse(res, "Name, email and password are required", 400);
  }
  if (String(password).length < 6) {
    return errorResponse(res, "Password must be at least 6 characters", 400);
  }

  const exists = await AdminUser.findOne({
    email: String(email).toLowerCase().trim(),
  });
  if (exists) return errorResponse(res, "This email is already registered", 400);

  // Role rules:
  //  - A Trustee is never created through the API (seed script only)
  //  - Only the Trustee can create a CEO
  //  - Everyone else becomes a member
  let finalRole = ROLES.MEMBER;
  if (role === ROLES.CEO && req.admin.role === ROLES.TRUSTEE) {
    finalRole = ROLES.CEO;
  }

  let finalPermissions = [];
  if (finalRole === ROLES.MEMBER) {
    const invalid = findInvalidPermissions(permissions);
    if (invalid.length) {
      return errorResponse(res, `Invalid permissions: ${invalid.join(", ")}`, 400);
    }
    finalPermissions = permissions;
  }

  const member = await AdminUser.create({
    name: name.trim(),
    email: String(email).toLowerCase().trim(),
    phone,
    password, // plain text — the pre-save hook hashes it
    designation,
    role: finalRole,
    permissions: finalPermissions,
    createdBy: req.admin._id,
  });

  await logAction(req, {
    action: "team.create",
    targetType: "AdminUser",
    targetId: member._id,
    description: `Created ${member.name} as ${finalRole}`,
    meta: { permissions: finalPermissions },
  });

  return successResponse(res, member.toSafeJSON(), "Member created", 201);
});

/* ───────────── PUT /api/admin-panel/team/:id ─────────────
   Update basic details */
const updateMember = asyncHandler(async (req, res) => {
  const { name, phone, designation } = req.body;

  const member = await AdminUser.findById(req.params.id);
  if (!member) return errorResponse(res, "Member not found", 404);

  if (!canManage(req.admin, member)) {
    return errorResponse(res, NO_ACCESS_MSG, 403);
  }

  if (name) member.name = name.trim();
  if (phone !== undefined) member.phone = phone;
  if (designation !== undefined) member.designation = designation;
  await member.save();

  await logAction(req, {
    action: "team.update",
    targetType: "AdminUser",
    targetId: member._id,
    description: `Updated details for ${member.name}`,
  });

  return successResponse(res, member.toSafeJSON(), "Member updated");
});

/* ───────────── PUT /api/admin-panel/team/:id/permissions ───────────── */
const updatePermissions = asyncHandler(async (req, res) => {
  const { permissions = [] } = req.body;

  const member = await AdminUser.findById(req.params.id);
  if (!member) return errorResponse(res, "Member not found", 404);

  if (!canManage(req.admin, member)) {
    return errorResponse(res, NO_ACCESS_MSG, 403);
  }

  if (member.role !== ROLES.MEMBER) {
    return errorResponse(
      res,
      "Trustees and CEOs already have full access, so permissions cannot be set for them",
      400,
    );
  }

  const invalid = findInvalidPermissions(permissions);
  if (invalid.length) {
    return errorResponse(res, `Invalid permissions: ${invalid.join(", ")}`, 400);
  }

  const before = [...member.permissions];
  member.permissions = permissions;
  await member.save();

  await logAction(req, {
    action: "team.permissions_update",
    targetType: "AdminUser",
    targetId: member._id,
    description: `Updated permissions for ${member.name} (${permissions.length} granted)`,
    meta: { before, after: permissions },
  });

  return successResponse(res, member.toSafeJSON(), "Permissions updated");
});

/* ───────────── PATCH /api/admin-panel/team/:id/toggle ───────────── */
const toggleActive = asyncHandler(async (req, res) => {
  const member = await AdminUser.findById(req.params.id);
  if (!member) return errorResponse(res, "Member not found", 404);

  if (!canManage(req.admin, member)) {
    return errorResponse(res, NO_ACCESS_MSG, 403);
  }

  member.isActive = !member.isActive;
  await member.save();

  await logAction(req, {
    action: member.isActive ? "team.activate" : "team.deactivate",
    targetType: "AdminUser",
    targetId: member._id,
    description: `${member.isActive ? "Activated" : "Deactivated"} ${member.name}`,
  });

  return successResponse(
    res,
    { isActive: member.isActive },
    member.isActive ? "Member activated" : "Member deactivated",
  );
});

/* ───────────── PUT /api/admin-panel/team/:id/reset-password ───────────── */
const resetMemberPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 6) {
    return errorResponse(res, "Password must be at least 6 characters", 400);
  }

  const member = await AdminUser.findById(req.params.id).select("+password");
  if (!member) return errorResponse(res, "Member not found", 404);

  if (member.role === ROLES.TRUSTEE) {
    return errorResponse(
      res,
      "Nobody can reset the Trustee's password. The Trustee can change it from Settings.",
      403,
    );
  }

  if (!canManage(req.admin, member)) {
    return errorResponse(res, NO_ACCESS_MSG, 403);
  }

  member.password = newPassword;
  await member.save();

  await logAction(req, {
    action: "team.password_reset",
    targetType: "AdminUser",
    targetId: member._id,
    description: `Reset password for ${member.name}`,
  });

  return successResponse(res, null, "Password reset");
});

module.exports = {
  listMembers,
  getMember,
  createMember,
  updateMember,
  updatePermissions,
  toggleActive,
  resetMemberPassword,
};