// const mongoose = require("mongoose");

// const vyavahikBiodataSchema = new mongoose.Schema(
//   {
//     userId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//     },
//     jainShravak: {
//       type: String,
//     },
//     type: {
//       type: String,
//     },
//     name: {
//       type: String,
//     },
//     gender: {
//       type: String,
//     },
//     mobileNumber: {
//       type: String,
//     },
//     age: {
//       type: String,
//     },
//     dob: {
//       type: Date,
//     },
//     dobTime: {
//       type: String,
//     },
//     dobPlace: {
//       type: String,
//     },
//     weight: {
//       type: Number,
//     },
//     height: {
//       type: Number,
//     },
//     bloodGroup: {
//       type: String,
//     },
//     dietPreference: {
//       type: String,
//     },
//     complexion: {
//       type: String,
//     },
//     hobbies: {
//       type: String,
//     },
//     physicalCondition: {
//       type: String, // "Normal" or "Special Abled"
//       enum: ["Normal", "Special Abled"],
//     },

//     physicalConditionDescribe: {
//       type: String,
//     },
//     education: {
//       type: String,
//     },
//     collegeName: {
//       type: String,
//     },
//     occupationType: {
//       type: String,
//     },
//     organization: {
//       type: String,
//     },
//     employementType: {
//       type: String,
//     },
//     annualIncome: {
//       type: String,
//     },
//     workLocation: {
//       type: String,
//     },
//     mulJain: {
//       type: String,
//     },
//     panth: {
//       type: String,
//     },
//     caste: {
//       type: String,
//     },
//     subCaste: {
//       type: String,
//     },
//     gotra: {
//       type: String,
//     },
//     subGotra: {
//       type: String,
//     },
//     mamaGotra: {
//       type: String,
//     },
//     manglik: {
//       type: String,
//     },
//     motherTongue: {
//       type: String,
//     },
//     familyInfo: {
//       fatherName: {
//         type: String,
//       },
//       fatherOccupation: {
//         type: String,
//       },
//       motherName: {
//         type: String,
//       },
//       motherOccupation: {
//         type: String,
//       },
//       brothers: [
//         {
//           name: { type: String }, // brother ka naam
//           married: { type: String }, // yes/no
//           wifeName: { type: String }, // agar married hai to wife name
//           occupation: { type: String }, // unmarried brother ke liye
//         },
//       ],
//       sisters: [
//         {
//           name: { type: String }, // sister ka naam
//           married: { type: String }, // yes/no
//           husbandName: { type: String }, // married hai to husband ka naam
//           location: { type: String }, // married sister ke liye husband location
//           occupation: { type: String }, // unmarried sister ke liye
//         },
//       ],
//       nativePlace: {
//         type: String,
//       },
//       familyType: {
//         type: String,
//       },
//       familyIncome: {
//         type: String,
//       },
//     },
//     addressInfo: {
//       country: {
//         type: String,
//         default: "India",
//       },
//       state: {
//         type: String,
//       },
//       district: {
//         type: String,
//       },
//       city: {
//         type: String,
//       },
//       address: {
//         type: String,
//       },
//     },
//     contactInfo: {
//       number: {
//         type: String,
//       },
//       contactPerson: {
//         type: String,
//       },
//       alternativeNumber: {
//         type: String,
//       },
//       contactNameRelation: {
//         type: String,
//       },
//       email: {
//         type: String,
//       },
//     },
//     marriageInfo: {
//       marriageType: {
//         type: String,
//         enum: ["Single", "Divorced", "Widowed/widower"],
//       },

//       //  Divorce Details (Only for Divorced)
//       divorcedDetails: {
//         divorcedCompleted: { type: String },
//         reasonForDivorce: { type: String },
//         divorceCertificate: { type: String },
//         spouseName: { type: String },
//         spouseFatherName: { type: String },
//         spouseMotherName: { type: String },
//         numberOfChildren: { type: Number },
//       },

//       //  Widowed/Widower Details
//       widowedDetails: {
//         reasonSpouseDeath: { type: String },
//         spouseName: { type: String },
//         spouseFatherName: { type: String },
//         spouseMotherName: { type: String },
//         numberOfChildren: { type: Number },
//       },
//     },

//     passportPhoto: {
//       type: String,
//     },
//     fullPhoto: {
//       type: String,
//     },
//     familyPhoto: {
//       type: String,
//     },
//     educationCertificate: {
//       type: String,
//     },
//     birthCertificate: {
//       type: String,
//     },
//     healthCertificate: {
//       type: String,
//     },
//     healthReport: {
//       wearsSpectacles: { type: String, enum: ["yes", "no"], default: "no" },
//       diabetes: { type: String, enum: ["yes", "no"], default: "no" },
//       bloodPressure: { type: String, enum: ["yes", "no"], default: "no" },
//       thyroid: { type: String, enum: ["yes", "no"], default: "no" },
//       asthma: { type: String, enum: ["yes", "no"], default: "no" },
//       migraine: { type: String, enum: ["yes", "no"], default: "no" },
//       heartIssue: { type: String, enum: ["yes", "no"], default: "no" },
//       hearingIssue: { type: String, enum: ["yes", "no"], default: "no" },
//       skinIssue: { type: String, enum: ["yes", "no"], default: "no" },
//       anyAddiction: { type: String, enum: ["yes", "no"], default: "no" },
//       previousSurgery: { type: String, enum: ["yes", "no"], default: "no" },
//       tongueIssue: { type: String, enum: ["yes", "no"], default: "no" },
//       menstrualIssue: { type: String, enum: ["yes", "no"], default: "no" }, // "yes"/"no"
//     },
//     paymentScreenshot: {
//       type: String,
//     },
//     partnerPreference: {
//       type: String,
//     },
//     specialInformation: {
//       type: String,
//     },
//     // paymentStatus: {
//     //   type: String,
//     //   enum: ['pending', 'paid', 'failed'],
//     //   default: 'pending'
//     // },
//     // paymentId: {
//     //   type: String,
//     //   sparse: true
//     // },
//     isVisible: {
//       type: Boolean,
//       default: false,
//     },
//   },
//   { timestamps: true },
// );

// module.exports = mongoose.model("VyavahikBiodata", vyavahikBiodataSchema);

const mongoose = require("mongoose");

// ─── Vyavahik Biodata Schema ───────────────────────────────────
const vyavahikBiodataSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // ─── Profile Type ──────────────────────────────────────────
    profile: {
      type: String,
      enum: ["mySelf", "someoneElse"],
    },

    // filled only if profile === 'someoneElse'
    relationWithCandidate: { type: String },
    creatorName: { type: String },
    creatorShravakId: { type: String }, // creator ka apna Jain Shravak ID
    creatorMobile: { type: String }, // creator ka mobile (bina country code)
    creatorCountryCode: { type: String }, // e.g. +91

    // ─── Basic Info ──────────────────────
    shravakId: { type: String },
    jainShravak: { type: String },
    name: { type: String },
    gender: { type: String },
    dob: { type: Date },
    age: { type: String },
    timeOfBirth: { type: String },
    birthPlace: { type: String },

    // ─── Personal Details ────────────────────────────────────────
    height: { type: Number }, // in cm
    complexion: { type: String },
    dietPreference: { type: String }, // veg / jain / vegan etc.
    hobbies: { type: String }, // comma wali list: "Reading, Music"
    weight: { type: Number }, // in kg (max 3 digit)
    smoking: { type: String, enum: ["Yes", "No"] },
    drinking: { type: String, enum: ["Yes", "No"] },
    aboutMySelf: {
      type: String,
    },
    physicalCondition: {
      type: String,
      enum: ["Normal", "Special Abled"],
    },
    physicalConditionDescribe: { type: String },

    // ─── Marriage Info ───────────────────────────────────────────
    marriageInfo: {
      marriageType: {
        type: String,
        enum: ["Single", "Divorced", "Widowed/widower"],
      },

      divorcedDetails: {
        isDivorceComplete: { type: String },
        reasonForDivorce: { type: String },
        divorceCertificate: { type: String },
        spouseName: { type: String },
        spouseFatherName: { type: String },
        spouseMotherName: { type: String },
        numberOfChildren: { type: Number },
      },

      widowedDetails: {
        spouseName: { type: String },
        spouseFatherName: { type: String },
        spouseMotherName: { type: String },
        reasonSpouseDeath: { type: String },
        numberOfChildren: { type: Number },
      },
    },

    // ─── Education ───────────────────
    education: {
      highestEducation: { type: String },
      collegeUniversity: { type: String },
      degreeName: { type: String },
      yearOfPassing: { type: String },
      extraQualification: { type: String }, // ✅ 10th/12th tak walon ke liye
      educationCertificate: { type: String }, // purane profiles ke liye (ab upload nahi)
    },

    // ─── Work ─────────────────────────
    workInfo: {
      workStatus: {
        type: String,
        enum: ["Employed", "SelfEmployed", "Unemployed"],
      },
      companyName: { type: String },
      businessName: { type: String },
      workingIndustry: { type: String },
      workLocation: { type: String },
      annualIncome: { type: String },
      incomeSource: { type: String }, // ✅ Unemployed — income kahan se
      // ✅ Add More — extra naukri / business / aay ka anya srot (max 5)
      // workStatus: "Employed" | "SelfEmployed" | "OtherIncome"
      additionalWork: [
        {
          workStatus: { type: String },
          companyName: { type: String },
          businessName: { type: String },
          workingIndustry: { type: String },
          workLocation: { type: String },
          annualIncome: { type: String },
          incomeSource: { type: String },
        },
      ],
    },
    // ─── Family Background ───────────────────────────────────────
    familyInfo: {
      fatherName: { type: String },
      fatherOccupation: { type: String },

      motherName: { type: String },
      motherOccupation: { type: String },

      nativePlace: { type: String },
      familyType: { type: String },
      familyIncome: { type: String },

      noOfBrothers: { type: Number },

      brothers: [
        {
          name: { type: String },
          occupation: { type: String },
        },
      ],

      noOfSisters: { type: Number },

      sisters: [
        {
          name: { type: String },
          occupation: { type: String },
        },
      ],

      // ✅ Close Relatives — ek hi text box (naya)
      relativesDetails: { type: String, maxlength: 1000 },

      // ✅ Close Relatives — list (naya app bhi bhejta hai: Naam, Phone,
      // Occupation, Residence). Purane app ke relation / city bhi chalte hain
      relatives: [
        {
          relation: { type: String },
          name: { type: String },
          phone: { type: String },
          occupation: { type: String },
          residence: { type: String },
          city: { type: String },
        },
      ],
    },
    // ─── Religion & Community ────────────────────────────────────
    communityInfo: {
      mulJain: { type: String },
      panth: { type: String },
      gotra: { type: String },
      subGotra: { type: String },
      caste: { type: String },
      subCaste: { type: String },
      mamaGotra: { type: String },
      manglik: { type: String },
      motherTongue: { type: String },
    },

    // ─── Address ─────────────────────────────────────────────────
    addressInfo: {
      country: { type: String, default: "India" },
      state: { type: String },
      district: { type: String },
      city: { type: String },
      fullAddress: { type: String },
    },

    // ─── Contact Details ─────────────────────────────────────────
    contactInfo: {
      mobileNumber: { type: String },
      contactPerson: { type: String },
      email: { type: String },

      addNumber: {
        name: { type: String },
        number: { type: String },
        relation: { type: String },
        address: { type: String }, // purane profiles ke liye (ab nahi poocha jaata)
      },

      // ✅ Saare alternate contacts (max 3) — name, relation, number
      alternateContacts: [
        {
          name: { type: String },
          relation: { type: String },
          number: { type: String },
        },
      ],
    },

    // ─── Uploaded Photos ─────────────────────────────────────────
    uploadedPhotos: [
      {
        label: { type: String }, // e.g. "passport", "full", "family"
        url: { type: String },
      },
    ],

    // ─── Partner Preference ──────────────────────────────────────
    partnerPreference: {
      preferredAgeFrom: { type: Number },
      preferredAgeTo: { type: Number },
      heightFrom: { type: Number }, // in cm
      heightTo: { type: Number },
      incomePreference: { type: String },
      maritalStatus: { type: String },
      educationPreference: { type: String },
      locationPreference: { type: String },
      additionalPreference: { type: String },
    },

    isVisible: { type: Boolean, default: false },

    // ─── Liked Profiles ──────────────────────────────────────────
    // profiles jisko is user ne like kiya
    likedProfiles: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "VyavahikBiodata",
      },
    ],

    // ─── Interests Sent (maine kisiko interest bheja) ─────────────
    interestsSent: [
      {
        profileId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "VyavahikBiodata",
          required: true,
        },
        status: {
          type: String,
          enum: ["pending", "accepted", "rejected"],
          default: "pending",
        },
        message: { type: String }, // optional note
        sentAt: { type: Date, default: Date.now },
      },
    ],

    // ─── Interests Received (koi mujhe interest bheja) ────────────
    interestsReceived: [
      {
        profileId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "VyavahikBiodata",
          required: true,
        },
        status: {
          type: String,
          enum: ["pending", "accepted", "rejected"],
          default: "pending",
        },
        message: { type: String },
        receivedAt: { type: Date, default: Date.now },
      },
    ],
    // ─── Membership / Payment Info ─────────────────────────
    membershipInfo: {
      amount: {
        type: Number,
        default: 500,
      },

      paymentStatus: {
        type: String,
        enum: ["pending", "paid", "failed"],
        default: "pending",
      },

      startDate: {
        type: Date,
        default: Date.now,
      },

      validityDate: {
        type: Date,
        default: () => {
          const date = new Date();
          date.setFullYear(date.getFullYear() + 1); // 1 year validity
          return date;
        },
      },
    },
  },
  { timestamps: true },
);

// ✅ Ek user ab MAX 3 biodata bana sakta hai (limit controller me check hoti hai).
// Pehle yahan userId par UNIQUE index tha ("uniq_userId") — wo 2nd profile ko
// DB level par hi rok deta. Ab normal (non-unique) index: user ki profiles
// jaldi milein, purani se nayi order me.
vyavahikBiodataSchema.index({ userId: 1, createdAt: 1 });

const VyavahikBiodata = mongoose.model(
  "VyavahikBiodata",
  vyavahikBiodataSchema,
);

// ✅ Purana unique index MongoDB se ek baar hatao.
// Schema se hatane par bhi DB me index bana rehta hai — server start par drop.
// Index na mile (pehle hi hat gaya) to chup-chaap aage.
const dropOldUniqueUserIdIndex = () => {
  VyavahikBiodata.collection
    .dropIndex("uniq_userId")
    .then(() => console.log("✅ Dropped old unique index: uniq_userId"))
    .catch((err) => {
      if (err?.codeName !== "IndexNotFound" && err?.code !== 27) {
        console.warn("⚠️ Could not drop uniq_userId index:", err?.message);
      }
    });
};

if (mongoose.connection.readyState === 1) {
  dropOldUniqueUserIdIndex();
} else {
  mongoose.connection.once("open", dropOldUniqueUserIdIndex);
}

module.exports = { VyavahikBiodata };
