const express = require('express');
const router = express.Router();
const projectController = require('../../controller/SanghControllers/projectModelCtrl');
const {authMiddleware} = require('../../middlewares/authMiddlewares');

router.use(authMiddleware);
// 🔐All routes protected by auth
router.post('/projects', projectController.createProject);
router.get('/projects', projectController.getAllProjects);
router.get('/sangh/:sanghId', projectController.getProjectsBySanghId);
router.get('/projects/:id', projectController.getProjectById);
router.put('/projects/:id', projectController.updateProject);
router.delete('/projects/:id', projectController.deleteProject);

module.exports = router;
