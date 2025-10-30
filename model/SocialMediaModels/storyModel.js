const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  sanghId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HierarchicalSangh',
  },
  isSanghStory: {
    type: Boolean,
    default: false,
  },

  // ✅ Each media has its own text, style, and mentions
  media: [
    {
      url: { type: String, required: true },
      type: { type: String, enum: ['image', 'video', 'text'], required: true },
      text: { type: String, default: '' },
      textStyle: {
        x: { type: Number, default: 0.5 },
        y: { type: Number, default: 0.5 },
        color: { type: String, default: '#ffffff' },
        fontFamily: { type: String, default: 'System' },
        fontSize: { type: Number, default: 16 },
      },
      mentionUsers: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
    },
  ],

  createdAt: {
    type: Date,
    default: Date.now,
    expires: '24h',
  },
});

module.exports = mongoose.model('Story', storySchema);
