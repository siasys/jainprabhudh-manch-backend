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
        default: 1100
    },
    currency: { type: String, default: "INR" },
    distribution: {
        city: {
            sanghId: { type: mongoose.Schema.Types.ObjectId, ref: 'HierarchicalSangh' },
            amount: { type: Number, default: 0 },
            level: { type: String }
        },
        district: {
            sanghId: { type: mongoose.Schema.Types.ObjectId, ref: 'HierarchicalSangh' },
            amount: { type: Number, default: 0 },
            level: { type: String }
        },
        state: {
            sanghId: { type: mongoose.Schema.Types.ObjectId, ref: 'HierarchicalSangh' },
            amount: { type: Number, default: 0 },
            level: { type: String }
        },
        country: {
            sanghId: { type: mongoose.Schema.Types.ObjectId, ref: 'HierarchicalSangh' },
            amount: { type: Number, default: 0 },
            level: { type: String }
        },
        foundation: {
            amount: { type: Number, default: 0 }
        }
    },
    paymentDate: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

const Payment = mongoose.model('SanghPayment', paymentSchema);

module.exports = Payment;
