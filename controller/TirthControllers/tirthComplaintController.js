const mongoose = require("mongoose");
const TirthComplaint = require("../../model/TirthModels/tirthComplaintModel");
const TirthBooking = require("../../model/TirthModels/tirthBookingModel");
const Tirth = require("../../model/TirthModels/tirthModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");

const CATEGORIES = [
  "cleanliness",
  "staff",
  "food",
  "room",
  "booking",
  "facility",
  "other",
];

const STATUSES = ["open", "in_progress", "resolved", "closed"];

/* notification bhejne ki koshish — fail ho to complaint na ruke */
const safeNotify = async ({ userId, title, message, type }) => {
  try {
    if (!userId) return;
    const Notification = mongoose.model("Notification");
    await Notification.create({
      senderId: userId,
      receiverId: userId,
      type: type || "tirth_complaint",
      message,
    });

    // model ka hook self-notification par push skip karta hai — khud bhejo
    const { sendPushToUsers } = require("../../config/firebaseAdmin");
    await sendPushToUsers([userId], {
      title,
      body: message,
      data: { type: "notification", notifType: type || "tirth_complaint" },
    });
  } catch (err) {
    console.log("ℹ️ complaint notification skipped:", err.message);
  }
};

/* ==================================================================
   USER SIDE
================================================================== */

/**
 * User complaint bhejta hai
 * POST /api/tirth-complaint/:tirthId
 */
const createComplaint = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { category, subject, message } = req.body;

    if (!subject || !String(subject).trim()) {
      return errorResponse(res, "Subject is required", 400);
    }
    if (!message || !String(message).trim()) {
      return errorResponse(res, "Please describe the issue", 400);
    }

    const tirth = await Tirth.findOne({
      _id: tirthId,
      status: "active",
      applicationStatus: "approved",
    })
      .select("basic address")
      .lean();
    if (!tirth) {
      // ✅ Saaf batao kyun — pehle har case me "Tirth not found" aata tha,
      // jisse lagta tha kuch toota hai (niyam wahi hai: sirf approved + active)
      const exists = mongoose.Types.ObjectId.isValid(String(tirthId))
        ? await Tirth.findById(tirthId)
            .select("status applicationStatus")
            .lean()
        : null;

      if (!exists) return errorResponse(res, "Tirth not found", 404);

      return errorResponse(
        res,
        exists.applicationStatus !== "approved"
          ? "This Tirth is not approved yet. You can raise a complaint once it is approved."
          : "This Tirth is not active right now, so a complaint cannot be raised.",
        400,
      );
    }

    // apne hi tirth ki complaint nahi
    if (isUserTirthManager(req.user, tirthId)) {
      return errorResponse(
        res,
        "You cannot complain about your own Tirth",
        400,
      );
    }

    // spam rok: 24 ghante me 3 se zyada nahi
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await TirthComplaint.countDocuments({
      userId: req.user._id,
      tirthId,
      createdAt: { $gte: dayAgo },
    });
    if (recent >= 3) {
      return errorResponse(
        res,
        "You cannot raise more than 3 complaints in 24 hours",
        429,
      );
    }

    // is user ki is tirth me koi booking hai? (list me upar dikhane ke liye)
    const booking = await TirthBooking.findOne({
      userId: req.user._id,
      tirthId,
      status: { $in: ["approved", "completed", "pending"] },
    })
      .sort({ createdAt: -1 })
      .select("_id")
      .lean();

    const complaint = await TirthComplaint.create({
      tirthId,
      tirthName: tirth.basic?.name || "",
      tirthCity: tirth.address?.city || "",
      tirthState: tirth.address?.state || "",

      userId: req.user._id,
      userName:
        req.user.fullName ||
        `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() ||
        "User",
      userPhone: req.user.phoneNumber || "",

      hasBooking: !!booking,
      bookingId: booking?._id || null,

      category: CATEGORIES.includes(category) ? category : "other",
      subject: String(subject).trim(),
      message: String(message).trim(),
    });

    // tirth managers ko notify
    try {
      const managers = await User.find({ "tirthRoles.tirthId": tirthId })
        .select("_id")
        .lean();
      await Promise.all(
        managers.map((m) =>
          safeNotify({
            userId: m._id,
            title: "New complaint",
            message: `${complaint.userName} has raised a complaint: ${complaint.subject}`,
            type: "tirth_complaint",
          }),
        ),
      );
    } catch (e) {
      console.log("ℹ️ manager notify skipped:", e.message);
    }

    return successResponse(res, {
      message: "Your complaint has been sent to the Tirth",
      complaint,
    });
  } catch (error) {
    console.error("❌ createComplaint error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * User apni saari complaints dekhe
 * GET /api/tirth-complaint/my?status=&page=&limit=
 */
const getMyComplaints = async (req, res) => {
  try {
    const { status } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);

    const query = { userId: req.user._id };
    if (status && status !== "all") query.status = status;

    const [complaints, total, unreadReplies] = await Promise.all([
      TirthComplaint.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthComplaint.countDocuments(query),
      TirthComplaint.countDocuments({
        userId: req.user._id,
        "response.text": { $ne: "" },
        isReadByUser: false,
      }),
    ]);

    return successResponse(res, {
      complaints: complaints.map((c) => ({ ...c, id: String(c._id) })),
      unreadReplies,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * User ne jawab padh liya
 * PATCH /api/tirth-complaint/:complaintId/read
 */
const markReadByUser = async (req, res) => {
  try {
    const complaint = await TirthComplaint.findById(req.params.complaintId);
    if (!complaint) return errorResponse(res, "Complaint not found", 404);

    if (String(complaint.userId) !== String(req.user._id)) {
      return errorResponse(res, "Not allowed", 403);
    }

    complaint.isReadByUser = true;
    await complaint.save();

    return successResponse(res, { ok: true });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   MANAGER SIDE
================================================================== */

/**
 * Manage → Complaints
 * GET /api/tirth-booking/manage/:tirthId/complaints?status=&search=
 *
 * Booking wale users ki complaints upar dikhti hain.
 */
const getTirthComplaints = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { status, search } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 50);

    const query = { tirthId };
    if (status && status !== "all") query.status = status;

    if (search && String(search).trim()) {
      const rx = new RegExp(
        String(search)
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      query.$or = [
        { subject: rx },
        { message: rx },
        { userName: rx },
        { complaintCode: rx },
      ];
    }

    const [complaints, counts] = await Promise.all([
      TirthComplaint.find(query)
        // booking wale pehle, phir naye
        .sort({ hasBooking: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TirthComplaint.aggregate([
        { $match: { tirthId: new mongoose.Types.ObjectId(String(tirthId)) } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const countMap = {
      open: 0,
      in_progress: 0,
      resolved: 0,
      closed: 0,
      all: 0,
    };
    counts.forEach((c) => {
      countMap[c._id] = c.count;
      countMap.all += c.count;
    });

    return successResponse(res, {
      complaints: complaints.map((c) => ({ ...c, id: String(c._id) })),
      counts: countMap,
    });
  } catch (error) {
    console.error("❌ getTirthComplaints error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Manager jawab deta hai / status badalta hai
 * PUT /api/tirth-booking/manage/complaints/:complaintId
 * body: { response, status }
 */
const respondToComplaint = async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { response, status } = req.body;

    const complaint = await TirthComplaint.findById(complaintId);
    if (!complaint) return errorResponse(res, "Complaint not found", 404);

    if (!isUserTirthManager(req.user, complaint.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    const hadResponse = !!complaint.response?.text;
    let replied = false;

    if (response !== undefined && String(response).trim()) {
      complaint.response = {
        text: String(response).trim(),
        respondedBy: req.user._id,
        respondedAt: new Date(),
      };
      complaint.isReadByUser = false; // naya jawab — user ko dikhana hai
      replied = true;
    }

    if (status !== undefined && STATUSES.includes(status)) {
      complaint.status = status;
    } else if (replied && complaint.status === "open") {
      // jawab de diya to apne aap in_progress
      complaint.status = "in_progress";
    }

    complaint.isReadByTirth = true;
    await complaint.save();

    // user ko notify — sirf tab jab naya jawab ho ya status badla ho
    if (replied || status) {
      const statusText = {
        open: "is open",
        in_progress: "is being worked on",
        resolved: "has been resolved",
        closed: "has been closed",
      };

      await safeNotify({
        userId: complaint.userId,
        title: replied ? "Tirth replied" : "Complaint update",
        message: replied
          ? `${complaint.tirthName} has replied to your complaint "${complaint.subject}"`
          : `Your complaint "${complaint.subject}" ${statusText[complaint.status] || "has been updated"}`,
        type: "tirth_complaint_reply",
      });
    }

    return successResponse(res, {
      message: replied ? "Reply sent successfully" : "Status updated",
      complaint,
    });
  } catch (error) {
    console.error("❌ respondToComplaint error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Manager ne complaint padh li (badge count ke liye)
 * PATCH /api/tirth-booking/manage/complaints/:complaintId/read
 */
const markReadByTirth = async (req, res) => {
  try {
    const complaint = await TirthComplaint.findById(req.params.complaintId);
    if (!complaint) return errorResponse(res, "Complaint not found", 404);

    if (!isUserTirthManager(req.user, complaint.tirthId)) {
      return errorResponse(res, "Not allowed", 403);
    }

    complaint.isReadByTirth = true;
    await complaint.save();

    return successResponse(res, { ok: true });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  CATEGORIES,
  STATUSES,

  createComplaint,
  getMyComplaints,
  markReadByUser,

  getTirthComplaints,
  respondToComplaint,
  markReadByTirth,
};
