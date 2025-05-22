const mongoose = require('mongoose');

const JainFoodSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // post creator
  foodName: { type: String, required: true },
  location: {
    state: { type: String, required: true },
    district: { type: String, required: true },
    city: { type: String, required: true },
    address: { type: String, required: true },
  },
  description: { type: String, required: true },
  image: { type: String, required: true }, // URL ya filename jo aap store karenge
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // users who liked the post
 
}, { timestamps: true });

module.exports = mongoose.model('JainFood', JainFoodSchema);
