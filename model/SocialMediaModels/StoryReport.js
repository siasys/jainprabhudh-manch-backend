// models/SocialMediaModels/StoryReport.js
const mongoose = require('mongoose');

const storyReportSchema = new mongoose.Schema({
  storyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Story',
    required: true
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Reviewed'],
    default: 'Pending'
  }
}, { timestamps: true });

module.exports = mongoose.model('StoryReport', storyReportSchema);
