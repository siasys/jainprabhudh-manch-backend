const mongoose = require('mongoose');

const jainHostalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',  // Assuming User model exists
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  location: {
    type: String,
    required: true,
  },
  image: {
    type: String, // URL or file path of the image
    required: false,
  },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

const JainHostal = mongoose.model('JainHostal', jainHostalSchema);

module.exports = JainHostal;
