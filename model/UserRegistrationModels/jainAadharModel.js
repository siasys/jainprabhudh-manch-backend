const mongoose = require('mongoose');

// Declare the Schema for Jain Aadhar Card
const jainAadharSchema = new mongoose.Schema(
  {
    userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
           default: null
    },
    jainAadharNumber:{
      type:String
    },
    name: { type: String },
    pitaOrpatiName: { type: String },
    gender:{type:String},
    dob: {type: String },
    age: { type: String },
    bloodGroup: {type: String},
    contactDetails: {
      number: { type: String },
      guardiansNumber: { type: String },
      email: { type: String },
    },
    location: {
      country: { type: String, required: true, default: 'India' },
      state: String,
      district: String,
      address: String,
      pinCode: String
    },
     isEmailVerified: {
      type: Boolean,
      default: false
    },
    verificationCode: {
      code: { type: String },
      expiresAt: { type: Date }
    },
    marriedStatus: { type: String },
    husbandWifeName: { type: String },
    marriageDate: { type: String },
    countSons: { type: Number },
    sonNames: [{ type: String }],
    countDaughters: { type: Number },
    daughterNames: [{ type: String }],
    mulJain: { type: String, enum: ['Digamber', 'Shwetamber'] },
    panth: {
      type:String
    },
    pitaKaNaam: { type: String },
    mataKaNaam: { type: String },
    brotherCount: { type: String },
    sisterCount: { type: String },
   brother: [{ type: String }],
   sister: [{ type: String }],
    education: { type: String },
    job: { type: String },
    jobCompanyName: { type: String },
    jobAddress: { type: String },
    jobPosition: {type:String},
    jobAnnualIncom : {type:String},
    business: { type: String },
    businessType: {type:String},
    businessName:{type: String},
    businessAddress:{type: String},
    businessAnnualIncom : {type:String},
    student : {type:String},
    degree : {type:String},
    schoolName : {type:String},
    houseWife : {type:String},
    retired : {type:String},
   religionConvert: { type: String, enum: ['Yes', 'No'], default: 'No' },
   convertReason: { type: String },
    qrCode: { type: String },
    AadharCard: { type: String },
    userProfile: { type: String },
    status: {
      type: String,
      enum: ['pending', 'approved','rejected'],
      default: 'pending',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    // New fields for level-specific review
    applicationLevel: {
      type: String,
      enum: ['superadmin','foundation', 'country', 'state', 'district', 'city', 'area'],
      required: true
    },
    reviewingSanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh'
    },
    reviewedBy: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      role: String,
      level: String,
      sanghId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchicalSangh'
      }
    },
    reviewHistory: [{
      action: {
        type: String,
        enum: ['submitted', 'reviewed', 'approved', 'rejected', 'edited', 'reapplied']
      },
      by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      level: {
        type: String,
        enum: ['superadmin','foundation', 'country', 'state', 'district', 'city', 'area', 'user']
      },
      sanghId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchicalSangh'
      },
      remarks: String,
      timestamp: {
        type: Date,
        default: Date.now
      }
    }],

  },
  { timestamps: true }
);
// Optimize indexes for common query patterns
jainAadharSchema.index({ userId: 1 });
jainAadharSchema.index({ status: 1 });
jainAadharSchema.index({ phoneNumber: 1 });
// Add compound indexes for common query patterns
jainAadharSchema.index({ status: 1, createdAt: -1 }); // For admin dashboards listing applications by status and date
jainAadharSchema.index({ userId: 1, status: 1 });

// Add indexes for efficient querying
jainAadharSchema.index({ applicationLevel: 1, status: 1 });
jainAadharSchema.index({ 'location.state': 1, status: 1 });
jainAadharSchema.index({ 'location.district': 1, status: 1 });
jainAadharSchema.index({ 'location.city': 1, status: 1 });

module.exports = mongoose.model('JainAadhar', jainAadharSchema);
