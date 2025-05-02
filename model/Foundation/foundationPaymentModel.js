const mongoose = require('mongoose');

// Define the Foundation Payment Schema
const foundationPaymentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',  // Reference to the User model
        required: true,
    },
    note: {
        type: String,
        required: true, 
    },
    amountCollected: {
        type: Number, // Amount in paise (for INR)
        required: true,
    },
    transactionId: {
        type: String,
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'paid', 'overdue'],
        default: 'pending',
    },
    currency: {
        type: String,
        default: 'INR',
    },
    paymentDate: {
        type: Date,
        default: Date.now, // Automatically sets the payment date to the current time
    }
});

// Create and export the model based on the schema
module.exports = mongoose.model('FoundationPayment', foundationPaymentSchema);
