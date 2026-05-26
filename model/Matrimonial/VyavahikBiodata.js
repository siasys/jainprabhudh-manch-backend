const mongoose = require("mongoose");

const vyavahikBiodataSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    jainShravak: {
      type: String,
    },
    type: {
      type: String,
    },
    name: {
      type: String,
    },
    gender: {
      type: String,
    },
    mobileNumber: {
      type: String,
    },
    age: {
      type: String,
    },
    dob: {
      type: Date,
    },
    dobTime: {
      type: String,
    },
    dobPlace: {
      type: String,
    },
    weight: {
      type: Number,
    },
    height: {
      type: Number,
    },
    bloodGroup: {
      type: String,
    },
    dietPreference: {
      type: String,
    },
    complexion: {
      type: String,
    },
    hobbies: {
      type: String,
    },
    physicalCondition: {
      type: String, // "Normal" or "Special Abled"
      enum: ["Normal", "Special Abled"],
    },

    physicalConditionDescribe: {
      type: String,
    },
    education: {
      type: String,
    },
    collegeName: {
      type: String,
    },
    occupationType: {
      type: String,
    },
    organization: {
      type: String,
    },
    employementType: {
      type: String,
    },
    annualIncome: {
      type: String,
    },
    workLocation: {
      type: String,
    },
    mulJain: {
      type: String,
    },
    panth: {
      type: String,
    },
    caste: {
      type: String,
    },
    subCaste: {
      type: String,
    },
    gotra: {
      type: String,
    },
    subGotra: {
      type: String,
    },
    mamaGotra: {
      type: String,
    },
    manglik: {
      type: String,
    },
    motherTongue: {
      type: String,
    },
    familyInfo: {
      fatherName: {
        type: String,
      },
      fatherOccupation: {
        type: String,
      },
      motherName: {
        type: String,
      },
      motherOccupation: {
        type: String,
      },
      brothers: [
        {
          name: { type: String }, // brother ka naam
          married: { type: String }, // yes/no
          wifeName: { type: String }, // agar married hai to wife name
          occupation: { type: String }, // unmarried brother ke liye
        },
      ],
      sisters: [
        {
          name: { type: String }, // sister ka naam
          married: { type: String }, // yes/no
          husbandName: { type: String }, // married hai to husband ka naam
          location: { type: String }, // married sister ke liye husband location
          occupation: { type: String }, // unmarried sister ke liye
        },
      ],
      nativePlace: {
        type: String,
      },
      familyType: {
        type: String,
      },
      familyIncome: {
        type: String,
      },
    },
    addressInfo: {
      country: {
        type: String,
        default: "India",
      },
      state: {
        type: String,
      },
      district: {
        type: String,
      },
      city: {
        type: String,
      },
      address: {
        type: String,
      },
    },
    contactInfo: {
      number: {
        type: String,
      },
      contactPerson: {
        type: String,
      },
      alternativeNumber: {
        type: String,
      },
      contactNameRelation: {
        type: String,
      },
      email: {
        type: String,
      },
    },
    marriageInfo: {
      marriageType: {
        type: String,
        enum: ["Single", "Divorced", "Widowed/widower"],
      },

      //  Divorce Details (Only for Divorced)
      divorcedDetails: {
        divorcedCompleted: { type: String },
        reasonForDivorce: { type: String },
        divorceCertificate: { type: String },
        spouseName: { type: String },
        spouseFatherName: { type: String },
        spouseMotherName: { type: String },
        numberOfChildren: { type: Number },
      },

      //  Widowed/Widower Details
      widowedDetails: {
        reasonSpouseDeath: { type: String },
        spouseName: { type: String },
        spouseFatherName: { type: String },
        spouseMotherName: { type: String },
        numberOfChildren: { type: Number },
      },
    },

    passportPhoto: {
      type: String,
    },
    fullPhoto: {
      type: String,
    },
    familyPhoto: {
      type: String,
    },
    educationCertificate: {
      type: String,
    },
    birthCertificate: {
      type: String,
    },
    healthCertificate: {
      type: String,
    },
    healthReport: {
      wearsSpectacles: { type: String, enum: ["yes", "no"], default: "no" },
      diabetes: { type: String, enum: ["yes", "no"], default: "no" },
      bloodPressure: { type: String, enum: ["yes", "no"], default: "no" },
      thyroid: { type: String, enum: ["yes", "no"], default: "no" },
      asthma: { type: String, enum: ["yes", "no"], default: "no" },
      migraine: { type: String, enum: ["yes", "no"], default: "no" },
      heartIssue: { type: String, enum: ["yes", "no"], default: "no" },
      hearingIssue: { type: String, enum: ["yes", "no"], default: "no" },
      skinIssue: { type: String, enum: ["yes", "no"], default: "no" },
      anyAddiction: { type: String, enum: ["yes", "no"], default: "no" },
      previousSurgery: { type: String, enum: ["yes", "no"], default: "no" },
      tongueIssue: { type: String, enum: ["yes", "no"], default: "no" },
      menstrualIssue: { type: String, enum: ["yes", "no"], default: "no" }, // "yes"/"no"
    },
    paymentScreenshot: {
      type: String,
    },
    partnerPreference: {
      type: String,
    },
    specialInformation: {
      type: String,
    },
    // paymentStatus: {
    //   type: String,
    //   enum: ['pending', 'paid', 'failed'],
    //   default: 'pending'
    // },
    // paymentId: {
    //   type: String,
    //   sparse: true
    // },
    isVisible: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("VyavahikBiodata", vyavahikBiodataSchema);

// const mongoose = require("mongoose");

// // ─── Vyavahik Biodata Schema ──────────────────────────────────────────────────
// const vyavahikBiodataSchema = new mongoose.Schema(
//   {
//     userId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//     },

//     // ─── Profile Type ───────────────────────────────────────────
//     profile: {
//       type: String,
//       enum: ["mySelf", "someoneElse"],
//     },

//     // filled only if profile === 'someoneElse'
//     relationWithCandidate: { type: String },
//     creatorName: { type: String },

//     // ─── Basic Info ──────────────────────────────────────────────
//     shravakId: { type: String },
//     jainShravak: { type: String },
//     fullName: { type: String },
//     gender: { type: String },
//     dob: { type: Date },
//     timeOfBirth: { type: String },
//     birthPlace: { type: String },

//     // ─── Personal Details ────────────────────────────────────────
//     height: { type: Number }, // in cm
//     complexion: { type: String },
//     dietPreference: { type: String }, // veg / jain / vegan etc.
//     hobbies: { type: String },
//     physicalCondition: {
//       type: String,
//       enum: ["Normal", "Special Abled"],
//     },
//     physicalConditionDescribe: { type: String },

//     // ─── Marriage Info ───────────────────────────────────────────
//     marriageInfo: {
//       marriageType: {
//         type: String,
//         enum: ["Single", "Divorced", "Widowed/widower"],
//       },

//       divorcedDetails: {
//         isDivorceComplete: { type: String },
//         reasonForDivorce: { type: String },
//         divorceCertificate: { type: String }, // file URL
//         spouseName: { type: String },
//         spouseFatherName: { type: String },
//         spouseMotherName: { type: String },
//         numberOfChildren: { type: Number },
//       },

//       widowedDetails: {
//         spouseName: { type: String },
//         spouseFatherName: { type: String },
//         spouseMotherName: { type: String },
//         reasonSpouseDeath: { type: String },
//         numberOfChildren: { type: Number },
//       },
//     },

//     // ─── Education ───────────────────────────────────────────────
//     education: {
//       highestEducation: { type: String },
//       collegeUniversity: { type: String },
//       degreeName: { type: String },
//       yearOfPassing: { type: String },
//       educationCertificate: { type: String }, // file URL
//     },

//     // ─── Work ────────────────────────────────────────────────────
//     workInfo: {
//       workStatus: {
//         type: String,
//         enum: ["Employed", "SelfEmployed", "Unemployed"],
//       },
//       companyName: { type: String }, // for Employed
//       businessName: { type: String }, // for SelfEmployed
//       workingIndustry: { type: String },
//       workLocation: { type: String },
//       annualIncome: { type: String },
//     },

//     // ─── Family Background ───────────────────────────────────────
//     familyInfo: {
//       fatherName: { type: String },
//       fatherOccupation: { type: String },
//       motherName: { type: String },
//       motherOccupation: { type: String },
//       nativePlace: { type: String },
//       familyType: { type: String },
//       familyIncome: { type: String },
//       noOfBrothers: { type: Number },
//       noOfSisters: { type: Number },
//     },

//     // ─── Religion & Community ────────────────────────────────────
//     communityInfo: {
//       mulJain: { type: String },
//       panth: { type: String },
//       gotra: { type: String },
//       subGotra: { type: String },
//       caste: { type: String },
//       subCaste: { type: String },
//       mamaGotra: { type: String },
//       manglik: { type: String },
//       motherTongue: { type: String },
//     },

//     // ─── Address ─────────────────────────────────────────────────
//     addressInfo: {
//       country: { type: String, default: "India" },
//       state: { type: String },
//       district: { type: String },
//       city: { type: String },
//       fullAddress: { type: String },
//     },

//     // ─── Contact Details ─────────────────────────────────────────
//     contactInfo: {
//       mobileNumber: { type: String },
//       contactPerson: { type: String },
//       email: { type: String },
//       alternativeNumber: { type: String },
//       contactPersonRelation: { type: String },
//     },

//     // ─── Uploaded Photos ─────────────────────────────────────────
//     uploadedPhotos: [
//       {
//         label: { type: String }, // e.g. "passport", "full", "family"
//         url: { type: String },
//       },
//     ],

//     // ─── Partner Preference ──────────────────────────────────────
//     partnerPreference: {
//       preferredAgeFrom: { type: Number },
//       preferredAgeTo: { type: Number },
//       heightFrom: { type: Number }, // in cm
//       heightTo: { type: Number },
//       incomePreference: { type: String },
//       maritalStatus: { type: String }, // Single / Divorced / Any
//       educationPreference: { type: String },
//       locationPreference: { type: String },
//       additionalPreference: { type: String },
//     },

//     isVisible: { type: Boolean, default: false },

//     // ─── Liked Profiles ──────────────────────────────────────────
//     // profiles jisko is user ne like kiya
//     likedProfiles: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "VyavahikBiodata",
//       },
//     ],

//     // ─── Interests Sent (maine kisiko interest bheja) ─────────────
//     interestsSent: [
//       {
//         profileId: {
//           type: mongoose.Schema.Types.ObjectId,
//           ref: "VyavahikBiodata",
//           required: true,
//         },
//         status: {
//           type: String,
//           enum: ["pending", "accepted", "rejected"],
//           default: "pending",
//         },
//         message: { type: String }, // optional note
//         sentAt: { type: Date, default: Date.now },
//       },
//     ],

//     // ─── Interests Received (koi mujhe interest bheja) ────────────
//     interestsReceived: [
//       {
//         profileId: {
//           type: mongoose.Schema.Types.ObjectId,
//           ref: "VyavahikBiodata",
//           required: true,
//         },
//         status: {
//           type: String,
//           enum: ["pending", "accepted", "rejected"],
//           default: "pending",
//         },
//         message: { type: String }, // optional note from sender
//         receivedAt: { type: Date, default: Date.now },
//       },
//     ],
//   },
//   { timestamps: true },
// );

// const VyavahikBiodata = mongoose.model(
//   "VyavahikBiodata",
//   vyavahikBiodataSchema,
// );

// module.exports = { VyavahikBiodata };