const mongoose = require("mongoose");
const Donation = require("../../model/Donation/donation");
const Tirth = require("../../model/TirthModels/tirthModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");
const { recordDonationIncome } = require("./tirthAccountingAutoController");

/**
 * Tirth Donation Settlement
 *
 * Paisa hamesha JPM ke Razorpay account me hi aata hai.
 * Ye controller sirf hisaab rakhta hai —
 *   kis tirth ke naam par kitna aaya,
 *   JPM ka commission kitna,
 *   tirth ko kitna dena baaki hai.
 *
 * Purane donations (jinme beneficiaryTirthId nahi hai) chhoote nahi —
 * wo bas kisi tirth se linked nahi hote, JPM ke apne hote hain.
 */

const num = (v) => Number(v) || 0;

/* 'YYYY-MM-DD' -> Date */
const toDay = (v) => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

/* ==================================================================
   TIRTH MANAGER — apne donations dekhe
================================================================== */

/**
 * GET /api/tirth-booking/manage/:tirthId/donations?status=&from=&to=
 */
const getTirthDonations = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { status, from, to } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 50);

    const query = {
      beneficiaryTirthId: tirthId,
      paymentStatus: "success",
    };
    if (status && status !== "all") query.settlementStatus = status;

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = toDay(from);
      if (to) {
        const t = toDay(to);
        if (t) query.createdAt.$lte = new Date(t.getTime() + 86399999);
      }
    }

    const [donations, all, tirth] = await Promise.all([
      Donation.find(query)
        .populate("userId", "fullName phoneNumber profilePicture")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      // stats ke liye poora data (filter se independent)
      Donation.find({
        beneficiaryTirthId: tirthId,
        paymentStatus: "success",
      })
        .select("amount commissionAmount payableAmount settlementStatus")
        .lean(),
      Tirth.findById(tirthId).select("donationCommissionPercent").lean(),
    ]);

    const stats = {
      totalDonations: all.length,
      totalReceived: 0,
      totalCommission: 0,
      totalPayable: 0,
      settledAmount: 0,
      pendingAmount: 0,
      commissionPercent: num(tirth?.donationCommissionPercent),
    };

    all.forEach((d) => {
      const amt = num(d.amount);
      const payable = num(d.payableAmount);
      stats.totalReceived += amt;
      stats.totalCommission += num(d.commissionAmount);
      stats.totalPayable += payable;
      if (d.settlementStatus === "settled") stats.settledAmount += payable;
      else stats.pendingAmount += payable;
    });

    return successResponse(res, {
      donations: donations.map((d) => ({ ...d, id: String(d._id) })),
      stats,
      pagination: {
        page,
        limit,
        total: all.length,
      },
    });
  } catch (error) {
    console.error("❌ getTirthDonations error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   PUBLIC — donate karte waqt tirth ka commission chahiye
================================================================== */

/**
 * GET /api/tirth-donation/info/:tirthId
 * Donation form ko batata hai ki kis tirth ko de rahe hain.
 */
const getTirthDonationInfo = async (req, res) => {
  try {
    const { tirthId } = req.params;

    const tirth = await Tirth.findOne({
      _id: tirthId,
      status: "active",
      applicationStatus: "approved",
    })
      .select(
        "basic.name address.city address.state photos donationCommissionPercent",
      )
      .lean();

    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    return successResponse(res, {
      tirth: {
        id: String(tirth._id),
        name: tirth.basic?.name || "",
        city: tirth.address?.city || "",
        state: tirth.address?.state || "",
        photo: tirth.photos?.[0] || "",
      },
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   ADMIN PANEL — settlement
================================================================== */

/**
 * GET /api/admin-panel/tirth-settlements
 * Har tirth ka pending amount — ek jagah.
 */
const getSettlementSummary = async (req, res) => {
  try {
    const rows = await Donation.aggregate([
      {
        $match: {
          paymentStatus: "success",
          beneficiaryTirthId: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$beneficiaryTirthId",
          // donation me jo naam mila (purane records me alag naam se tha)
          tirthName: {
            $last: { $ifNull: ["$beneficiaryTirthName", "$tirthName"] },
          },
          donations: { $sum: 1 },
          totalReceived: { $sum: { $toDouble: { $ifNull: ["$amount", 0] } } },
          totalCommission: { $sum: { $ifNull: ["$commissionAmount", 0] } },
          totalPayable: { $sum: { $ifNull: ["$payableAmount", 0] } },
          pendingAmount: {
            $sum: {
              $cond: [
                { $ne: ["$settlementStatus", "settled"] },
                { $ifNull: ["$payableAmount", 0] },
                0,
              ],
            },
          },
          pendingCount: {
            $sum: {
              $cond: [{ $ne: ["$settlementStatus", "settled"] }, 1, 0],
            },
          },
          needsReview: {
            $sum: {
              $cond: [{ $ne: ["$commissionSet", true] }, 1, 0],
            },
          },
          lastDonationAt: { $max: "$createdAt" },
        },
      },
      // ✅ Tirth collection se asli naam — donation me naam na ho to bhi
      // "Unnamed tirth" na dikhe
      {
        $lookup: {
          from: "tirths",
          localField: "_id",
          foreignField: "_id",
          pipeline: [{ $project: { "basic.name": 1, "address.city": 1 } }],
          as: "tirthDoc",
        },
      },
      {
        $addFields: {
          tirthName: {
            $ifNull: [
              { $arrayElemAt: ["$tirthDoc.basic.name", 0] },
              "$tirthName",
            ],
          },
          tirthCity: { $arrayElemAt: ["$tirthDoc.address.city", 0] },
        },
      },
      { $project: { tirthDoc: 0 } },
      { $sort: { pendingAmount: -1 } },
    ]);

    const totals = {
      tirths: rows.length,
      totalReceived: rows.reduce((s, r) => s + num(r.totalReceived), 0),
      totalCommission: rows.reduce((s, r) => s + num(r.totalCommission), 0),
      totalPending: rows.reduce((s, r) => s + num(r.pendingAmount), 0),
    };

    return successResponse(
      res,
      {
        settlements: rows.map((r) => ({
          tirthId: String(r._id),
          tirthName: r.tirthName || "",
          tirthCity: r.tirthCity || "",
          donations: r.donations,
          totalReceived: r.totalReceived,
          totalCommission: r.totalCommission,
          totalPayable: r.totalPayable,
          pendingAmount: r.pendingAmount,
          needsReview: r.needsReview,
          lastDonationAt: r.lastDonationAt,
        })),
        totals,
      },
      "OK",
    );
  } catch (error) {
    console.error("❌ getSettlementSummary error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/admin-panel/tirth-settlements/:tirthId
 * Ek tirth ki saari donations.
 */
const getTirthSettlementDetail = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { status = "pending" } = req.query;

    const query = {
      beneficiaryTirthId: tirthId,
      paymentStatus: "success",
    };
    if (status && status !== "all") query.settlementStatus = status;

    const [donations, tirth] = await Promise.all([
      Donation.find(query)
        .populate("userId", "fullName phoneNumber")
        .sort({ createdAt: -1 })
        .lean(),
      Tirth.findById(tirthId)
        .select("basic.name address contact team donationCommissionPercent")
        .lean(),
    ]);

    const pending = donations.filter((d) => d.settlementStatus !== "settled");

    // jinka commission abhi tay nahi hua
    const needsReview = donations.filter(
      (d) => d.settlementStatus !== "settled" && !d.commissionSet,
    );
    // settle ke liye taiyaar
    const readyToSettle = pending.filter((d) => d.commissionSet);

    return successResponse(
      res,
      {
        tirth: {
          id: String(tirthId),
          name: tirth?.basic?.name || "",
          city: tirth?.address?.city || "",
          state: tirth?.address?.state || "",
          phone: tirth?.contact?.primary || "",
          managerName: tirth?.team?.managerName || "",
          managerPhone: tirth?.team?.managerPhone || "",
          commissionPercent: num(tirth?.donationCommissionPercent),
        },
        donations: donations.map((d) => ({ ...d, id: String(d._id) })),
        pendingCount: pending.length,
        pendingAmount: pending.reduce((s, d) => s + num(d.payableAmount), 0),
        needsReviewCount: needsReview.length,
        readyCount: readyToSettle.length,
        readyAmount: readyToSettle.reduce(
          (s, d) => s + num(d.payableAmount),
          0,
        ),
      },
      "OK",
    );
  } catch (error) {
    console.error("❌ getTirthSettlementDetail error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/admin-panel/tirth-settlements/:tirthId/commission
 * body: { percent }
 *
 * Ye sirf aage aane wali donations par lagega —
 * purani donations me percent snapshot ho chuka hai.
 */
const updateCommission = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const percent = Number(req.body.percent);

    if (isNaN(percent) || percent < 0 || percent > 100) {
      return errorResponse(res, "Percent 0 se 100 ke beech hona chahiye", 400);
    }

    const tirth = await Tirth.findById(tirthId);
    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    tirth.donationCommissionPercent = percent;
    await tirth.save();

    return successResponse(
      res,
      { commissionPercent: percent },
      `Commission set to ${percent}% for future donations`,
    );
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/admin-panel/tirth-settlements/donation/:donationId/commission
 * body: { percent } ya { amount }
 *
 * Har donation par alag se commission tay hota hai.
 * Admin percent daale ya seedha amount — dono chalega.
 */
const setDonationCommission = async (req, res) => {
  try {
    const { donationId } = req.params;
    const { percent, amount } = req.body;

    const donation = await Donation.findById(donationId);
    if (!donation) return errorResponse(res, "Donation not found", 404);

    if (!donation.beneficiaryTirthId) {
      return errorResponse(res, "Ye donation kisi tirth ki nahi hai", 400);
    }
    if (donation.settlementStatus === "settled") {
      return errorResponse(
        res,
        "Settle ho chuki donation ka commission nahi badal sakta",
        400,
      );
    }

    const total = num(donation.amount);
    let commission = 0;
    let pct = 0;

    if (amount !== undefined && amount !== null && amount !== "") {
      commission = Math.round(num(amount));
      if (commission < 0 || commission > total) {
        return errorResponse(
          res,
          `Commission 0 se ₹${total} ke beech hona chahiye`,
          400,
        );
      }
      pct = total > 0 ? Math.round((commission / total) * 10000) / 100 : 0;
    } else {
      pct = Number(percent);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return errorResponse(
          res,
          "Percent 0 se 100 ke beech hona chahiye",
          400,
        );
      }
      commission = Math.round((total * pct) / 100);
    }

    donation.commissionPercent = pct;
    donation.commissionAmount = commission;
    donation.payableAmount = total - commission;
    donation.commissionSet = true;
    await donation.save();

    return successResponse(
      res,
      {
        commissionPercent: pct,
        commissionAmount: commission,
        payableAmount: total - commission,
      },
      `Trust share set — ₹${commission.toLocaleString("en-IN")} (${pct}%)`,
    );
  } catch (error) {
    console.error("❌ setDonationCommission error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/admin-panel/tirth-settlements/:tirthId/settle
 * body: { donationIds: [], settlementRef, note }
 *
 * Paisa bahar bheja ja chuka hai — yahan sirf record hota hai.
 */
const markSettled = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { donationIds, settlementRef, note } = req.body;

    const query = {
      beneficiaryTirthId: tirthId,
      paymentStatus: "success",
      settlementStatus: { $ne: "settled" },
      commissionSet: true, // jinka commission tay nahi, wo settle nahi honge
    };

    // kuch chuni hui, warna saari pending
    if (Array.isArray(donationIds) && donationIds.length > 0) {
      query._id = { $in: donationIds };
    }

    const pending = await Donation.find(query)
      .select("_id payableAmount")
      .lean();

    if (pending.length === 0) {
      return errorResponse(res, "Settle karne ke liye kuch nahi hai", 400);
    }

    const amount = pending.reduce((s, d) => s + num(d.payableAmount), 0);

    const pendingIds = pending.map((d) => d._id);

    await Donation.updateMany(query, {
      $set: {
        settlementStatus: "settled",
        settledAt: new Date(),
        settlementRef: settlementRef || "",
        settlementNote: note || "",
      },
    });

    /* har settle hui donation ki accounting entry */
    try {
      const settled = await Donation.find({ _id: { $in: pendingIds } })
        .populate("userId", "fullName")
        .lean();
      for (const d of settled) {
        await recordDonationIncome(d, req.admin?._id);
      }
    } catch (e) {
      console.log("ℹ️ donation accounting skipped:", e.message);
    }

    /* tirth managers ko notification */
    try {
      const tirth = await Tirth.findById(tirthId).select("basic.name").lean();
      const managers = await User.find({ "tirthRoles.tirthId": tirthId })
        .select("_id")
        .lean();

      const Notification = mongoose.model("Notification");
      const { sendPushToUsers } = require("../../config/firebaseAdmin");

      const message = `₹${amount.toLocaleString("en-IN")} has been settled to ${
        tirth?.basic?.name || "your Tirth"
      } for ${pending.length} donation${pending.length > 1 ? "s" : ""}${
        settlementRef ? ` (Ref: ${settlementRef})` : ""
      }`;

      await Promise.all(
        managers.map(async (m) => {
          await Notification.create({
            senderId: m._id,
            receiverId: m._id,
            type: "tirth_donation_settled",
            tirthId,
            message,
          });
        }),
      );

      if (managers.length > 0) {
        await sendPushToUsers(
          managers.map((m) => m._id),
          {
            title: "Donation Settled",
            body: message,
            data: {
              type: "notification",
              notifType: "tirth_donation_settled",
              tirthId: String(tirthId),
            },
          },
        );
      }
    } catch (e) {
      console.log("ℹ️ settlement notification skipped:", e.message);
    }

    return successResponse(
      res,
      { settledCount: pending.length, settledAmount: amount },
      `${pending.length} donations settled — ₹${amount.toLocaleString("en-IN")}`,
    );
  } catch (error) {
    console.error("❌ markSettled error:", error);
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  getTirthDonations,
  getTirthDonationInfo,

  getSettlementSummary,
  getTirthSettlementDetail,
  updateCommission,
  markSettled,
  setDonationCommission,
};
