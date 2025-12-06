const mongoose = require('mongoose');
const crypto = require('crypto');

const tirthSchema = new mongoose.Schema({
    // userId: {
    //     type: mongoose.Schema.Types.ObjectId,
    //     ref: 'User',
    //    required: true
    // },
    tirthName: {
        type: String,
        trim: true
    },
  tirthType: {
  type: String,
  enum: ['Digambar', 'Shwetambar'],
},
    tirthShetra: {
        type: String
    },
    mulNayakName: {
        type: String,
       // required: true
    },
    tirthHistory: {
        type: String,
       // required: true
    },
    tirthFamousReason: {
        type: String,
       // required: true
    },
    facilities: {
    roomCount: String,
    hallCount: String,
    roomWithBath: String,
    roomWithoutBath: String,
    acRoomCount: String,
    nonAcRoomCount: String,
    airCoolerCount: String,
    guestHouseCount: String,
    yatriCapacity: String,
},
    additionalFacilities: {
    bhojanalay: {
        type: String,   // "yes" or "no"
        default: "no"
    },

    bhojanalayDetails: {
        breakfastService: {
        type: String,
        },
        lunchService: {
        type: String,
        },
        dinnerService: {
        type: String,
        }
    },
    library: {
        type: String,   // "yes" or "no"
        default: "no"
    },
    tirthMedical: {
        type: String,   // "yes" or "no"
        default: "no"
    }
    },
  schoolInfo: {
    schoolAvailable: {
      type: String,
      enum: ["Yes", "No"],
      default: "No"
    },
    details: {
      schoolName: { type: String, default: "" },
      classesAvailableFrom: { type: String, default: "" },
      classesAvailableTo: { type: String, default: "" }
    }
  },
  hostelInfo: {
  hostelAvailable: {
    type: String,
    enum: ["Yes", "No"],
    default: "No"
  },

  hostelFor: {
    type: String,
    default: ""   // example: "Boys", "Girls", "Both"
  },

  hostelCapacity: {
    type: Number,
    default: 0
  },

manageHostel: {
  type: String,
  enum: ["Tirth Management", "School"],
  default: null
},
  // Additional Details When Managed by School Organization
  schoolOrganizationDetails: {
    schoolName: { type: String, default: "" },
    distance: { type: String, default: "" },
    contactNumber: { type: String, default: "" }
  }
},
addressInfo: {
  country: {
    type: String,
  },
  state: {
    type: String,
  },
  district: {
    type: String,
  },
  city: {
    type: String,
  }
},
nearestCities: [
  {
    cityName: {
      type: String,
    },
    distance: {
      type: String    
    }
  }
],
nearByTirth: [
  {
    tirthName: String,
    distance: String
  }
],
transportDetails: {
  available: {
    type: String,
    enum: ["yes", "no"],
  },
  stationName: {
    type: String,
    default: ""
  },
  timing: {
    type: String,
    default: ""
  },
  contactNumber: {
    type: String,
    default: ""
  }
},
tirthManagement: {
  managerName: {
    type: String,
    default: ""
  },
  contactNumber: {
    type: String,
    default: ""
  }
},
developmentPlan: {
  type: [String],   // array of strings
  default: []       // initially empty array
},

  tirthPhotos: [
  {
    type: String
  }
  ],

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
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    }
}, {
    timestamps: true
});

// Add indexes for common queries
// tirthSchema.index({ 'location.city': 1, status: 1 });
// tirthSchema.index({ citySanghId: 1, status: 1 });
// tirthSchema.index({ applicationStatus: 1 });

module.exports = mongoose.model('Tirth', tirthSchema);