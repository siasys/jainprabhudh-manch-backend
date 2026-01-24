const mongoose = require('mongoose');

const suggestionComplaintSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['suggestion', 'complaint', 'request'],
      required: true
    },

    subject: {
      type: String,
      required: true
    },

    description: {
      type: String,
      required: true
    },

    recipient: {
      type: {
        type: String,
        enum: ['superadmin'],
        required: true
      },
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      }
    },

    status: {
      type: String,
      enum: ['pending', 'in-review', 'resolved'],
      default: 'pending'
    },

    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    response: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

/// 🔍 Indexes
suggestionComplaintSchema.index({ status: 1 });
suggestionComplaintSchema.index({ type: 1 });
suggestionComplaintSchema.index({ submittedBy: 1 });
suggestionComplaintSchema.index({ 'recipient.type': 1 });
suggestionComplaintSchema.index({ createdAt: -1 });
suggestionComplaintSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model(
  'SuggestionComplaint',
  suggestionComplaintSchema
);
