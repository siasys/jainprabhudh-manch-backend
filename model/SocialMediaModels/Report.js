// models/Report.js
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['Pending', 'Reviewed', 'Resolved', 'Rejected'],
      default: 'Pending',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Report', reportSchema);
