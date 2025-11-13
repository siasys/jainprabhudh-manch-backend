const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema(
  {
    // 🔹 Kisne banaya (Sangh user)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // 🔹 Sangh ID
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
      required: true,
    },

    // Organized by (which Sangh)
    organizedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
    },

    //  Activity ka naam
    activityName: {
      type: String,
      required: true,
      trim: true,
    },

    // 🔹 Short description
    shortDescription: {
      type: String,
      trim: true,
    },

    // Rules / Guidelines
    rules: {
      type: String,
      trim: true,
    },

    // Participants full detail
    participants: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        fullName: { type: String },
        phoneNumber: { type: String },
        state: { type: String },
        district: { type: String },
        city: { type: String },
        activityMarks: {
          judge1: { type: Number, default: 0 },
          judge2: { type: Number, default: 0 },
          judge3: { type: Number, default: 0 },
          finalMarks: { type: Number, default: 0 },
        },

        // 🔹 Upload field added here
        uploadActivity: [
          {
            fileUrl: { type: String },
            fileType: {
              type: String,
              enum: ["image/jpeg", "image/png", "application/pdf"],
            },
            uploadedAt: { type: Date, default: Date.now },
          },
        ],
      },
    ],

    judges: [
      {
        judgeLabel: {
          type: String,
          enum: ["judge1", "judge2", "judge3"], // only 3 judges
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
    // 🔹 Sponsors (with name & address)
    sponsors: [
      {
        name: { type: String, required: true, trim: true },
        address: { type: String, trim: true },
      },
    ],
    //Price Distribution
    priceDistribution: {
      firstPrice: { type: String },
      secondPrice: { type: String},
      thirdPrice: { type: String},
    },

    // Deadline
    deadline: {
      type: Date,
      required: true,
    },
 winners: {
  firstWinner: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    marks: { type: Number, default: 0 },
  },
  secondWinner: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    marks: { type: Number, default: 0 },
  },
  thirdWinner: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    marks: { type: Number, default: 0 },
  },
},

    //Uploaded media (jpg/png/pdf)
    uploadActivity: [
      {
        fileUrl: { type: String, required: true },
        fileType: {
          type: String,
          enum: ["image/jpeg", "image/png", "application/pdf"],
        },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Activity", activitySchema);
