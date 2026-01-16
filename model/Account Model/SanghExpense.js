const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
      required: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    expensesId: {
      type: String,
    },
    expenseTitle: {
      type: String,
    },

    expenseDate: {
      type: Date,
    },

    amount: {
      type: Number,
    },

    paymentToName: {
      type: String,
    },

    category: {
      type: String,
    },

    projectName: {
      type: String,
      default: '',
    },

    meetingLocation: {
      type: String,
      default: '',
    },

    meetingPurpose: {
      type: String,
      default: '',
    },

    otherCategory: {
      type: String,
      default: '',
    },

    paymentType: {
      type: String,
      enum: ['cash', 'upi', 'bank', 'cheque'],
    },

    uploadBill: {
      type: String, // CDN URL
      default: '',
    },

    invoiceNumber: {
      type: String,
      default: '',
    },

    additionalNote: {
      type: String,
      default: '',
    },

    // ✅ NEW STATUS FIELD
    status: {
      type: String,
      enum: ['pending', 'inreview', 'approved'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Expense', expenseSchema);
