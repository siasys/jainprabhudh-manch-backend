const express = require('express');
const { createApplication, getAllApplications, getApplicationById, updateApplication } = require('../../controller/SanghControllers/applicationController');
const router = express.Router();


// POST
router.post('/', createApplication);

// GET ALL
router.get('/', getAllApplications);

// GET SINGLE
router.get('/:id', getApplicationById);

// UPDATE
router.put('/:id', updateApplication);

module.exports = router;
