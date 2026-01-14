const mongoose = require('mongoose');
const crypto = require('crypto');

const sanghTeamRoles = [
  'sanghSarakshak',
  'sanghMargdarshak',
  'sanghUpadhyaksh',
  'sanghSanghthanSachive',
  'sanghSahsachive',
  'sanghKoshadhyksha',
  'sanghPracharak',
  'sanghKarykarmPramukh',
  'sanghKaryakariniSadasya'
];
const officeBearerSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['president', 'secretary', 'treasurer'],
       // required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        //required: true
    },
    level:{
        type:String,
    },
    sanghType:{
      type: String,
    },
    name: {
        type: String,
    },
    jainAadharNumber: {
        type: String,
        required: true
    },
    email: String,
    phoneNumber: String,
    userImage: String,
    address: {
        street: String,
        city: String,
        district: String,
        state: String,
        pincode: String
    },
    appointmentDate: {
        type: Date,
        default: Date.now,
        required: true
    },
    amount: {
        type: Number,
        default: 0
    },

    paymentStatus:{
         type: String,
        enum: ['pending', 'paid', 'overdue'],
        default: 'pending'
    },
    memberScreenshot: {
    type: String,
    },
    termEndDate: {
    type: Date,
    required: true,
    default: function () {
        const date = new Date(this.appointmentDate || Date.now());
        date.setFullYear(date.getFullYear() + 1);
        return date;
    }
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
      description: {
    type: String,
    default: ''
  }
});
const panchSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    jainAadharNumber: {
        type: String,
        required: true
    },
    level:{
        type:String,
    },
    sanghType:{
      type: String,
    },
    postMember: {
        type: String,
    },
    email: String,
    phoneNumber: String,
    document: String,
    userImage: String,
    address: {
        street: String,
        city: String,
        district: String,
        state: String,
        pincode: String
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed'],
        default: 'pending'
    }
});

const memberSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    jainAadharNumber: {
        type: String,
        required: true
    },
    level:{
        type:String,
    },
    sanghType:{
      type: String,
    },
    postMember: {
        type: String,
    },
    email: String,
    phoneNumber: String,
    document: String,
    userImage: String,
    memberScreenshot: {
    type: String,
    },
    address: {
        street: String,
        city: String,
        district: String,
        state: String,
        pincode: String
    },
    localSangh: {
    state: String,
    district: String,
    sanghId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchicalSangh'
    },
    name: String
    },
    isHonorary: {
  type: Boolean,
  default: false
},
    amount: {
    type: Number,
    default: 0
  },
   paymentDate: {
    type: Date,
    default: null
  },
  paymentDistributed: {
  type: Boolean,
  default: false
},
    membershipStartDate: {
    type: Date,
    default: Date.now
  },

  membershipEndDate: {
    type: Date,
    default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  },

    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'inactive'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed'],
        default: 'pending'
    }
});
const honoraryMemberSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  jainAadharNumber: {
    type: String,
    required: true
  },
  level: {
    type: String,
  },
  sanghType: {
    type: String,
  },
  postMember: {
    type: String,
    default: 'honorary'
  },
  email: String,
  phoneNumber: String,
  document: String,
  userImage: String,
  memberScreenshot: String,

  address: {
    street: String,
    city: String,
    district: String,
    state: String,
    pincode: String
  },

  localSangh: {
    state: String,
    district: String,
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh'
    },
    name: String
  },

  amount: {
    type: Number,
    default: 0   // mostly honorary me 0 hi hota hai
  },

  paymentDate: {
    type: Date,
    default: null
  },

  membershipStartDate: {
    type: Date,
    default: Date.now
  },

  membershipEndDate: {
    type: Date,
    default: null   // honorary lifetime bhi ho sakta hai
  },
paymentDistributed: {
  type: Boolean,
  default: false
},
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },

  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending'
  },

  isHonorary: {
    type: Boolean,
    default: true
  }
});

// Sangh Team Schema
const sanghTeamSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: sanghTeamRoles,
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  name: {
    type: String,
  },
  jainAadharNumber: {
    type: String,
    required: true,
  },
  email: String,
  phoneNumber: String,
  userImage: String,
  address: {
    street: String,
    city: String,
    district: String,
    state: String,
    pincode: String,
  },
  appointmentDate: {
    type: Date,
    default: Date.now,
    required: true,
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'overdue'],
    default: 'pending',
  },
  termEndDate: {
    type: Date,
    default: () =>
      new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000), // 2 years from appointment
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  description: {
    type: String,
    default: '',
  },
});
const receivedPaymentSchema = new mongoose.Schema({
  fromMemberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  memberName: String,
  jainAadharNumber: String,

  fromMemberLevel: {
    type: String, // city / district / state / country
    required: true
  },

  sourceSanghId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HierarchicalSangh'
  },

  sourceSanghLevel: {
    type: String
  },

  percentage: {
    type: Number, // 10 / 20 / 50
    required: true
  },

  amount: {
    type: Number,
    required: true
  },

  sanghType: {
    type: String,
    enum: ['main', 'women', 'youth'],
    default: 'main'
  },

  location: {
    country: String,
    state: String,
    district: String,
    city: String
  },

  paymentDate: {
    type: Date,
    default: Date.now
  },

  status: {
    type: String,
    enum: ['unclaimed', 'claimed'],
    default: 'unclaimed'
  }
}, { _id: true });

const hierarchicalSanghSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    level: {
        type: String,
        enum: ['foundation', 'country', 'state', 'district', 'city', 'area'],
       // required: true
    },
    location: {
        country: {
            type: String,
            required: true,
            default: 'India'
        },
        state: {
            type: String,
            required: function() {
                return ['state', 'district', 'city', 'area'].includes(this.level);
            }
        },
        district: {
            type: String,
            required: function() {
                return ['district', 'city', 'area'].includes(this.level);
            }
        },
        city: {
            type: String,
            required: function() {
                return ['city', 'area'].includes(this.level);
            }
        },
        area: {
            type: String,
            required: function() {
                return this.level === 'area';
            }
        },
         address: {
        type: String,
    }
    },
    officeAddress: {
    country: {
        type: String,
        default: 'India',
        required: true
    },
    state: {
        type: String
    },
    district: {
        type: String
    },
    // city: {
    //     type: String
    // },
    address: {
        type: String
    }
    },
  parentSangh: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HierarchicalSangh',
    default: null
},
    sanghAccessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SanghAccess',
        default: null
    },
    officeBearers: [officeBearerSchema],
    sanghTeams: [sanghTeamSchema],
    membersCount:{
        type:String
    },
    members: [memberSchema],
    honoraryMembers: [honoraryMemberSchema],
    panches: [panchSchema],
    receivedPayments: [receivedPaymentSchema],
    establishedDate: {
        type: Date,
        default: Date.now
    },
    totalAvailableAmount: {
      type: Number,
      default: 0,
    },
    description: String,
    coverImage: String,
    sanghImage: String,
    contact: {
        email: String,
        phone: String,
        address: String
    },
    socialMedia: {
        facebook: String,
        twitter: String,
        instagram: String,
        website: String
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sanghType: {
        type: String,
        enum: ['main', 'women', 'youth'],
        default: 'main',
    },
    parentMainSangh: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchicalSangh',
        default: null
    },
    followers: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
],
  stories: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Story',
    }
  ],
 posts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        default: 0,
      },
    ],
}, {
    timestamps: true
});


// Generate unique access ID before saving
hierarchicalSanghSchema.pre('save', async function(next) {
    if (this.isNew && !this.accessId) {
        const prefix = {
            foundation: 'FND',
            country: 'CNT',
            state: 'ST',
            district: 'DST',
            city: 'CTY',
            area: 'AREA'
        }[this.level] || 'SNG';
        
        const timestamp = Date.now().toString().slice(-6);
        const random = crypto.randomBytes(3).toString('hex').toUpperCase();
        
        this.accessId = `${prefix}-${timestamp}-${random}`;
    }
    // If sanghAccessId is undefined, set it to null explicitly
    if (this.sanghAccessId === undefined) {
        this.sanghAccessId = null;
    }
    next();
});

hierarchicalSanghSchema.methods.validateHierarchy = async function() {
    if (this.level === 'foundation') {
        if (this.parentSangh) {
            throw new Error('foundation level Sangh cannot have a parent Sangh');
        }
        return;
    }
     if (this.level === 'country') {
  const parentSangh = await this.constructor.findById(this.parentSangh);

  if (!parentSangh) {
    throw new Error('Parent Sangh not found');
  }

  // Allow foundation as parent
  if (parentSangh.level === 'foundation') {
    return;
  }

  // Allow specialized Sanghs (women/youth) under country level main Sangh
  const isSameLevelSpecialized = (
    parentSangh.level === 'country' &&
    parentSangh.sanghType === 'main' &&
    ['women', 'youth'].includes(this.sanghType)
  );

  if (!isSameLevelSpecialized) {
    throw new Error('Country level Sangh must have a foundation as parent or be a specialized Sangh under country main Sangh');
  }

  return;
}

    // if (!this.parentSangh) {
    //     throw new Error('Non-country level Sangh must have a parent Sangh');
    // }

    const parentSangh = await this.constructor.findById(this.parentSangh);
    // if (!parentSangh) {
    //     throw new Error('Parent Sangh not found');
    // }

    const levelHierarchy = ['foundation', 'country', 'state', 'district', 'city', 'area'];
    const parentIndex = levelHierarchy.indexOf(parentSangh.level);
    const currentIndex = levelHierarchy.indexOf(this.level);
       if ((currentIndex <= parentIndex) && !isSameLevelSpecialized) {
    throw new Error(`Invalid hierarchy: ${this.level} level cannot be directly under ${parentSangh.level} level`);
}

};

// Add pre-save middleware to ensure validation
hierarchicalSanghSchema.pre('save', async function(next) {
    if (this.isNew) {
        try {
            await this.validateHierarchy();
        } catch (error) {
            next(error);
            return;
        }
    }
    next();
});

hierarchicalSanghSchema.methods.getHierarchy = async function() {
    const hierarchy = {
        current: this.toObject(),
        parent: null,
        children: []
    };

    if (this.parentSangh) {
        hierarchy.parent = await this.model('HierarchicalSangh')
            .findById(this.parentSangh)
            .select('name level location');
    }

    hierarchy.children = await this.model('HierarchicalSangh')
        .find({ parentSangh: this._id, status: 'active' })
        .select('name level location');

    return hierarchy;
};

hierarchicalSanghSchema.methods.getChildSanghs = async function() {
    return await this.model('HierarchicalSangh')
        .find({ parentSangh: this._id, status: 'active' })
        .populate('officeBearers.userId', 'name email phoneNumber')
        .select('-members');
};

// Optimize indexes for common query patterns
hierarchicalSanghSchema.index({ level: 1 });
hierarchicalSanghSchema.index({ parentSangh: 1 });
hierarchicalSanghSchema.index({ state: 1 });
hierarchicalSanghSchema.index({ district: 1 });
hierarchicalSanghSchema.index({ city: 1 });
// Compound indexes for location-based queries
hierarchicalSanghSchema.index({ state: 1, district: 1, city: 1 });

module.exports = mongoose.model('HierarchicalSangh', hierarchicalSanghSchema); 