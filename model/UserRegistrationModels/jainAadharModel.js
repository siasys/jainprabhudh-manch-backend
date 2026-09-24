const mongoose = require("mongoose");

// ---------------------------------------------------------------------------
// LOCATION SUB-SCHEMA
// strict:false -> countryConfig se aane wale dynamic field names bhi save honge
//   India:  state, district, pinCode
//   USA:    state, county, zip_code
//   Canada: province, region, postal_code
//   Japan:  prefecture, postal_code
// Naya country add karne par is file ko chhune ki zaroorat nahi.
// ---------------------------------------------------------------------------
const locationSchema = new mongoose.Schema(
  {
    country: {
      type: String,
      required: true,
      enum: [
        "India",
        "United States",
        "United Kingdom",
        "Canada",
        "Australia",
        "New Zealand",
        "Kenya",
        "Tanzania",
        "Uganda",
        "Zambia",
        "Zimbabwe",
        "Malawi",
        "Mozambique",
        "Nigeria",
        "Madagascar",
        "South Africa",
        "Botswana",
        "Mauritius",
        "United Arab Emirates",
        "Qatar",
        "Bahrain",
        "Kuwait",
        "Saudi Arabia",
        "Oman",
        "Israel",
        "Nepal",
        "Sri Lanka",
        "Bangladesh",
        "Myanmar",
        "Thailand",
        "Malaysia",
        "Singapore",
        "Indonesia",
        "Philippines",
        "Vietnam",
        "Hong Kong",
        "Japan",
        "Belgium",
        "Netherlands",
        "Germany",
        "France",
        "Italy",
        "Spain",
        "Austria",
        "Ireland",
        "Switzerland",
        "Sweden",
        "Mexico",
        "Brazil",
        "Panama",
      ],
    },
    city: { type: String, required: true },
    address: { type: String, required: true },
  },
  { _id: false, strict: false, minimize: false },
);

// Declare the Schema for Jain Aadhar Card
const jainAadharSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      default: null,
    },
    jainAadharNumber: {
      type: String,
    },
    name: { type: String },
    pitaOrpatiName: { type: String },
    fatherName: { type: String },
    husbandName: { type: String },
    gender: { type: String },
    dob: { type: String },
    age: { type: String },
    bloodGroup: { type: String },
    contactDetails: {
      countryCode: { type: String, default: "+91" },
      number: { type: String },
      guardiansNumber: { type: String },
      email: { type: String },
    },
    // Location -- sub-schema with strict:false (see locationSchema above)
    location: {
      type: locationSchema,
      required: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    verificationCode: {
      code: { type: String },
      expiresAt: { type: Date },
    },
    marriedStatus: { type: String },
    divorceWidowStatus: { type: String, enum: ["Yes", "No"], default: "No" },
    serveAsOfficeBearer: { type: String, enum: ["Yes", "No"], default: "No" },
    husbandWifeName: { type: String },
    marriageDate: { type: String },
    countSons: { type: Number },
    countDaughters: { type: Number },
    mulJain: { type: String, enum: ["Digamber", "Shwetamber"] },
    panth: {
      type: String,
    },
    gotra: {
      type: String,
    },
    subGotra: {
      type: String,
    },
    subCaste: {
      type: String,
    },
    pitaKaNaam: { type: String },
    mataKaNaam: { type: String },
    brotherCount: { type: String },
    sisterCount: { type: String },
    education: { type: String },
    job: { type: String },
    jobCompanyName: { type: String },
    jobAddress: { type: String },
    jobPosition: { type: String },
    jobAnnualIncom: { type: String },
    business: { type: String },
    businessType: { type: String },
    businessName: { type: String },
    businessAddress: { type: String },
    businessAnnualIncom: { type: String },
    student: { type: String },
    degree: { type: String },
    schoolName: { type: String },
    houseWife: { type: String },
    retired: { type: String },
    religionConvert: { type: String, enum: ["Yes", "No"], default: "No" },
    convertReason: { type: String },
    qrCode: { type: String },
    AadharCard: { type: String },
    userProfile: { type: String },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // New fields for level-specific review
    applicationLevel: {
      type: String,
      enum: [
        "superadmin",
        "foundation",
        "country",
        "state",
        "district",
        "city",
        "area",
      ],
      required: true,
    },
    reviewingSanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
    },
    reviewedBy: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      role: String,
      level: String,
      sanghId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "HierarchicalSangh",
      },
    },
    reviewHistory: [
      {
        action: {
          type: String,
          enum: [
            "submitted",
            "reviewed",
            "approved",
            "rejected",
            "edited",
            "reapplied",
          ],
        },
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        level: {
          type: String,
          enum: [
            "user",
            "admin",
            "superadmin",
            "foundation",
            "country",
            "state",
            "district",
            "city",
            "area",
            "user",
          ],
        },
        sanghId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "HierarchicalSangh",
        },
        remarks: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true },
);
// ✅ INDEXES - Optimized for all countries
jainAadharSchema.index({ userId: 1 });
jainAadharSchema.index({ status: 1 });
jainAadharSchema.index({ jainAadharNumber: 1 });

// Compound indexes for admin dashboards
jainAadharSchema.index({ status: 1, createdAt: -1 });
jainAadharSchema.index({ userId: 1, status: 1 });
jainAadharSchema.index({ applicationLevel: 1, status: 1 });

// ✅ LOCATION INDEXES - Country-specific queries
// By country
jainAadharSchema.index({ "location.country": 1 });
jainAadharSchema.index({ "location.country": 1, status: 1 });

// City queries (works for all countries)
jainAadharSchema.index({ "location.city": 1 });
jainAadharSchema.index({ "location.city": 1, status: 1 });
jainAadharSchema.index({ "location.country": 1, "location.city": 1 });

// India-specific indexes
jainAadharSchema.index({ "location.state": 1 });
jainAadharSchema.index({ "location.state": 1, status: 1 });
jainAadharSchema.index({ "location.district": 1 });
jainAadharSchema.index({ "location.district": 1, status: 1 });
jainAadharSchema.index({ "location.state": 1, "location.district": 1 });

// USA-specific indexes
jainAadharSchema.index({ "location.county": 1 });
jainAadharSchema.index({ "location.county": 1, status: 1 });

// Canada-specific indexes
jainAadharSchema.index({ "location.province": 1 });
jainAadharSchema.index({ "location.region": 1 });
jainAadharSchema.index({ "location.province": 1, status: 1 });

// Japan-specific indexes
jainAadharSchema.index({ "location.prefecture": 1 });
jainAadharSchema.index({ "location.prefecture": 1, status: 1 });

module.exports = mongoose.model("JainAadhar", jainAadharSchema);
