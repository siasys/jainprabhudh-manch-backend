const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["sangh", "panch", "tirth", "sadhu"],
    },

    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
    },
    panchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
    },
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
    },
    sadhuId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sadhu",
    },
    caption: {
      type: String,
      //maxlength: 500,
    },
    media: [
      {
        url: {
          type: String,
          //required: true
        },
        type: {
          type: String,
          enum: ["image", "video"],
        },
        thumbnail: {
          type: String,
        },
      },
    ],
    isBoosted: {
      type: Boolean,
    },

    activeBoost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BoostPlan",
      default: null,
    },

    postType: {
      type: String,
      enum: ["text", "media", "poll"],
      default: "text",
    },
    // Poll fields
    pollQuestion: { type: String },
    pollOptions: [{ type: String }],
    pollDuration: {
      type: String,
      enum: ["1 Day", "1 Week", "1 Month", "Always"],
    },
    pollVotes: {
      type: Map,
      of: [mongoose.Schema.Types.ObjectId],
      default: {},
    },
    votedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    text: {
      type: String,
    },
    hashtags: [{ type: String }],
    // ✅ NEW: Location tagged on post
    postLocation: {
      id: { type: mongoose.Schema.Types.Mixed, default: null },
      name: { type: String, default: null },
      city: { type: String, default: null },
      state: { type: String, default: null },
    },
    // ✅ NEW: Tagged users on post
    taggedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // ✅ NEW: Collaborators with invite status
    collaborators: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        status: {
          type: String,
          enum: ["pending", "accepted", "rejected"],
          default: "pending",
        },
        invitedAt: { type: Date, default: Date.now },
        respondedAt: { type: Date, default: null },
      },
    ],
    // ✅ NEW: Schedule post — kab publish ho + current status
    scheduledAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["published", "scheduled"],
      default: "published",
    },
    watchTime: {
      type: Number,
      default: 0,
    },
    emoji: {
      type: String,
      default: "",
    },
    shareCount: { type: Number, default: 0 },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    comments: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        sanghId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "HierarchicalSangh",
          default: null,
        },
        isSangh: {
          type: Boolean,
          default: false,
        },
        text: {
          type: String,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        emoji: {
          type: String,
          default: "",
        },
        isHidden: {
          type: Boolean,
          default: false,
        },
        community: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Community",
          sparse: true,
        },
        likes: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
        ],

        replies: [
          {
            user: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
            },
            isSangh: { type: Boolean, default: false },
            sanghId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "HierarchicalSangh",
              default: null,
            },

            text: {
              type: String,
            },
            likes: [
              {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
              },
            ],
            createdAt: {
              type: Date,
              default: Date.now,
            },
          },
        ],
        // ── Admin moderation fields ──
        isHidden: {
          type: Boolean,
          default: false,
        },
        hiddenBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "AdminUser",
          default: null,
        },
        hiddenAt: { type: Date, default: null },
        hideReason: { type: String, default: "" },

        isDeleted: {
          type: Boolean,
          default: false,
        },
        deletedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "AdminUser",
          default: null,
        },
        deletedAt: { type: Date, default: null },
        deleteReason: { type: String, default: "" },

        isPinned: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);
// Indexes - grouped for better readability
postSchema.index({ createdAt: -1 });
postSchema.index({ community: 1, createdAt: -1 });
postSchema.index({ "comments.createdAt": -1 });
// Add compound indexes for common query patterns
postSchema.index({ user: 1, createdAt: -1 }); // For user profile posts
postSchema.index({ isHidden: 1, createdAt: -1 }); // For filtering hidden posts
postSchema.index({ user: 1, isHidden: 1 }); // For quickly finding a user's visible posts

// Add text index for search functionality
postSchema.index({ caption: "text" }); // Enables text search on captions

// Virtuals
postSchema.virtual("likeCount").get(function () {
  return this.likes.length;
});

postSchema.virtual("commentCount").get(function () {
  return this.comments.length;
});

// Methods
postSchema.methods.isLikedBy = function (userId) {
  return this.likes.some((id) => id.toString() === userId.toString());
};

postSchema.methods.toggleLike = function (userId) {
  const isLiked = this.isLikedBy(userId);

  if (isLiked) {
    this.likes = this.likes.filter((id) => id.toString() !== userId.toString());
  } else {
    this.likes.push(userId);
  }

  return { isLiked: !isLiked, likeCount: this.likes.length };
};

postSchema.methods.addComment = function (userId, text) {
  const comment = {
    user: userId,
    text,
    createdAt: new Date(),
  };

  this.comments.push(comment);
  return comment;
};

postSchema.methods.findComment = function (commentId) {
  return this.comments.id(commentId);
};

// ✅ NEW: Auto-hide scheduled (future) posts from ALL find queries.
// scheduledAt-based filter — status field pe depend nahi karta (double safety).
// Bypass ke liye: Post.find({...}).setOptions({ includeScheduled: true })
//
// IMPORTANT: `$and` use karte hain (not `$or` at top-level) taaki existing
// queries me jo pehle se `$or` ho (jaise isBoosted filter in getAllPosts),
// wo conflict na kare. MongoDB me top-level $or sirf ek hi ho sakti hai.
postSchema.pre(/^find/, function (next) {
  // Bypass flag check (Mongoose versions ke across compatible)
  const opts = this.options || (this.getOptions && this.getOptions()) || {};
  if (opts.includeScheduled) return next();

  const q = this.getQuery();
  // Agar query me pehle se scheduledAt / status filter hai to touch mat karo
  if (q.scheduledAt !== undefined || q.status !== undefined) {
    return next();
  }

  const now = new Date();
  // Nested $or inside $and — safely combines with any existing top-level $or
  this.and([
    {
      $or: [
        { scheduledAt: null },
        { scheduledAt: { $exists: false } },
        { scheduledAt: { $lte: now } },
      ],
    },
  ]);
  next();
});

const Post = mongoose.model("Post", postSchema);
module.exports = mongoose.model("Post", postSchema);
