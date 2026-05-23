const express = require('express');
const { 
  createReport, 
  getReportById, 
  getAllReports, 
  updateReport, 
  deleteReport,
  getSubmittedReports,
  getReceivedReports,
  updateReportStatus,
  getTopPerformers
} = require('../../controller/ReportingControllers/reportingController');
const { authMiddleware } = require('../../middlewares/authMiddlewares');
const { validateRequest } = require('../../middlewares/validationMiddleware');
const { check } = require('express-validator');
const { reportingUpload } = require('../../middlewares/upload');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);


const statusValidation = [
  check('status').isIn(['submitted', 'reviewed', 'approved']).withMessage('Invalid status')
];

// POST: Create a new report
router.post("/", reportingUpload, createReport);



// GET: Get reports received by a specific Sangh
router.get('/received', getReceivedReports);

// GET: Get reports submitted by a specific Sangh
router.get('/submitted/', getSubmittedReports);

// GET: Get top performing Sanghs
router.get('/top-performers', getTopPerformers);



// GET: Get all reports (with filtering)
router.get('/', getAllReports);
// GET: Get a single report by ID
router.get('/:id', getReportById);
// PUT: Update a report by ID
router.put('/:id', validateRequest, updateReport);

// PATCH: Update report status and feedback
router.patch('/:id/status', statusValidation, validateRequest, updateReportStatus);

// DELETE: Delete a report by ID
router.delete('/:id', deleteReport);




module.exports = router;
