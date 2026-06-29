const mongoose = require("mongoose");
const VyaparRating = require("../../model/VyaparModels/Vyaparratingmodel");
const JainVyapar = require("../../model/VyaparModels/vyaparModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");

/**
 * POST /vyapar/rate/:vyaparId
 * Body: { rating: 1–5, text?: string }
 *
 * Submit or update the logged-in user's rating for a business.
 * Uses upsert — re-rating overwrites the previous value (no duplicates).
 */
const submitRating = async (req, res) => {
  try {
    const { vyaparId } = req.params;
    const { rating, text = "" } = req.body;
    const userId = req.user._id;

    // Validate
    if (!mongoose.Types.ObjectId.isValid(vyaparId)) {
      return errorResponse(res, "Invalid business id", 400);
    }
    const numRating = Number(rating);
    if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
      return errorResponse(res, "Rating must be between 1 and 5", 400);
    }

    // Business must exist & be approved+active (don't allow rating rejected/pending)
    const business = await JainVyapar.findById(vyaparId).select(
      "applicationStatus status userId",
    );
    if (!business) {
      return errorResponse(res, "Business not found", 404);
    }
    if (
      business.applicationStatus !== "approved" ||
      business.status !== "active"
    ) {
      return errorResponse(
        res,
        "This business is not open for ratings yet",
        400,
      );
    }

    // Optional: prevent owner from rating their own business
    if (business.userId && business.userId.toString() === userId.toString()) {
      return errorResponse(res, "You cannot rate your own business", 400);
    }

    // Upsert — one rating per (vyapar, user)
    const ratingDoc = await VyaparRating.findOneAndUpdate(
      { vyaparId, userId },
      { $set: { rating: numRating, text } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Recompute summary so client can update UI immediately
    const summary = await computeSummary(vyaparId);

    return successResponse(res, {
      rating: ratingDoc,
      summary,
    });
  } catch (error) {
    // Duplicate-key race condition fallback
    if (error && error.code === 11000) {
      return errorResponse(res, "You have already rated this business", 409);
    }
    console.error("submitRating error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /vyapar/rate/:vyaparId
 * Remove the logged-in user's rating for this business.
 */
const removeRating = async (req, res) => {
  try {
    const { vyaparId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(vyaparId)) {
      return errorResponse(res, "Invalid business id", 400);
    }

    const result = await VyaparRating.findOneAndDelete({ vyaparId, userId });
    if (!result) {
      return errorResponse(res, "You haven't rated this business", 404);
    }

    const summary = await computeSummary(vyaparId);
    return successResponse(res, { removed: true, summary });
  } catch (error) {
    console.error("removeRating error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /vyapar/rating-summary/:vyaparId
 * Returns { averageRating, totalRatings, breakdown: {1..5}, userRating }
 * Public-ish — userRating is only included if request is authenticated.
 */
const getRatingSummary = async (req, res) => {
  try {
    const { vyaparId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(vyaparId)) {
      return errorResponse(res, "Invalid business id", 400);
    }

    const summary = await computeSummary(vyaparId);

    let userRating = null;
    if (req.user?._id) {
      const own = await VyaparRating.findOne({
        vyaparId,
        userId: req.user._id,
      }).select("rating text createdAt updatedAt");
      userRating = own || null;
    }

    return successResponse(res, { ...summary, userRating });
  } catch (error) {
    console.error("getRatingSummary error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /vyapar/ratings/:vyaparId?page=1&limit=20
 * Paginated list of all ratings (reviews) for a business with the
 * rater's name + profile pic populated.
 */
const getBusinessRatings = async (req, res) => {
  try {
    const { vyaparId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    if (!mongoose.Types.ObjectId.isValid(vyaparId)) {
      return errorResponse(res, "Invalid business id", 400);
    }

    const [ratings, total] = await Promise.all([
      VyaparRating.find({ vyaparId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "fullName profileImage name")
        .lean(),
      VyaparRating.countDocuments({ vyaparId }),
    ]);

    return successResponse(res, {
      ratings,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + ratings.length < total,
      },
    });
  } catch (error) {
    console.error("getBusinessRatings error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /vyapar/ratings/batch
 * Body: { ids: [vyaparId, vyaparId, ...] }
 *
 * Returns an object keyed by vyaparId:
 *   { [vyaparId]: { averageRating, totalRatings, userRating } }
 *
 * Used by BusinessListScreen to enrich the list in ONE network call
 * after fetching businesses. Keeps existing getAllVyapars untouched.
 */
const getRatingsBatch = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return successResponse(res, {});
    }

    // Sanitize ids
    const validIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (validIds.length === 0) return successResponse(res, {});

    // Aggregate average + count per business in one query
    const summaries = await VyaparRating.aggregate([
      { $match: { vyaparId: { $in: validIds } } },
      {
        $group: {
          _id: "$vyaparId",
          averageRating: { $avg: "$rating" },
          totalRatings: { $sum: 1 },
        },
      },
    ]);

    // Map: vyaparId -> summary
    const out = {};
    summaries.forEach((s) => {
      out[s._id.toString()] = {
        averageRating: Math.round(s.averageRating * 10) / 10, // 1 decimal
        totalRatings: s.totalRatings,
        userRating: null,
      };
    });

    // Ensure every requested id has an entry (even if 0 ratings)
    validIds.forEach((id) => {
      const key = id.toString();
      if (!out[key]) {
        out[key] = { averageRating: 0, totalRatings: 0, userRating: null };
      }
    });

    // If user is logged in, also include their own rating per business
    if (req.user?._id) {
      const myRatings = await VyaparRating.find({
        vyaparId: { $in: validIds },
        userId: req.user._id,
      })
        .select("vyaparId rating")
        .lean();

      myRatings.forEach((r) => {
        const key = r.vyaparId.toString();
        if (out[key]) out[key].userRating = r.rating;
      });
    }

    return successResponse(res, out);
  } catch (error) {
    console.error("getRatingsBatch error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/* ────────────────────────────────────────────────
   Internal helper — reused by submit/remove/summary
   ──────────────────────────────────────────────── */
const computeSummary = async (vyaparId) => {
  const result = await VyaparRating.aggregate([
    { $match: { vyaparId: new mongoose.Types.ObjectId(vyaparId) } },
    {
      $group: {
        _id: "$vyaparId",
        averageRating: { $avg: "$rating" },
        totalRatings: { $sum: 1 },
        breakdown: { $push: "$rating" },
      },
    },
  ]);

  if (result.length === 0) {
    return {
      averageRating: 0,
      totalRatings: 0,
      breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
  }

  const r = result[0];
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  r.breakdown.forEach((star) => {
    if (breakdown[star] !== undefined) breakdown[star] += 1;
  });

  return {
    averageRating: Math.round(r.averageRating * 10) / 10,
    totalRatings: r.totalRatings,
    breakdown,
  };
};

module.exports = {
  submitRating,
  removeRating,
  getRatingSummary,
  getBusinessRatings,
  getRatingsBatch,
};
