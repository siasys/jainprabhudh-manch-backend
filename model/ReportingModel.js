const mongoose = require("mongoose");

// ── Sub-schemas ──────────────────────────────────────────────

const meetingSchema = new mongoose.Schema({
  meetingType: { type: String },
  agmSubType: { type: String },
  date: { type: Date },
  attendanceCount: { type: String },
  description: { type: String },
  images: [{ type: String }], // ← String URLs, not objects
});

const projectSchema = new mongoose.Schema({
  eventName: { type: String },
  description: { type: String },
  memberCount: { type: Number, default: 0 },
  eventDate: { type: Date },
  images: [{ type: String }], // ← String URLs
});

const visitSchema = new mongoose.Schema({
  visitorName: { type: String },
  visitorPostName: { type: String },
  visitorLevel: { type: String },
  sanghName: { type: String },
  summary: { type: String },
  pdf: { type: String }, // ← String URL, not object
  images: [{ type: String }], // ← String URLs
});
// ── Main Schema ──────────────────────────────────────────────

const reportingSchema = new mongoose.Schema(
  {
    // Sangh Info
    sanghId: { type: mongoose.Schema.Types.ObjectId, ref: "HierarchicalSangh" },
    sanghName: { type: String },
    presidentName: { type: String, required: true },
    secretaryName: { type: String, required: true },
    treasurerName: { type: String, required: true },

    // Counts
    membershipCount: { type: String },
    jainAadharCount: { type: String },
    sanghCreateCount: { type: String },
    membersCreateCount: { type: String },
    businessRegisterCount: { type: String },
    sadhuRegisterCount: { type: String },
    tirthRegisterCount: { type: String },
    matrimonyCount: { type: String },
    scholarshipCount: { type: String },
    panchActivityCount: { type: String },
    membershipFeesCount: { type: String },
    employmentCount: { type: String },

    // Report Period
    reportMonth: { type: Number, required: true },
    reportYear: { type: Number, required: true },

    // Meetings
    meetings: [meetingSchema],
    meetingsHeld: { type: String },
    meetingsAttended: { type: String },

    // Projects / Events
    projects: [projectSchema],
    events: { type: String }, // joined string (legacy compat)
    members: { type: String }, // joined string (legacy compat)
    eventDate: { type: Date },

    // Official Visits
    visits: [visitSchema],

    // Training
    trainingHeld: { type: Boolean, default: null },
    trainingInput: { type: String },

    // Misc
    selectedOption: { type: String },
    fieldBy: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Reporting", reportingSchema);
