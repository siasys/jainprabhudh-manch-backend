const express = require('express');
const router = express.Router();
const upload = require('../../middlewares/upload');
const {createBailor, getAllBailors } = require('../../controller/Bailors/bailorController');

router.post('/', upload.fields([{name: 'bailorImage', maxCount: 10}]), createBailor);
router.get('/', getAllBailors);

module.exports = router;
