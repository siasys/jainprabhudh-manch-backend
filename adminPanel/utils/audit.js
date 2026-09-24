const AuditLog = require("../model/auditLogModel");

/**
 * Audit entry banata hai. Kabhi throw nahi karega —
 * logging fail ho to main operation nahi rukna chahiye.
 *
 * Usage:
 *   await logAction(req, {
 *     action: "post.delete",
 *     targetType: "Post",
 *     targetId: post._id,
 *     description: `Post delete kiya (${reason})`,
 *   });
 */
const logAction = async (req, { action, targetType, targetId, description, meta }) => {
  try {
    const admin = req.admin;
    await AuditLog.create({
      admin: admin?._id,
      adminName: admin?.name,
      adminRole: admin?.role,
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      description: description || "",
      meta: meta || {},
      ip: req.ip || req.headers["x-forwarded-for"] || "",
    });
  } catch (err) {
    console.error("[adminPanel] audit log failed:", err.message);
  }
};

module.exports = { logAction };