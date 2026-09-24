const mongoose = require("mongoose");

const meetingSchema = new mongoose.Schema({
  meetingType: { type: String },
  agmSubType: { type: String },
  date: { type: Date },
  attendanceCount: { type: String },
  description: { type: String },
  images: [{ type: String }],
});

const projectSchema = new mongoose.Schema({
  eventName: { type: String },
  description: { type: String },
  memberCount: { type: Number, default: 0 },
  eventDate: { type: Date },
  images: [{ type: String }],
});

const visitSchema = new mongoose.Schema({
  visitorName: { type: String },
  visitorPostName: { type: String },
  visitorLevel: { type: String },
  sanghName: { type: String },
  sanghId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "HierarchicalSangh",
    default: null,
  },
  summary: { type: String },
  pdf: { type: String },
  images: [{ type: String }],
});

// ── NEW (online training): sangh members ne kaunsi training complete ki ──
const onlineTrainingSchema = new mongoose.Schema({
  trainingId: { type: mongoose.Schema.Types.ObjectId, ref: "TrainingModule" },
  trainingName: { type: String },
  completedCount: { type: Number, default: 0 },
  memberNames: [{ type: String }],
});

const reportingSchema = new mongoose.Schema(
  {
    sanghId: { type: mongoose.Schema.Types.ObjectId, ref: "HierarchicalSangh" },
    submittingSanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
    },
    recipientSanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HierarchicalSangh",
    },
    submittedById: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sanghName: { type: String },
    presidentName: { type: String },
    secretaryName: { type: String },
    treasurerName: { type: String },
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
    // ── NEW (score module): additive fields ──
    donationAmount: { type: String },
    trainingCount: { type: String },
    reportMonth: { type: Number },
    reportYear: { type: Number },
    meetings: [meetingSchema],
    meetingsHeld: { type: String },
    meetingsAttended: { type: String },
    projects: [projectSchema],
    events: { type: String },
    members: { type: String },
    eventDate: { type: Date },
    visits: [visitSchema],
    trainingHeld: { type: Boolean, default: null },
    trainingInput: { type: String },
    // ── NEW: offline training images (2) ──
    trainingImages: [{ type: String }],
    // ── NEW (online training): auto-fetched from TrainingModule participants ──
    onlineTrainings: [onlineTrainingSchema],
    onlineTrainingTotal: { type: Number, default: 0 },
    selectedOption: { type: String },
    fieldBy: { type: String },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    remarks: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Reporting", reportingSchema);
