const mongoose = require('mongoose');

const RojgarRecruiteeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jainAadhar: {
      type: String,
    },
    jobType: {
      type: String,
      default: 'recruitee',
    },
    candidateName: {
      type: String,
    },
    education: {
      type: String,
    },
    field: {
      type: String,
    },
    experience: {
      type: String,
    },
    gender: {
      type: String,
    },
    candidateResume:{
      type: String,
    },
  },
  { timestamps: true }
);

const RojgarRecruitee = mongoose.model('RojgarRecruitee', RojgarRecruiteeSchema);

module.exports = RojgarRecruitee;
