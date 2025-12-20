const mongoose = require('mongoose');

const jainVyaparSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
businessCode:{
    type: String,
},
  businessName: {
    type: String,
  },

  incorporationYear: String,

  businessType: String,

  businessCategory: String,

  description: String,

  specialOffer: String,

  location: {
    country: {
      type: String,
      default: 'India'
    },
    state: String,
    district: String,
    city: String,
    address: String
  },

  ownerName: String,

  contactPerson: String,

  alternativeNumber: String,
  email: String,
  businessLogo: String,
  photos: [
    {
      url: String,
      caption: String
    }
  ],

//   documents: [
//     {
//       url: String,
//       type: String,
//       name: String
//     }
//   ],

  legalLicences: [
    {
      name: String,
      number: String
    }
  ],

  // ✅ REVIEW FLOW (NEW)
  applicationLevel: {
    type: String,
    enum: ['superadmin','foundation', 'country', 'state', 'district', 'city', 'area'],
    required: true,
  },

  reviewingSanghId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HierarchicalSangh'
  },

  applicationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },

  reviewNotes: {
    text: String,
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: Date
  },

//   citySanghId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'HierarchicalSangh',
//   },

  status: {
    type: String,
    enum: ['inactive', 'active'],
    default: 'active'
  }

}, {
  timestamps: true
});

module.exports = mongoose.model('JainVyapar', jainVyaparSchema);
