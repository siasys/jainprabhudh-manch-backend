const mongoose = require('mongoose');

const bailorSchema = new mongoose.Schema({
  images: [String],
});

module.exports = mongoose.model('Bailor', bailorSchema);
