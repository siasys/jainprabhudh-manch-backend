const mongoose = require('mongoose');

const commentReportSchema = new mongoose.Schema({
  
  postId:{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  commentId: {
     type: String,
  },
  reportType:{
    type: String,
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

module.exports = mongoose.model('CommentReport', commentReportSchema);
