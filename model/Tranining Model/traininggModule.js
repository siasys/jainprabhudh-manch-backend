const mongoose = require('mongoose');

/* ================= QUIZ QUESTION ================= */
const quizQuestionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
  },

  options: {
    type: [String],
    required: true,
    validate: {
      validator: function (arr) {
        return arr.length === 4;
      },
      message: 'Each question must have exactly 4 options',
    },
  },

  correctAnswer: {
    type: String, // must match one option
    required: true,
  },
});

/* ================= TRAINING MATERIAL ================= */
const trainingMaterialSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['pdf', 'video'],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    required: true,
  },
});

/* ================= PARTICIPANT ANSWER ================= */
const participantAnswerSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  selectedOption: {
    type: String, // one of 4 options
    required: true,
  },
  isCorrect: {
    type: Boolean,
    default: false,
  },
});

/* ================= PARTICIPANT ================= */
const participantSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  answers: [participantAnswerSchema],

  totalScore: {
    type: Number,
    default: 0,
  },

  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending',
  },

  submittedAt: {
    type: Date,
  },
   certificate: {
    generated: {
      type: Boolean,
      default: false,
    },
    certificateNo: String,
    issuedAt: Date,
    name: String,
    place: String,
    certificateUrl: String, // 👈 CDN URL
  },
});

/* ================= TRAINING MODULE ================= */
const trainingModuleSchema = new mongoose.Schema(
  {
    trainingName: {
      type: String,
      required: true,
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    materials: [trainingMaterialSchema],

    quiz: {
      type: [quizQuestionSchema],
      validate: {
        validator: arr => arr.length === 5,
        message: 'Quiz must contain exactly 5 questions',
      },
    },

    totalMarks: {
      type: Number,
      default: 5,
    },

    participants: [participantSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('TrainingModule', trainingModuleSchema);
