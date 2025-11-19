const mongoose = require("mongoose");

const ScholarshipSchema = new mongoose.Schema(
  {
    createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
},
    categoryType: {
      type: String,
      enum: ["6th-12th", "Graduation", "Post Graduation"],
      required: true,
    },
    shravakId:{
      type: String
    },
    // Common Details
    name: { type: String },
    dob: { type: String },
    address: { type: String },
    gender: { type: String },

    fatherName: { type: String},
    fatherOccupation: { type: String },
    fatherMonthlyIncome: { type: Number },

    contact: { type: String },
    email: { type: String},

    // 6th–12th specific
    runningClass: { type: String },
    schoolName: { type: String },

    // Graduation specific
    degree: { type: String },
    collegeName: { type: String },
    yearOfStudy : {type : String},
    // Post Graduation specific
    postGraduationDegree: { type: String },

   lastYearMarksheet: [
    {
        fileUrl: String,
        fileType: String,
    }
    ],
   scholarshipDetails: {
      type: {
        type: String,
      },
      declaration: {
        type: String,   // why should we select you?
      },
      reason: {
        type: String,   // why do you need scholarship?
      }
    },
  status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Scholarship", ScholarshipSchema);
