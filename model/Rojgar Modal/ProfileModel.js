const mongoose = require("mongoose");

// Employment profile (LinkedIn jaisa): har user ka ek document.
// sections me Experience, Education, Skills... — fields controller me whitelist hote hai.
const profileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    intro: {
      headline: { type: String, maxlength: 120, default: "" },
      location: { type: String, maxlength: 120, default: "" },
      openToWork: { type: Boolean, default: false },
      openRoles: { type: String, maxlength: 200, default: "" },
      openTypes: [{ type: String }],
    },
    about: { type: String, maxlength: 2000, default: "" },
    // { experience: [{ id, title, company, ... }], education: [...], ... }
    sections: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Pehli baar job-profile/services se auto-fill ho chuka hai ya nahi
    seeded: { type: Boolean, default: false },
  },
  { timestamps: true, minimize: false },
);

module.exports = mongoose.model("EmploymentProfile", profileSchema);
