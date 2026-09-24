const mongoose = require("mongoose");

/**
 * Tirth Employee Attendance
 * Manager roz har employee ka status mark karta hai.
 *
 * present = poora din  |  half = aadha din
 * absent  = gair-hazir |  leave = paid chhutti (salary milegi)
 *
 * Ek employee ka ek din me sirf ek record — isliye unique index.
 */
const tirthAttendanceSchema = new mongoose.Schema(
  {
    tirthId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tirth",
      required: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TirthEmployee",
      required: true,
      index: true,
    },

    // hamesha UTC midnight — timezone se din shift na ho
    date: { type: Date, required: true, index: true },

    status: {
      type: String,
      enum: ["present", "half", "absent", "leave"],
      required: true,
    },

    note: { type: String, default: "" },

    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

// ek employee + ek date = ek hi record
tirthAttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
tirthAttendanceSchema.index({ tirthId: 1, date: 1 });

module.exports = mongoose.model("TirthAttendance", tirthAttendanceSchema);
