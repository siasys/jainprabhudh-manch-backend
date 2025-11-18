const mongoose = require("mongoose");

const ScholarshipSchema = new mongoose.Schema(
  {
    categoryType: {
      type: String,
      enum: ["6th-12th", "Graduation", "Post Graduation"],
      required: true,
    },

    // Common Details
    name: { type: String, required: true },
    dob: { type: String, required: true },
    address: { type: String, required: true },
    gender: { type: String, required: true },

    fatherName: { type: String, required: true },
    fatherOccupation: { type: String, required: true },
    fatherMonthlyIncome: { type: Number, required: true },

    contact: { type: String, required: true },
    email: { type: String,},

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


    // Bank Details
    bankDetails: {
      holderName: { type: String, required: true },
      accountNo: { type: String, required: true },
      ifsc: { type: String, required: true },
      bankName: { type: String, required: true },
      branch: { type: String, required: true },
    },

    // Scholarship Amount
    scholarshipAmount: {
      type: Number,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Scholarship", ScholarshipSchema);
