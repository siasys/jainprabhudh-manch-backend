const Expense = require('../../model/Account Model/SanghExpense');
const Sangh = require('../../model/SanghModels/hierarchicalSanghModel');
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

/* ===============================
   🔹 Expense ID Generator
================================ */
const generateExpenseId = async () => {
  const lastExpense = await Expense.findOne()
    .sort({ createdAt: -1 })
    .select('expensesId');

  if (!lastExpense || !lastExpense.expensesId) {
    return 'EXP-001';
  }

  const lastNumber = parseInt(
    lastExpense.expensesId.split('-')[1],
    10
  );

  const nextNumber = lastNumber + 1;

  return `EXP-${String(nextNumber).padStart(3, '0')}`;
};


exports.createExpense = async (req, res) => {
  try {
    const {
      sanghId,
      expenseTitle,
      expenseDate,
      amount,
      paymentToName,
      category,
      projectName,
      meetingLocation,
      meetingPurpose,
      otherCategory,
      paymentType,
      invoiceNumber,
      additionalNote,
    } = req.body;

    const userId = req.user.id;

    // 🔹 Generate Expense ID
    const expensesId = await generateExpenseId();

    let uploadBill = '';
    if (req.files?.uploadBill?.[0]?.location) {
      uploadBill = convertS3UrlToCDN(req.files.uploadBill[0].location);
    }

    const expense = await Expense.create({
      expensesId,
      sanghId,
      userId,
      expenseTitle,
      expenseDate,
      amount,
      paymentToName,
      category,
      projectName,
      meetingLocation,
      meetingPurpose,
      otherCategory,
      paymentType,
      uploadBill,
      invoiceNumber,
      additionalNote,
    });

    res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      data: expense,
    });

  } catch (err) {
    console.error('❌ Create Expense Error:', err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
exports.getAllExpenses = async (req, res) => {
  try {
    const {
      sanghId,
      status,
      category,
      paymentType,
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};

    // 🔹 Optional filters
    if (sanghId) query.sanghId = sanghId;
    if (status) query.status = status;
    if (category) query.category = category;
    if (paymentType) query.paymentType = paymentType;

    const expenses = await Expense.find(query)
      .populate('userId', 'fullName')
      .populate('sanghId', 'name level location')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Expense.countDocuments(query);

    res.status(200).json({
      success: true,
      data: expenses,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });

  } catch (err) {
    console.error('❌ Get All Expenses Error:', err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
// ✅ GET ALL EXPENSES (SANGH)
exports.getSanghExpenses = async (req, res) => {
  try {
    const { sanghId } = req.params;

    const expenses = await Expense.find({ sanghId })
      .populate('userId', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: expenses,
    });

  } catch (err) {
    console.error('❌ Get Expenses Error:', err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ✅ GET SINGLE EXPENSE
exports.getExpenseById = async (req, res) => {
  try {
    const { expenseId } = req.params;

    const expense = await Expense.findById(expenseId)
      .populate('userId', 'name')
      .populate('sanghId', 'name level');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found',
      });
    }

    res.status(200).json({
      success: true,
      data: expense,
    });

  } catch (err) {
    console.error('❌ Get Expense Error:', err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

