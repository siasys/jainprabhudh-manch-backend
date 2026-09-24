/**
 * ADMIN PANEL — Permissions master list
 *
 * This is the single source of truth. When a new feature is added, just add
 * a module here — the frontend "Assign Permissions" screen updates automatically.
 *
 * Naming convention: "<module>.<action>"
 */

const PERMISSIONS = {
  post: {
    label: "Post Management",
    keys: {
      "post.view": "View all posts",
      "post.hide": "Hide / unhide posts",
      "post.delete": "Delete posts",
      "post.restore": "Restore deleted posts",
      "post.pin": "Pin / feature posts",
    },
  },

  story: {
    label: "Story Management",
    keys: {
      "story.view": "View stories (active + archive)",
      "story.delete": "Delete stories",
    },
  },

  comment: {
    label: "Comments",
    keys: {
      "comment.view": "View comments",
      "comment.delete": "Delete comments",
    },
  },

  report: {
    label: "Reports & Moderation",
    keys: {
      "report.view": "View the report queue",
      "report.action": "Take action on reports",
      "report.assign": "Assign reports to members",
    },
  },

  feedback: {
    label: "Suggestions & Complaints",
    keys: {
      "feedback.view": "View suggestions and complaints",
      "feedback.respond": "Reply and change status",
    },
  },

  matrimonial: {
    label: "Matrimonial",
    keys: {
      "matrimonial.view": "View matrimonial profiles",
      "matrimonial.moderate": "Hide profiles and remove photos",
      "matrimonial.membership": "Extend or expire memberships",
    },
  },

  shravak: {
    label: "Shravak Card (Jain Aadhar)",
    keys: {
      "shravak.view": "View card applications",
      "shravak.review": "Approve / reject applications",
    },
  },

  tirth: {
    label: "Tirth Verification",
    keys: {
      "tirth.view": "View tirth applications",
      "tirth.review": "Approve / reject tirth applications",
    },
  },

  // User management is Trustee/CEO only — intentionally not a permission,
  // so it can never be granted to a member.
user: {
    label: "User Management",
    keys: {
      "user.detail": "View a user's full profile",
      "user.moderate": "Remove a user's photo or bio",
      "user.suspend": "Suspend or reactivate accounts",
    },
  },

  team: {
    label: "Admin Team",
    keys: {
      "team.view": "View admin members",
    },
  },

  audit: {
    label: "Audit Log",
    keys: {
      "audit.view": "View the activity log",
    },
  },
};

// Flat array — used for validation
const ALL_PERMISSION_KEYS = Object.values(PERMISSIONS).flatMap((mod) =>
  Object.keys(mod.keys),
);

/**
 * Ready-made role templates.
 * The CEO can apply a whole set in one click, then fine-tune the
 * checkboxes if needed.
 *
 * Remember to add new permissions here too when a module is added.
 */
const PRESETS = [
  {
    key: "full",
    label: "Full Access",
    description: "Same as a CEO — handles every feature",
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    key: "content_moderator",
    label: "Content Moderator",
    description: "Handles posts, stories and comments",
    permissions: [
      "post.view", "post.hide", "post.delete", "post.restore", "post.pin",
      "story.view", "story.delete",
      "comment.view", "comment.delete",
    ],
  },
  {
    key: "report_handler",
    label: "Report Handler",
    description: "Reviews and acts on reports",
    permissions: [
      "report.view", "report.action",
      "post.view", "post.hide", "post.delete",
      "story.view", "story.delete",
      "comment.view", "comment.delete",
    ],
  },

  {
    key: "user_manager",
    label: "User Manager",
    description: "Handles user profiles and account suspensions",
    permissions: ["user.detail", "user.moderate", "user.suspend"],
  },

  {
    key: "support_desk",
    label: "Support Desk",
    description: "Reads and answers user suggestions and complaints",
    permissions: ["feedback.view", "feedback.respond"],
  },


  {
    key: "matrimonial_desk",
    label: "Matrimonial Desk",
    description: "Manages matrimonial profiles and memberships",
    permissions: [
      "matrimonial.view",
      "matrimonial.moderate",
      "matrimonial.membership",
    ],
  },
  
  {
    key: "viewer",
    label: "Read Only",
    description: "Can see everything but change nothing",
    permissions: ALL_PERMISSION_KEYS.filter((k) => k.endsWith(".view")),
  },

  {
    key: "shravak_verifier",
    label: "Shravak Verifier",
    description: "Reviews and approves Shravak Card applications",
    permissions: ["shravak.view", "shravak.review"],
  },
  {
    key: "tirth_verifier",
    label: "Tirth Verifier",
    description: "Reviews and approves Tirth applications",
    permissions: ["tirth.view", "tirth.review"],
  },
];

// Roles
const ROLES = {
  TRUSTEE: "trustee",
  CEO: "ceo",
  MEMBER: "member",
};

// These roles bypass permission checks entirely (they see everything)
const FULL_ACCESS_ROLES = [ROLES.TRUSTEE, ROLES.CEO];

module.exports = {
  PERMISSIONS,
  ALL_PERMISSION_KEYS,
  PRESETS,
  ROLES,
  FULL_ACCESS_ROLES,
};