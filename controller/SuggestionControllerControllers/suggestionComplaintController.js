const SuggestionComplaint = require('../../model/SuggestionComplaintModels/SuggestionComplaint');
const User = require('../../model/UserRegistrationModels/userModel');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const { successResponse, errorResponse } = require('../../utils/apiResponse');
const { createSuggestionNotification, createComplaintNotification, createNotification } = require('../../utils/notificationUtils');

// Create Suggestion / Complaint
exports.createSuggestionComplaint = async (req, res) => {
  try {
    const { type, subject, description, recipient } = req.body;

    // Basic validation
    if (!type || !subject || !description) {
      return errorResponse(res, 'All required fields must be provided', 400);
    }

    // ❌ Allow only superadmin
    if (!recipient || recipient.type !== 'superadmin') {
      return errorResponse(
        res,
        'Suggestion / Complaint can only be sent to Superadmin',
        403
      );
    }

    // Find superadmin
    const superadmin = await User.findOne({ role: 'superadmin' }).select('_id');
    if (!superadmin) {
      return errorResponse(res, 'Superadmin user not found', 404);
    }

    // Force recipient to superadmin
    const finalRecipient = {
      type: 'superadmin',
      userId: superadmin._id
    };

    // Save submission
    const newSubmission = new SuggestionComplaint({
      type,
      subject,
      description,
      recipient: finalRecipient,
      submittedBy: req.user._id
    });

    await newSubmission.save();

    // Sender name
    const sender = await User.findById(req.user._id, 'firstName lastName');
    const senderName = sender
      ? `${sender.firstName} ${sender.lastName}`
      : 'A user';

    // 🔔 Notification only to superadmin
    if (type === 'suggestion') {
      await createSuggestionNotification({
        senderId: req.user._id,
        receiverId: superadmin._id,
        entityId: newSubmission._id,
        subject,
        senderName
      });
    } 
    else if (type === 'complaint') {
      await createComplaintNotification({
        senderId: req.user._id,
        receiverId: superadmin._id,
        entityId: newSubmission._id,
        subject,
        senderName
      });
    } 
    else if (type === 'request') {
      await createNotification({
        senderId: req.user._id,
        receiverId: superadmin._id,
        entityId: newSubmission._id,
        subject,
        senderName,
        type: 'request'
      });
    }

    return successResponse(
      res,
      `Your ${type} has been submitted to Superadmin successfully`,
      { reference: newSubmission._id },
      201
    );

  } catch (error) {
    console.error('Error creating suggestion/complaint:', error);
    return errorResponse(res, 'Internal Server Error', 500);
  }
};

// Get All Suggestions & Complaints (Superadmin View)
exports.getAllSuggestionsComplaint = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const submissions = await SuggestionComplaint.find()
      .populate(
        'submittedBy',
        'firstName lastName fullName profilePicture phoneNumber location jainAadharNumber'
      )
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await SuggestionComplaint.countDocuments();

    return res.status(200).json({
      success: true,
      message: 'All suggestions/complaints retrieved successfully',
      data: {
        submissions,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Internal Server Error' });
  }
};

// Get All Suggestions / Complaints (Admin or recipient view)
exports.getAllSuggestionsComplaints = async (req, res) => {
  try {
    const { type, status, view } = req.query;
    const userId = req.user._id;
    const isSuperAdmin = req.user.role === 'superadmin';

    let query = {};

    if (type) query.type = type;
    if (status) query.status = status;

    if (!isSuperAdmin) {
      query.submittedBy = userId;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const submissions = await SuggestionComplaint.find(query)
      .populate('submittedBy', 'firstName lastName fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await SuggestionComplaint.countDocuments(query);

    return successResponse(res, 'Suggestions/complaints retrieved successfully', {
      submissions,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error retrieving suggestions/complaints:', error);
    return errorResponse(res, 'Internal Server Error', 500);
  }
};



// Get Single Suggestion / Complaint by ID
exports.getSuggestionComplaintById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const isSuperAdmin = req.user.role === 'superadmin';

    const submission = await SuggestionComplaint.findById(id)
      .populate('submittedBy', 'firstName lastName fullName');

    if (!submission) {
      return errorResponse(res, 'Suggestion/complaint not found', 404);
    }

    const isSubmitter =
      submission.submittedBy._id.toString() === userId.toString();

    if (!isSubmitter && !isSuperAdmin) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    return successResponse(
      res,
      'Suggestion/complaint retrieved successfully',
      submission
    );
  } catch (error) {
    console.error('Error retrieving suggestion/complaint:', error);
    return errorResponse(res, 'Internal Server Error', 500);
  }
};

// Update Suggestion/Complaint Status and Response
exports.updateSuggestionComplaint = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, response } = req.body;
    const userId = req.user._id;

    if (req.user.role !== 'superadmin') {
      return errorResponse(res, 'Only superadmin can update', 403);
    }

    const submission = await SuggestionComplaint.findById(id).populate(
      'submittedBy',
      'firstName lastName fullName'
    );

    if (!submission) {
      return errorResponse(res, 'Suggestion/complaint not found', 404);
    }

    const oldStatus = submission.status;

    if (status) submission.status = status;
    if (response) submission.response = response;

    await submission.save();

    if (status && status !== oldStatus) {
      await createNotification({
        senderId: userId,
        receiverId: submission.submittedBy._id,
        type: submission.type,
        message: `Your ${submission.type} "${submission.subject}" status updated to ${status}`,
        entityId: submission._id,
        entityType: 'SuggestionComplaint',
      });
    }

    return successResponse(
      res,
      'Suggestion/complaint updated successfully',
      submission
    );
  } catch (error) {
    console.error('Error updating suggestion/complaint:', error);
    return errorResponse(res, 'Internal Server Error', 500);
  }
};

// Delete Suggestion / Complaint
exports.deleteSuggestionComplaint = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const isSuperAdmin = req.user.role === 'superadmin';
    const submission = await SuggestionComplaint.findById(id);
    if (!submission) {
      return errorResponse(res, 'Suggestion/complaint not found', 404);
    }
    // Only submitter or superadmin can delete
    const isSubmitter = submission.submittedBy.toString() === userId.toString();
    if (!isSubmitter && !isSuperAdmin) {
      return errorResponse(res, 'You do not have permission to delete this submission', 403);
    }
    await SuggestionComplaint.findByIdAndDelete(id);
    return successResponse(res, 'Suggestion/complaint deleted successfully');
  } catch (error) {
    console.error('Error deleting suggestion/complaint:', error);
    return errorResponse(res, 'Internal Server Error', 500);
  }
};
