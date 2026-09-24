const mongoose = require("mongoose");
const crypto = require("crypto");

/* ══════════════════════════════════════════════════════════════
   ✅ CONTACT DETAILS — location country ke hisab se
   ──────────────────────────────────────────────────────────────
   strict: false isliye hai ki har country apne field name se
   save ho sake (countryConfig.js ke region1FieldName se):

     India   → state, district
     UK      → county, town_borough
     UAE     → emirate, area
     Kenya   → county, subcounty
     Canada  → province, region

   Ye keys schema me likhi nahi hain, phir bhi save hongi.
   ══════════════════════════════════════════════════════════════ */
const contactDetailsSchema = new mongoose.Schema(
  {
    country: { type: String, default: "" },

    // NOTE: region fields (state/district, county/town_borough, ...) yahan
    // declare nahi kiye — strict:false ki wajah se jo country bhejti hai
    // wahi key save hoti hai. Declare karte to har record me khaali
    // state:"" district:"" bhi chala jaata.

    city: { type: String, default: "" },
    address: { type: String, default: "" },
    mobileNumber: { type: String },
    email: { type: String, default: "" },

    // Seva vyavastha contact (public dikhega)
    sevaContactName: { type: String, default: "" },
    sevaContactMobile: { type: String, default: "" },

    // Sadhu ka apna mobile public dikhana hai ya nahi
    showMobilePublic: { type: Boolean, default: false },

    // Us country me in fields ko kya kehte hain — display ke liye
    // UK: { region1: "County", region2: "Town / Borough" }
    regionLabels: {
      region1: { type: String, default: "" },
      region2: { type: String, default: "" },
    },
  },
  { _id: false, strict: false },
);

const sadhuSchema = new mongoose.Schema(
  {
    // Basic Info
    // name: {
    //     type: String,
    //     required: [true, 'Name is required'],
    //     trim: true
    // },
    sadhuID: {
      type: String,
    },
    shravakId: {
      type: String,
    },
    sadhuName: {
      type: String,
      trim: true,
    },
    guruName: {
      type: String,
    },
    gender: {
      type: String,
    },
    dikshaTithi: {
      type: Date,
    },
    // Upadhi Details
    upadhiList: [
      {
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
        },
      },
    ],
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
      type: String,
    },
    subGotra: {
      type: String,
    },
    personalInfo: {
      nameBeforeDiksha: {
        type: String,
      },
      fathersName: {
        type: String,
      },
      mothersName: {
        type: String,
      },
      brotherCount: {
        type: String,
      },
      sisterCount: {
        type: String,
      },
      married: {
        type: String,
      },
      husbandName: {
        type: String,
      },
      wifeName: {
        type: String,
      },
      marriageDate: {
        type: String,
      },
      sonCount: {
        type: String,
      },
      daughterCount: {
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

    religiousConversion: {
      caste: {
        type: String,
      },
      subCaste: {
        type: String,
      },
      Inspiration: {
        type: String,
      },
      // ── NEW: form lowercase "inspiration" bhejta hai ──
      inspiration: {
        type: String,
      },
    },
    // ✅ Location country ke hisab se store hoti hai —
    // contactDetailsSchema (file ke top par) dekho
    contactDetails: contactDetailsSchema,

    uploadImage: {
      type: [String],
      default: [],
    },

    // Application Status
    applicationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
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
      ref: "User",
      required: true,
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
    /* ══════════════════════════════════════════════════════════
       ── NEW FIELDS (additive only) ──
       ══════════════════════════════════════════════════════════ */

    // Sadhu / Sadhvi ka prakar
    sadhuType: {
      type: String,
      enum: [
        "Acharya",
        "Upadhyay",
        "Muni",
        "Ailak",
        "Kshullak",
        "Aryika",
        "Sadhvi",
        "Brahmachari",
        "Brahmacharini",
        "Other",
        "",
      ],
      default: "",
    },

    // Diksha ki extra details
    dikshaSthal: {
      type: String,
      default: "",
    },
    dikshaGuruName: {
      type: String,
      default: "",
    },

    // Sangh / Gachchh / Sampraday
    sanghName: {
      type: String,
      default: "",
    },

    // Diksha tithi se auto-calculated (sorting ke liye Number)
    sanyamVarsh: {
      type: Number,
      default: null,
    },

    // ── Current location snapshot (latest only) ──
    // History alag SadhuVihar collection me jayegi
    currentLocation: {
      placeName: {
        type: String,
        default: "",
      },
      state: {
        type: String,
        default: "",
      },
      city: {
        type: String,
        default: "",
      },
      fromDate: {
        type: Date,
        default: null,
      },
      toDate: {
        type: Date,
        default: null,
      },
      lat: {
        type: Number,
        default: null,
      },
      lng: {
        type: Number,
        default: null,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },

    // ── Chaturmas history (saal-wise) ──
    chaturmasList: [
      {
        year: {
          type: Number,
        },
        place: {
          type: String,
        },
        city: {
          type: String,
        },
        state: {
          type: String,
        },
      },
    ],

    // Vartaman sthiti
    sadhuStatus: {
      type: String,
      enum: ["Sanyam", "Samadhisth", "Divangat", ""],
      default: "Sanyam",
    },

    // Additional information
    bhasha: {
      type: String,
      default: "",
    },
    visheshGyan: {
      type: String,
      default: "",
    },
    granthRachna: {
      type: String,
      default: "",
    },
    pravachanLink: {
      type: String,
      default: "",
    },
    jeevanParichay: {
      type: String,
      default: "",
    },

    // Active Status
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "inactive",
    },
  },
  {
    timestamps: true,
  },
);

// ── NEW: list/filter queries ke liye indexes ──
sadhuSchema.index({ sadhuType: 1 });
sadhuSchema.index({ sadhuStatus: 1 });
sadhuSchema.index({ "currentLocation.state": 1, "currentLocation.city": 1 });
sadhuSchema.index({ createdAt: -1, _id: -1 });

// ✅ NAYA — ek user sirf ek hi Sadhu profile bana sakta hai
// (review flow nahi hai, isliye applicationStatus ka filter nahi lagaya)
sadhuSchema.index({ submittedBy: 1 }, { unique: true });

module.exports = mongoose.model("Sadhu", sadhuSchema);
