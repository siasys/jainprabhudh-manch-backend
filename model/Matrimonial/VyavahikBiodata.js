const mongoose = require('mongoose');

const vyavahikBiodataSchema = new mongoose.Schema(
   {
    userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
      type: String,            // "Normal" or "Special Abled"
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
            name: { type: String },                 // brother ka naam
            married: { type: String },             // yes/no
            wifeName: { type: String },             // agar married hai to wife name
            occupation: { type: String },           // unmarried brother ke liye
          }
        ],
        sisters: [
          {
            name: { type: String },                 // sister ka naam
            married: { type: String },             // yes/no
            husbandName: { type: String },          // married hai to husband ka naam
            location: { type: String },             // married sister ke liye husband location
            occupation: { type: String },           // unmarried sister ke liye
          }
        ],
        nativePlace: {
          type: String,
        },
        familyType: {
          type: String,
        },
        familyIncome: {
          type: String,
        }
      },
    addressInfo:{
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
    contactInfo:{
        number: {
        type: String,
     },
     contactPerson: {
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
    paymentScreenshot: {
      type: String,
    },
    partnerPreference: {
      type: String,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending'
    },
    paymentId: {
      type: String,
      sparse: true
    },
    isVisible: {
      type: Boolean,
      default: false
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VyavahikBiodata', vyavahikBiodataSchema);
