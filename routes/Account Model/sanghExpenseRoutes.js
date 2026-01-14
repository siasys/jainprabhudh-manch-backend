const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middlewares/authMiddlewares');
const  upload = require('../../middlewares/upload');
const { createExpense, getSanghExpenses, getExpenseById, getAllExpenses } = require('../../controller/Account Model/sanghExpenseController');

// 🔐 Protected routes
router.use(authMiddleware);

// ✅ Create expense
router.post('/', upload.expenseBillUpload, createExpense);
router.get('/all', getAllExpenses);

// ✅ Get all expenses of a sangh
router.get('/sangh/:sanghId', getSanghExpenses);

// ✅ Get single expense
router.get('/:expenseId', getExpenseById);

module.exports = router;
