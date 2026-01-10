const express = require('express');
const router = express.Router();

const { createSanghExpense, getAllSanghExpenses, getSanghExpenseByExpenseId } = require('../../controller/Account Model/sanghExpenseController');

// Create Expense
router.post('/', createSanghExpense);

router.get('/sangh-expenses', getAllSanghExpenses);

router.get('/sangh-expenses/:expensesId', getSanghExpenseByExpenseId);

module.exports = router;
