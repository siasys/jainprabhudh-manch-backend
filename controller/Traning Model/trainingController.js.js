const TrainingModule = require('../../model/Tranining Model/traininggModule');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

/* =========================================
   CREATE TRAINING MODULE
========================================= */
const createTrainingModule = async (req, res) => {
  try {
    const { trainingName, quiz } = req.body;
    const userId = req.user._id; // auth middleware se

    if (!trainingName) {
      return res.status(400).json({ message: 'Training name is required' });
    }

    /* ================= QUIZ PARSE ================= */
    let parsedQuiz = [];
    if (quiz) {
      parsedQuiz = JSON.parse(quiz);

      if (parsedQuiz.length !== 5) {
        return res
          .status(400)
          .json({ message: 'Quiz must contain exactly 5 questions' });
      }
    }

    /* ================= MATERIAL ARRAY ================= */
    const materials = [];

    /* ---------- PDF FILES ---------- */
    if (req.files?.trainingPdf) {
      req.files.trainingPdf.forEach(file => {
        materials.push({
          type: 'pdf',
          title: file.originalname,
          url: convertS3UrlToCDN(file.location), // 👈 CDN
        });
      });
    }

    /* ---------- VIDEO FILES ---------- */
    if (req.files?.trainingVideo) {
      req.files.trainingVideo.forEach(file => {
        materials.push({
          type: 'video',
          title: file.originalname,
          url: convertS3UrlToCDN(file.location), // 👈 CDN
        });
      });
    }

    /* ================= CREATE DOC ================= */
    const training = await TrainingModule.create({
      trainingName,
      createdBy: userId,
      materials,
      quiz: parsedQuiz,
    });

    return res.status(201).json({
      message: 'Training module created successfully',
      training,
    });
  } catch (error) {
    console.error('Create Training Error:', error);
    return res.status(500).json({
      message: 'Something went wrong while creating training',
    });
  }
};
/* =========================================
   GET ALL TRAINING MODULES
========================================= */
const getAllTrainingModules = async (req, res) => {
  try {
    const trainings = await TrainingModule.find()
      .sort({ createdAt: 1 });

    return res.status(200).json({
      count: trainings.length,
      trainings,
    });
  } catch (error) {
    console.error('Get All Training Error:', error);
    return res.status(500).json({
      message: 'Something went wrong while fetching trainings',
    });
  }
};
/* =========================================
   GET TRAINING MODULE BY ID
========================================= */
const getTrainingModuleById = async (req, res) => {
  try {
    const { id } = req.params;

    const training = await TrainingModule.findById(id)
      .populate('createdBy', 'name email')
      .populate({
        path: 'participants.userId',
        select: 'fullName profilePicture gender location',
      });

    if (!training) {
      return res.status(404).json({
        message: 'Training module not found',
      });
    }

    return res.status(200).json({
      training,
    });
  } catch (error) {
    console.error('Get Training By ID Error:', error);
    return res.status(500).json({
      message: 'Something went wrong while fetching training',
    });
  }
};
/* =========================================
   SUBMIT QUIZ / PARTICIPATE IN TRAINING
========================================= */
const submitTrainingQuiz = async (req, res) => {
  try {
    const { id } = req.params; // trainingId
    const { answers } = req.body;
    const userId = req.user._id;

    if (!answers || answers.length !== 5) {
      return res.status(400).json({
        message: 'Exactly 5 answers are required',
      });
    }

    const training = await TrainingModule.findById(id);
    if (!training) {
      return res.status(404).json({
        message: 'Training module not found',
      });
    }

    /* ================= CHECK ALREADY PARTICIPATED ================= */
    const alreadySubmitted = training.participants.find(
      p => p.userId.toString() === userId.toString()
    );

    if (alreadySubmitted) {
      return res.status(400).json({
        message: 'Quiz already submitted for this training',
      });
    }

    let totalScore = 0;
    const participantAnswers = [];

    /* ================= CHECK ANSWERS ================= */
    answers.forEach(answer => {
      const question = training.quiz.find(
        q => q._id.toString() === answer.questionId
      );

      if (!question) return;

      const isCorrect = question.correctAnswer === answer.selectedOption;

      if (isCorrect) totalScore += 1;

      participantAnswers.push({
        questionId: question._id,
        selectedOption: answer.selectedOption,
        isCorrect,
      });
    });

    /* ================= PUSH PARTICIPANT ================= */
    training.participants.push({
      userId,
      answers: participantAnswers,
      totalScore,
      status: 'completed',
      submittedAt: new Date(),
    });

    await training.save();

    return res.status(200).json({
      message: 'Quiz submitted successfully',
      totalScore,
      totalMarks: training.totalMarks,
      status: 'completed',
    });
  } catch (error) {
    console.error('Submit Quiz Error:', error);
    return res.status(500).json({
      message: 'Something went wrong while submitting quiz',
    });
  }
};
const uploadCertificateForParticipant = async (req, res) => {
  try {
    const { trainingId } = req.params;
    const userId = req.user._id;

    if (!req.file) {
      return res.status(400).json({
        message: 'Certificate image file is required',
      });
    }

    const training = await TrainingModule.findById(trainingId)
      .populate('participants.userId', 'fullName location');

    if (!training) {
      return res.status(404).json({ message: 'Training not found' });
    }

    const participant = training.participants.find(
      p => p.userId._id.toString() === userId.toString()
    );

    if (!participant) {
      return res.status(404).json({ message: 'Participant not found' });
    }

    if (participant.status !== 'completed') {
      return res.status(400).json({
        message: 'Training not completed yet',
      });
    }

    // ✅ Already generated
    if (participant.certificate?.generated) {
      return res.status(200).json({
        message: 'Certificate already generated',
        certificate: participant.certificate,
      });
    }

    /* ================= CERTIFICATE SAVE ================= */

    const certificateUrl = convertS3UrlToCDN(req.file.location);

    participant.certificate = {
      generated: true,
      certificateNo: `CERT-${trainingId.slice(-4)}-${userId
        .toString()
        .slice(-4)}`,
      issuedAt: new Date(),
      name: participant.userId.fullName,
      place: participant.userId.location?.city || '—',
      certificateUrl,
    };

    await training.save();

    return res.status(200).json({
      message: 'Certificate uploaded & generated successfully',
      certificate: participant.certificate,
    });

  } catch (error) {
    console.error('Upload Certificate Error:', error);
    return res.status(500).json({
      message: 'Something went wrong while uploading certificate',
    });
  }
};

module.exports = {
  createTrainingModule,
  getAllTrainingModules,
  getTrainingModuleById,
  submitTrainingQuiz,
  uploadCertificateForParticipant
};
