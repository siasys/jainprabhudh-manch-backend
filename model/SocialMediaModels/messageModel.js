const mongoose = require("mongoose");
const crypto = require("crypto");

// Encryption configuration
const ENCRYPTION_KEY =
  process.env.MESSAGE_ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
const IV_LENGTH = 16;

const KEY_BUFFER = Buffer.from(
  ENCRYPTION_KEY.padEnd(64, "0").slice(0, 64),
  "hex",
);
const ENCRYPTED_REGEX = /^[0-9a-f]{32}:[0-9a-f]+$/i;
const isEncrypted = (text) =>
  typeof text === "string" && ENCRYPTED_REGEX.test(text);

// Convert hex key to buffer of correct length
const getKeyBuffer = (hexKey) => {
  // Ensure the hex key is exactly 64 characters (32 bytes)
  const normalizedKey = hexKey.padEnd(64, "0").slice(0, 64);
  return Buffer.from(normalizedKey, "hex");
};

// Encryption/Decryption functions
function encrypt(text) {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getKeyBuffer(ENCRYPTION_KEY);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
  } catch (error) {
    console.error("Encryption error:", error);
    throw error;
  }
}

function decrypt(text) {
  if (!isEncrypted(text)) return text;
  try {
    const [ivHex, dataHex] = text.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      KEY_BUFFER,
      Buffer.from(ivHex, "hex"),
    );
    let decrypted = decipher.update(Buffer.from(dataHex, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    return text;
  }
}

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
      default: null,
    },
    senderType: { type: String, enum: ["user", "sangh"], default: "user" },
    receiverType: { type: String, enum: ["user", "sangh"], default: "user" },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: false,
    },
    message: {
      type: String,
      default: "",
      trim: true,
    },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post" },
    messageType: {
      type: String,
      default: "post",
    },

    // Media attachments (only images)
    attachments: [
      {
        type: {
          type: String,
          enum: ["image", "video", "file", "text", "poll"],
          required: true,
        },
        url: {
          type: String,
          // required: true
        },
        name: String, // Original file name
        size: Number, // File size in bytes
      },
    ],
    documentImage: {
      type: String,
      default: null,
    },
    audioUpload: {
      type: String,
      default: null,
    },
    contact: {
      name: { type: String, default: "" },
      phoneNumber: { type: String, default: "" },
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
      index: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    isDelivered: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    readAt: {
      type: Date,
    },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },
    // For deleted messages
    isDeleted: {
      type: Boolean,
      default: false,
    },
    isBlockedBySender: {
      type: Boolean,
      default: false,
    },
    isBlockedByReceiver: {
      type: Boolean,
      default: false,
    },
    deleteAt: { type: Date, default: null },
    // For reply feature
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
  },
  { timestamps: true },
);

// Indexes for common queries
messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, isRead: 1 });
messageSchema.index({ receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, sender: 1, isRead: 1 });

// Method to mark message as read
messageSchema.methods.markAsRead = async function () {
  if (!this.isRead) {
    this.isRead = true;
    this.status = "read";
    this.readAt = new Date();
    await this.save();
  }
};
// Method to soft delete message
messageSchema.methods.softDelete = async function () {
  this.isDeleted = true;
  this.deletedAt = new Date();
  await this.save();
};

messageSchema.pre("save", function (next) {
  if (
    this.isModified("message") &&
    this.message &&
    !isEncrypted(this.message)
  ) {
    this.message = encrypt(this.message);
  }
  next();
});

messageSchema.post("find", function (docs) {
  if (!Array.isArray(docs)) return;
  docs.forEach((doc) => {
    if (doc.message) {
      doc.message = decrypt(doc.message);
    }
  });
});

messageSchema.post("findOne", function (doc) {
  if (doc && doc.message) {
    doc.message = decrypt(doc.message);
  }
});

// Add virtual for decrypted message
messageSchema.virtual("decryptedMessage").get(function () {
  return this.message ? decrypt(this.message) : "";
});

module.exports = {
  Message: mongoose.model("Message", messageSchema),
  encrypt,
  decrypt,
};
