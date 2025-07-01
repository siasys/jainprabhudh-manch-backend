const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    sanghId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HierarchicalSangh',
        required: true
    },
    memberId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    transactionId: {
        type: String,
        required: true
    },
   status: {
    type: String,
    enum: ['pending', 'paid', 'overdue'],
    default: 'pending'
},
    amountCollected: {
        type: Number,
    },
    currency: { type: String, default: "INR" },
    foundationAccount: {
    amount: { type: Number },
    accountId: { type: String },
    },
    paymentDate: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

const Payment = mongoose.model('SanghPayment', paymentSchema);

module.exports = Payment;
