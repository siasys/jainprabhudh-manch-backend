const express = require('express');
const { createTrainingModule, getAllTrainingModules, getTrainingModuleById, submitTrainingQuiz, uploadCertificateForParticipant, updateTrainingMaterials, updateTraining } = require('../../controller/Traning Model/trainingController.js');
const upload = require('../../middlewares/upload.js');
const router = express.Router();


router.post('/upload', upload.trainingMaterialUpload, createTrainingModule);
router.post('/:id/submit-quiz', submitTrainingQuiz);
/* GET ALL */
router.get('/all', getAllTrainingModules);

/* GET BY ID */
router.get('/:id', getTrainingModuleById);
router.put('/:trainingId/certificate', upload.certificateUpload, uploadCertificateForParticipant);
router.put('/:id/materials', upload.trainingMaterialUpload, updateTraining);

module.exports = router;
