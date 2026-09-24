const mongoose = require("mongoose");

const rojgarSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jobType: {
      type: String,
    },
    jainAadhar: {
      type: String,
    },
    companyName: {
      type: String,
    },
    jobName: {
      type: String,
    },
    jobDescription: {
      type: String,
    },
    education: {
      type: String,
    },
    experience: {
      type: String,
    },
    salary: {
      type: String,
    },
    age: {
      type: String,
    },
    gender: {
      type: String,
    },
    language: {
      type: String,
    },
    location: {
      type: String,
    },
    jobContact: {
      type: String,
    },
    jobEmail: {
      type: String,
    },
    jobPdf: {
      type: String,
    },
    jobPost: [
      {
        url: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          enum: ["image", "video"],
        },
      },
    ],
    // NEW: applied tracking
    appliedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    appliedCount: {
      type: Number,
      default: 0,
    },
    expireDate: {
      type: Date,
      default: () => {
        const now = new Date();
        now.setDate(now.getDate() + 30);
        return now;
      },
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

// NEW: naya job post hote hi job seekers (recruitees) ko notification bhejo.
// createJob controller ko touch kiye bina — sirf naye doc par (update par nahi).
rojgarSchema.pre("save", function (next) {
  this._wasNew = this.isNew;
  next();
});

rojgarSchema.post("save", async function (doc) {
  try {
    if (!doc || !doc._wasNew) return; // sirf naye job par
    const Notification = require("../SocialMediaModels/notificationModel");
    const RojgarRecruitee = require("./RojgarRecruiteeModel");

    const recruitees = await RojgarRecruitee.find({
      jobType: "recruitee",
    }).select("user");

    const posterId = doc.user ? doc.user.toString() : "";
    const seen = new Set();

    for (const r of recruitees) {
      if (!r.user) continue;
      const uid = r.user.toString();
      if (uid === posterId) continue; // apne aap ko nahi
      if (seen.has(uid)) continue;
      seen.add(uid);
      try {
        await Notification.create({
          senderId: doc.user,
          receiverId: r.user,
          type: "job_posted",
          jobId: doc._id,
          message: `New job posted${doc.jobName ? ": " + doc.jobName : ""}`,
        });
      } catch (e) {}
    }
  } catch (e) {
    console.error("job_posted notify hook error:", e.message);
  }
});

module.exports = mongoose.model("Rojgar", rojgarSchema);
