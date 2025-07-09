const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    sanghId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HierarchicalSangh'
    },
    projectName: {
      type: String,
      required: true,
      trim: true,
    },
    projectType: {
      type: String,
      trim: true,
    },
    projectArea: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    fundingType: {
      type: String,
      enum: ['self', 'required'],
      required: true,
    },
    beneficiary: {
      type: String,
      trim: true,
    },
    organization: {
      type: String,
      trim: true,
    },
    hasSponsor: {
      type: Boolean,
      default: false,
    },
    sponsorName: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    assignedToSangh: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HierarchicalSangh'
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
 
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Project', projectSchema);
