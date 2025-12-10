const mongoose = require("mongoose");

const boostPlanSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default:null
    },

    accountType: {
      type: String,
      enum: ["business", "sadhu", "tirth"],
      required: true
    },

    /*  LOCATION TARGETING (MULTI-SELECT) */
    targeting: {
      states: [
        {
          type: String
        }
      ],
      districts: [
        {
          type: String
        }
      ],
      cities: [
        {
          type: String
        }
      ]
    },

    /* PLAN DURATION */
    duration: {
      value: {
        type: Number, // 1, 7, 15, 30, 90, 180, 365
      },
      unit: {
        type: String,
        enum: ["day", "month"],
      }
    },

    startDate: {
      type: Date,
      default: Date.now
    },

    endDate: {
      type: Date,
      required: true
    },

    price: {
      type: Number,
      required: true
    },

    /*  PAYMENT PROOF (QR / MANUAL) */
    paymentMode: {
      type: String,
      enum: ["qr", "manual", "razorpay"],
      default: "qr"
    },

    paymentScreenshot: {
      type: String, // image URL
      default: null
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending"
    },

    status: {
      type: String,
      enum: ["active", "expired", "cancelled"],
      default: "active"
    }
  },
  {
    timestamps: true
  }
);

/* ✅ INDEXES */
// boostPlanSchema.index({ status: 1, endDate: 1 });
// boostPlanSchema.index({ "targeting.states": 1 });
// boostPlanSchema.index({ "targeting.districts": 1 });
// boostPlanSchema.index({ "targeting.cities": 1 });

module.exports = mongoose.model("BoostPlan", boostPlanSchema);
