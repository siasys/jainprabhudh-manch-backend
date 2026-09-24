const TirthAnnouncement = require("../../model/TirthModels/tirthAnnouncementModel");
const Tirth = require("../../model/TirthModels/tirthModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { isUserTirthManager } = require("../../middlewares/tirthBookingAccess");

const CATEGORIES = ["general", "event", "pravachan", "closure", "urgent"];

/* 'YYYY-MM-DD' -> us din ka aakhri pal (taaki poora din valid rahe) */
const toEndOfDay = (v) => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T23:59:59.999Z`);
  return isNaN(d.getTime()) ? null : d;
};

const toDay = (v) => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

/* default 7 din baad expire */
const defaultExpiry = () => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

/* ==================================================================
   PUBLIC — home feed
================================================================== */

/**
 * Home feed ke liye — saare live announcements
 * GET /api/tirth-announcement/feed?limit=
 */
const getAnnouncementFeed = async (req, res) => {
  try {
    const limit = Math.min(20, Number(req.query.limit) || 10);

    const announcements = await TirthAnnouncement.find({
      status: "active",
      expiresAt: { $gte: new Date() },
    })
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return successResponse(res, {
      announcements: announcements.map((a) => ({
        ...a,
        id: String(a._id),
      })),
      count: announcements.length,
    });
  } catch (error) {
    console.error("❌ getAnnouncementFeed error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Ek tirth ki public announcements (profile page ke liye)
 * GET /api/tirth-announcement/tirth/:tirthId
 */
const getTirthAnnouncements = async (req, res) => {
  try {
    const { tirthId } = req.params;

    const announcements = await TirthAnnouncement.find({
      tirthId,
      status: "active",
      expiresAt: { $gte: new Date() },
    })
      .sort({ isPinned: -1, createdAt: -1 })
      .lean();

    return successResponse(res, {
      announcements: announcements.map((a) => ({ ...a, id: String(a._id) })),
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * View count badhao (optional, feed me dikhne par)
 * PATCH /api/tirth-announcement/:announcementId/view
 */
const markViewed = async (req, res) => {
  try {
    await TirthAnnouncement.updateOne(
      { _id: req.params.announcementId },
      { $inc: { views: 1 } },
    );
    return successResponse(res, { ok: true });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/* ==================================================================
   MANAGER
================================================================== */

/**
 * Manage → Announcements — list (live + expired dono)
 * GET /api/tirth-booking/manage/:tirthId/announcements?filter=live|expired|all
 */
const getManageAnnouncements = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { filter = "all" } = req.query;

    const now = new Date();
    const query = { tirthId, status: "active" };

    if (filter === "live") query.expiresAt = { $gte: now };
    if (filter === "expired") query.expiresAt = { $lt: now };

    const [announcements, liveCount, expiredCount] = await Promise.all([
      TirthAnnouncement.find(query)
        .sort({ isPinned: -1, createdAt: -1 })
        .lean(),
      TirthAnnouncement.countDocuments({
        tirthId,
        status: "active",
        expiresAt: { $gte: now },
      }),
      TirthAnnouncement.countDocuments({
        tirthId,
        status: "active",
        expiresAt: { $lt: now },
      }),
    ]);

    return successResponse(res, {
      announcements: announcements.map((a) => ({
        ...a,
        id: String(a._id),
        isExpired: new Date(a.expiresAt) < now,
      })),
      stats: {
        live: liveCount,
        expired: expiredCount,
        total: liveCount + expiredCount,
        totalViews: announcements.reduce((s, a) => s + Number(a.views || 0), 0),
      },
    });
  } catch (error) {
    console.error("❌ getManageAnnouncements error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /api/tirth-booking/manage/:tirthId/announcements
 */
const createAnnouncement = async (req, res) => {
  try {
    const { tirthId } = req.params;
    const { title, message, category, image, eventDate, expiresAt, isPinned } =
      req.body;

    if (!title || !String(title).trim()) {
      return errorResponse(res, "Title is required", 400);
    }
    if (!message || !String(message).trim()) {
      return errorResponse(res, "Message is required", 400);
    }

    const expiry = toEndOfDay(expiresAt) || defaultExpiry();
    if (expiry < new Date()) {
      return errorResponse(res, "Expiry date past me nahi ho sakti", 400);
    }

    // tirth ka snapshot — feed me card banane ke liye
    const tirth = await Tirth.findById(tirthId)
      .select("basic address photos")
      .lean();
    if (!tirth) return errorResponse(res, "Tirth not found", 404);

    const announcement = await TirthAnnouncement.create({
      tirthId,
      tirthName: tirth.basic?.name || "",
      tirthCity: tirth.address?.city || "",
      tirthState: tirth.address?.state || "",
      tirthPhoto: tirth.photos?.[0] || "",

      title: String(title).trim(),
      message: String(message).trim(),
      category: CATEGORIES.includes(category) ? category : "general",
      image: image || "",
      eventDate: toDay(eventDate),
      expiresAt: expiry,
      isPinned: isPinned === true || isPinned === "true",
      createdBy: req.user?._id,
    });

    return successResponse(res, {
      message: "Announcement published successfully",
      announcement,
    });
  } catch (error) {
    console.error("❌ createAnnouncement error:", error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * PUT /api/tirth-booking/manage/announcements/:announcementId
 */
const updateAnnouncement = async (req, res) => {
  try {
    const { announcementId } = req.params;

    const announcement = await TirthAnnouncement.findById(announcementId);
    if (!announcement || announcement.status === "deleted") {
      return errorResponse(res, "Announcement not found", 404);
    }
    if (!isUserTirthManager(req.user, announcement.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    const { title, message, category, image, eventDate, expiresAt, isPinned } =
      req.body;

    if (title !== undefined) announcement.title = String(title).trim();
    if (message !== undefined) announcement.message = String(message).trim();
    if (category !== undefined) {
      announcement.category = CATEGORIES.includes(category)
        ? category
        : "general";
    }
    if (image !== undefined) announcement.image = image;
    if (eventDate !== undefined) announcement.eventDate = toDay(eventDate);
    if (expiresAt !== undefined) {
      const expiry = toEndOfDay(expiresAt);
      if (!expiry) return errorResponse(res, "Valid expiry date required", 400);
      announcement.expiresAt = expiry;
    }
    if (isPinned !== undefined) {
      announcement.isPinned = isPinned === true || isPinned === "true";
    }

    await announcement.save();

    return successResponse(res, {
      message: "Announcement updated successfully",
      announcement,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * DELETE /api/tirth-booking/manage/announcements/:announcementId
 */
const deleteAnnouncement = async (req, res) => {
  try {
    const { announcementId } = req.params;

    const announcement = await TirthAnnouncement.findById(announcementId);
    if (!announcement || announcement.status === "deleted") {
      return errorResponse(res, "Announcement not found", 404);
    }
    if (!isUserTirthManager(req.user, announcement.tirthId)) {
      return errorResponse(
        res,
        "You do not have permission to manage this Tirth",
        403,
      );
    }

    announcement.status = "deleted";
    await announcement.save();

    return successResponse(res, {
      message: "Announcement deleted successfully",
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  CATEGORIES,

  getAnnouncementFeed,
  getTirthAnnouncements,
  markViewed,

  getManageAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
};
