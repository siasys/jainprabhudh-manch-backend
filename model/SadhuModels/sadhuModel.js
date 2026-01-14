const mongoose = require('mongoose');
const crypto = require('crypto');

const sadhuSchema = new mongoose.Schema({
    // Basic Info
    // name: {
    //     type: String,
    //     required: [true, 'Name is required'],
    //     trim: true
    // },
    sadhuID:{
        type:String
    },
    shravakId:{
        type:String
    },
    sadhuName:{
        type: String,
        trim: true
    },
    guruName: {
        type: String,
    },
    gender:{
        type: String,
    },
    dikshaTithi: {
        type: Date,
    },
        // Upadhi Details
    upadhiList: [{
        upadhiName: {
            type: String,
           // required: true
        },
        upadhiDate: {
            type: Date,
            //required: true
        },
        upadhiPlace: {
            type: String,
        //required: true
        }
    }],
// Religious Info
    mulJain: {
        type: String,
    },
    panth: {
        type: String,
    },
    upjati: {
        type: String,
    },
    gotra: {
        type: String
    },
    subGotra: {
        type: String
    },
    personalInfo:{
    nameBeforeDiksha:{
        type: String
    },
    fathersName: {
        type: String,
    },
    mothersName: {
        type: String
    },
    brotherCount:{
        type: String
    },
    sisterCount:{
        type: String
    },
    married:{
     type:String
    },
    husbandName:{
        type: String,
    },
    wifeName:{
     type:String
    },
    marriageDate:{
        type: String,
    },
    sonCount:{
         type: String,
    },
    daughterCount:{
        type: String,
    },
    },
   occupation: {
  occupationType: {
    type: String,
    enum: ["student", "job", "retired", "business"],
  },

  details: {
    // ✅ Student details
    degree: {
      type: String,
      default: "",
    },
    institute: {
      type: String,
      default: "",
    },

    // ✅ Job details
    companyName: {
      type: String,
      default: "",
    },
    position: {
      type: String,
      default: "",
    },
    jobAddress: {
      type: String,
      default: "",
    },

    // ✅ Business details
    businessType: {
      type: String,
      default: "",
    },
    businessName: {
      type: String,
      default: "",
    },
    businessAddress: {
      type: String,
      default: "",
    },
  },
},

    religiousConversion:{
   caste:{
        type: String,
        },
    subCaste:{
        type: String,
    },
    Inspiration:{
        type: String,
    },
    },
    contactDetails: {
        country: {
            type: String,
            default: ''
        },
        state: {
            type: String,
            default: ''
        },
        district: {
            type: String,
            default: ''
        },
        address: {
            type: String,
            default: ''
        },
        mobileNumber: {
            type: String
        },
        email: {
            type: String,
            default: ''
        }
    },
    uploadImage: {
        type: [String],
        default: []
    },

    // Application Status
    applicationStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    
    // Review Information
    // reviewInfo: {
    //     reviewedBy: {
    //         cityPresidentId: {
    //             type: mongoose.Schema.Types.ObjectId,
    //             ref: 'User'
    //         },
    //         reviewDate: Date,
    //         comments: String
    //     }
    // },

    // Submitted By
    submittedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // City Association
    // citySanghId: {
    //     type: mongoose.Schema.Types.ObjectId,
    //     ref: 'HierarchicalSangh',
    //     required: true
    // },

    // Media
    photo: String,
    declarationText: {
    type: String,
    },
    // Active Status
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'inactive'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Sadhu', sadhuSchema);
