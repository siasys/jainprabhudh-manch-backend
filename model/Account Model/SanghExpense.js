const mongoose = require('mongoose');

const sanghExpenseSchema = new mongoose.Schema(
  {
    expensesId: {
      type: String,
      unique: true,
      required: true,
    },

    expensesTitle: {
      type: String,
      required: true,
      trim: true,
    },

    sanghId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HierarchicalSangh',
    },

    category: {
      type: String,
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    paymentType: {
      type: String,
    },

    billImage: {
      type: String, // Cloudinary / URL
    },

    additionalInfo: {
      type: String,
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SanghExpense', sanghExpenseSchema);
