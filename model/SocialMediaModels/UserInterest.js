// models/UserInterest.js
const mongoose = require('mongoose');

const userInterestSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true // fast lookup for feed ranking
  },
  hashtags: [
    {
      name: { type: String, lowercase: true, trim: true },
      score: { type: Number, default: 1 } // Like = +1, Comment = +2, Share = +3
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model('UserInterest', userInterestSchema);
