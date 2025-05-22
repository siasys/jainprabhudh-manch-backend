const express = require('express');
const router = express.Router();
const jainHostalController = require('../../controller/Jainhostal/jainHostalController');
const upload = require('../../middlewares/upload')
// Routes for Jain Hostal
router.post('/',  upload.single('jainHostal'),jainHostalController.createHostal);

router.get('/', jainHostalController.getAllHostals);
router.post('/like/:hostalId', jainHostalController.likeHostal);
router.get('/:id', jainHostalController.getHostalById);
router.put('/:id', jainHostalController.updateHostal);
router.delete('/:id', jainHostalController.deleteHostal);

module.exports = router;
