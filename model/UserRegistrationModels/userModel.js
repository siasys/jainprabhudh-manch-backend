const mongoose = require('mongoose');
const validator = require('validator');
const { hashPassword, isPasswordMatched } = require('../../helpers/userHelpers');

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
     // required: [true, 'First name is required'],
     // trim: true,
    },
    lastName: {
      type: String,
     // required: [true, 'Last name is required'],
    },
    fullName: {
      type: String,
      //required: false,
    },
    businessName:{
    type: String,
    },
    businessDate:{
    type: Date,
    },
    shravakId:{
      type: String,
    },
     sadhuName: {
      type: String,
     },
     tirthName:{
      type: String,
     },
    email: {
    type: String,
    // unique: true,
    // trim: true,
    // sparse: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return validator.isEmail(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    isEmailVerified:{
       type: Boolean,
      default: false,
    },
    tempPhoneChange: {
      phoneNumber: String,
      code: String,
      expiresAt: Date,
    },
    tempEmailChange: {
      email: { type: String },
      code: { type: String },
      expiresAt: { type: Date }
    },
    verificationCode: {
      code: String,
      expiresAt: Date
    },
    resetPasswordCode: {
      code: String,
      expiresAt: Date
    },
    birthDate: {
      type: Date,
     // required: [true, 'Birth date is required'],
    },
    gender: {
      type: String,
      enum: ['Male', 'Female'],
    },
    phoneNumber: {
      type: String,
      //  unique: true,
      //  sparse: true,
      // validate: {
      //   validator: function (v) {
      //     return /\d{10}/.test(v);
      //   },
      //   message: props => `${props.value} is not a valid phone number!`
      // },
     // required: [true, 'Phone number is required'],
    },
    password: {
      type: String,
     // required: [true, 'Password is required'],
    },
     accountType: {
      type: String,
      enum: ["user", "business", "sadhu","tirth"],
      default: "user",
    },
      location: {
      country: {
        type: String,
      },
      state: {
        type: String,
      },
      district:{
        type: String,
      },
      city: {
        type: String,
      }
    },
    profilePicture: {
      type: String,
      default: null,
    },
    coverPicture:{
      type: String,
      default: null,
    },
    bio: {
      type: String,
    },
    privacy: {
      type: String,
      default: 'public',
    },
    token: {
      type: String,
      default: null
    },
    lastLogin: {
      type: Date,
      default: null
    },
    jainAadharNumber: {
      type: String,
    },
    jainAadharStatus: {
      type: String,
      enum: ['none', 'pending', 'verified', 'rejected'],
      default: 'none'
    },
    jainAadharApplication: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JainAadhar'
    },
    accountTitle:{
      type: String,
    },
  trialPeriodStart: {
  type: Date,
  default: Date.now
    },
    trialPeriodEnd: {
      type: Date,
      default: function () {
        const date = new Date();
        date.setDate(date.getDate() + 7);
        return date;
      }
    },
    isTrialExpired: {
      type: Boolean,
      default: false
    },
    role: {
      type: String,
      enum: ['user', 'admin', 'superadmin'],
      default: 'user'
    },
    adminVerifiedAt: {
      type: Date
    },
    adminPermissions: [{
      type: String,
      enum: [
        'manage_users',
        'verify_jain_aadhar',
        'manage_content',
        'manage_reports',
        'manage_sanghs',
        'manage_admins'
      ]
    }],
    posts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        default: 0,
      },
    ],
    postCount: {
      type: Number,
      default: 0
    },
    activeBoosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BoostPlan"
      }
    ],
    isBoostActive: {
      type: Boolean,
      default: false
    },
    boosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BoostPlan"
      }
    ],
    savedPosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Post"
      }
    ],

    likedPosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
      },
    ],
    friends: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    followedSanghs: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh'
    }],
    story: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Story',
      },
    ],
   activity: {
  likes: [
    { postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post" }, createdAt: { type: Date, default: Date.now } }
  ],
  comments: [
    { postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post" }, createdAt: { type: Date, default: Date.now } }
  ],
  shares: [
    { postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post" }, createdAt: { type: Date, default: Date.now } }
  ],
  saved: [
    { postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post" }, createdAt: { type: Date, default: Date.now } }
  ]
},

    deletedAt: { type: Date },
    loginAttempts: {
      type: Number,
      default: 0
    },
    lockUntil: {
      type: Date,
      default: null
    },
    accountStatus: {
      type: String,
      enum: ['active', 'deactivated'],
      default: 'active'
    },
    status: {
    type: String,
    enum: ['online', 'offline'],
    default: 'offline',
  },
  lastSeen: {
    type: Date,
    default: null,
  },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
activityJudge: [
  {
    activityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Activity",
    },
    role: {
      type: String,
      enum: ["judge", "judge1", "judge2", "judge3"],
      default: "judge",
    },
  },
],

    sanghRoles: [{
      sanghId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchicalSangh'
      },
      role: {
        type: String,
        enum: [
        'president',
        'secretary',
        'treasurer',
        'member',
        'honoraryMember',
        'panchMember',
        'sanghSarakshak',
        'sanghMargdarshak',
        'sanghUpadhyaksh',
        'sanghSanghthanSachive',
        'sanghSahsachive',
        'sanghKoshadhyksha',
        'sanghPracharak',
        'sanghKarykarmPramukh',
        'sanghKaryakariniSadasya'
      ]
      },
      level: {
        type: String,
        enum: ['foundation','country', 'state', 'district', 'city', 'area']
      },
      sanghType: {
        type: String,
        enum: ['main', 'women', 'youth'],
        default: 'main'
      }
    }],
     // **Panch Roles (With Default Role 'panchMember')**
  panchRoles: [
  {
    panchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Panch',
    },
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
    },
    role: {
      type: String,
      default: 'panchMember',
    },
    level: {
      type: String,
      enum: ['city', 'district', 'state', 'country'],
    },
  }
],
tirthRoles: [{
  tirthId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tirth'
  },
  role: {
    type: String,
    enum: ['manager', 'assistant']
  },
  approvedAt: {
    type: Date,
    default: Date.now
  }
}],
vyaparRoles: [{
  vyaparId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vyapar'
  },
  role: {
    type: String,
    enum: ['owner', 'manager']
  },
  approvedAt: {
    type: Date,
    default: Date.now
  }
}],
sadhuRoles: [{
  sadhuId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sadhu'
  },
  role: {
    type: String,
    enum: ['owner', 'manager', 'admin']
  },
  approvedAt: {
    type: Date,
    default: Date.now
  }
}]
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', hashPassword);
userSchema.methods.isPasswordMatched = isPasswordMatched;

// Update indexes to match schema changes
// userSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });
// userSchema.index({ email: 1 }, { unique: true, sparse: true });
// userSchema.index({ jainAadharNumber: 1 }, { sparse: true });
// userSchema.index({ jainAadharStatus: 1 });
userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

// Add compound indexes for common query patterns
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ jainAadharStatus: 1, createdAt: -1 });

userSchema.methods.incrementLoginAttempts = async function() {
    this.loginAttempts += 1;
    if (this.loginAttempts >= 5) {
        this.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes lock
    }
    await this.save();
};

module.exports = mongoose.model('User', userSchema);