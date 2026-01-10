const SanghExpense = require('../../model/Account Model/SanghExpense');
const Sangh = require('../../model/SanghModels/hierarchicalSanghModel');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

/* ===============================
   🔹 Expense ID Generator
================================ */
const generateExpenseId = async () => {
  const lastExpense = await SanghExpense.findOne()
    .sort({ createdAt: -1 })
    .select('expensesId');

  if (!lastExpense) return 'EXP-001';

  const lastNumber = parseInt(lastExpense.expensesId.split('-')[1], 10);
  const nextNumber = lastNumber + 1;

  return `EXP-${String(nextNumber).padStart(3, '0')}`;
};

/* ===============================
   🔹 Create Sangh Expense
================================ */
exports.createSanghExpense = async (req, res) => {
  try {
    const {
      expensesTitle,
      sanghId,
      category,
      amount,
      paymentType,
      billImage,
      additionalInfo,
    } = req.body;

    // 🔒 Basic validation
    // if (!expensesTitle || !sanghId || !category || !amount || !paymentType) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Required fields missing',
    //   });
    // }

    // ✅ Fetch sangh name from Sangh model
    const sangh = await Sangh.findById(sanghId).select('name');

    if (!sangh) {
      return res.status(404).json({
        success: false,
        message: 'Sangh not found',
      });
    }

    // ✅ Convert S3 URL to CDN
    const convertedBillImage = billImage
      ? convertS3UrlToCDN(billImage)
      : null;

    // ✅ Generate Expense ID
    const expensesId = await generateExpenseId();

    const expense = await SanghExpense.create({
      expensesId,
      expensesTitle,
      sanghId,
      sanghName: sangh.name, // ⬅️ auto from Sangh model
      category,
      amount,
      paymentType,
      billImage: convertedBillImage,
      additionalInfo,
      createdBy: req.user?._id,
    });

    return res.status(201).json({
      success: true,
      message: 'Sangh expense created successfully',
      data: expense,
    });
  } catch (error) {
    console.error('Create Sangh Expense Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

/* ===============================
   🔹 Get All Sangh Expenses (GLOBAL)
================================ */
exports.getAllSanghExpenses = async (req, res) => {
  try {
    const expenses = await SanghExpense.find()
      .populate({
        path: 'sanghId',
        select: 'name level',
      })
      .populate({
        path: 'createdBy',
        select: 'fullName profilePicture',
      })
      .sort({ createdAt: -1 });

    const formattedExpenses = expenses.map(exp => ({
      ...exp.toObject(),
      billImage: exp.billImage
        ? convertS3UrlToCDN(exp.billImage)
        : null,
    }));

    return res.status(200).json({
      success: true,
      count: formattedExpenses.length,
      data: formattedExpenses,
    });
  } catch (error) {
    console.error('Get All Sangh Expenses Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch expenses',
    });
  }
};
/* ===============================
   🔹 Get Sangh Expense By ExpenseId
================================ */
exports.getSanghExpenseByExpenseId = async (req, res) => {
  try {
    const { expensesId } = req.params;

    const expense = await SanghExpense.findOne({ expensesId })
      .populate({
        path: 'sanghId',
        select: 'name level',
      })
      .populate({
        path: 'createdBy',
        select: 'fullName profilePicture',
      });

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found',
      });
    }

    const formattedExpense = {
      ...expense.toObject(),
      billImage: expense.billImage
        ? convertS3UrlToCDN(expense.billImage)
        : null,
    };

    return res.status(200).json({
      success: true,
      data: formattedExpense,
    });
  } catch (error) {
    console.error('Get Expense By ID Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch expense',
    });
  }
};
