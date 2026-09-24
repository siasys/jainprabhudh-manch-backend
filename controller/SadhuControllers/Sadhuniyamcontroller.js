const SadhuNiyam = require("../../model/SadhuModels/Sadhuniyammodel");
const SadhuNiyamTaker = require("../../model/SadhuModels/Sadhuniyamtakermodel");
const Sadhu = require("../../model/SadhuModels/sadhuModel");
const { successResponse, errorResponse } = require("../../utils/apiResponse");
const { s3Client, DeleteObjectCommand } = require("../../config/s3Config");
const { extractS3KeyFromUrl } = require("../../utils/s3Utils");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");

/* ── Helpers ──────────────────────────────────────────────── */

const toDateOrNull = (val) => {
  if (val === undefined || val === null || String(val).trim() === "")
    return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const toBool = (val) =>
  val === true || val === "true" || val === 1 || val === "1";

// Uploaded file se mediaType nikaalo
const detectMediaType = (file) => {
  if (!file) return "none";
  const mime = file.mimetype || "";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "none";
};

// req.files se niyamMedia nikaalo — upload middleware array ya object
// dono shape me de sakta hai
const pickMediaFile = (req) => {
  if (!req.files) return null;
  if (Array.isArray(req.files)) {
    return req.files.find((f) => f.fieldname === "niyamMedia") || null;
  }
  const arr = req.files.niyamMedia;
  return Array.isArray(arr) ? arr[0] || null : arr || null;
};

// S3 se purani file hatao. Fail ho to bhi aage badho —
// DB record zyada important hai.
const deleteFromS3 = async (url) => {
  if (!url) return;
  const key = extractS3KeyFromUrl(url);
  if (!key) return;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
      }),
    );
  } catch (err) {
    console.error("S3 delete failed:", err.message);
  }
};

/**
 * Naya niyam post hone par us sadhu ke followers ko notification.
 *
 * Notification model ka post("save") hook FCM push apne aap bhej deta hai,
 * isliye yahan sirf DB record banana hai.
 *
 * Ye function jaan-bujh kar await nahi hota (fire-and-forget) — followers
 * zyada hone par API response slow ho jaata, aur notification fail hone se
 * niyam post karna nahi rukna chahiye.
 */
const notifyFollowersOfNiyam = async (niyam, sadhu) => {
  try {
    // Sadhu ke user account ki id — followers isi ko follow karte hain
    const sadhuUserId = sadhu?.submittedBy;
    if (!sadhuUserId) return;

    const Friendship = require("../../model/SocialMediaModels/friendshipModel");
    const Notification = require("../../model/SocialMediaModels/notificationModel");

    const followers = await Friendship.find({
      following: sadhuUserId,
      followStatus: "following",
    })
      .select("follower")
      .lean();

    if (!followers.length) return;

    const sadhuName = sadhu?.sadhuName || "Sadhu";
    const heading = niyam.title || niyam.niyamType || "Niyam";
    const message = `${sadhuName} posted a new ${niyam.niyamType || "Niyam"} — ${heading}`;

    // create() ek-ek karke chalta hai taaki har doc pe save hook lage
    // (insertMany me hook nahi chalta, to push nahi jaati)
    for (const f of followers) {
      if (!f.follower) continue;
      if (f.follower.toString() === sadhuUserId.toString()) continue;

      try {
        await Notification.create({
          senderId: sadhuUserId,
          receiverId: f.follower,
          type: "sadhu_niyam",
          sadhuId: sadhu._id,
          niyamId: niyam._id,
          message,
        });
      } catch (e) {
        // Ek follower fail ho to baaki ke liye rukna nahi
        console.error("Niyam notification failed:", e.message);
      }
    }

    console.log(`Niyam notification sent to ${followers.length} followers`);
  } catch (error) {
    console.error("notifyFollowersOfNiyam error:", error);
  }
};

/* ── Create ───────────────────────────────────────────────── */

const addSadhuNiyam = async (req, res) => {
  try {
    const { sadhuId } = req.params;

    // submittedBy aur sadhuName notification ke liye chahiye
    const sadhu = await Sadhu.findById(sadhuId).select(
      "_id sadhuName submittedBy",
    );
    if (!sadhu) {
      return errorResponse(res, "Sadhu not found", 404);
    }

    const text = (req.body.niyamText || "").trim();
    const link = (req.body.mediaLink || "").trim();
    const file = pickMediaFile(req);

    // Kuch to hona chahiye — khali entry ka koi matlab nahi
    if (!text && !link && !file) {
      return errorResponse(res, "Please add some text, a link or a file");
    }

    const niyam = new SadhuNiyam({
      sadhuId,
      niyamType: req.body.niyamType || "Niyam",
      title: req.body.title || "",
      niyamText: text,
      niyamDate: toDateOrNull(req.body.niyamDate) || new Date(),
      tithi: req.body.tithi || "",
      mediaLink: link,
      duration: req.body.duration || "",
      isPinned: toBool(req.body.isPinned),
      isPublished:
        req.body.isPublished === undefined
          ? true
          : toBool(req.body.isPublished),
      createdBy: req.user?._id || null,
    });

    if (file) {
      niyam.mediaUrl = convertS3UrlToCDN(file.location);
      niyam.mediaType = detectMediaType(file);
    }

    await niyam.save();

    // Ek sadhu ka sirf ek pinned record
    if (niyam.isPinned) {
      await SadhuNiyam.updateMany(
        { sadhuId, _id: { $ne: niyam._id } },
        { $set: { isPinned: false } },
      );
    }

    // Followers ko notification — background me, response rokta nahi
    if (niyam.isPublished) {
      notifyFollowersOfNiyam(niyam, sadhu);
    }

    return successResponse(res, "Niyam added", niyam);
  } catch (error) {
    console.error("addSadhuNiyam error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── List ─────────────────────────────────────────────────── */

const getSadhuNiyamList = async (req, res) => {
  try {
    const { sadhuId } = req.params;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 20, 1),
      50,
    );
    const skip = (page - 1) * limit;

    const query = { sadhuId };

    // Public side sirf published dekhe. Manage screen ?all=true bhejti hai.
    if (req.query.all !== "true") {
      query.isPublished = true;
    }

    if (req.query.niyamType) {
      query.niyamType = req.query.niyamType;
    }

    // ?date=YYYY-MM-DD — us din ke records
    if (req.query.date) {
      const day = toDateOrNull(req.query.date);
      if (day) {
        const start = new Date(day);
        start.setHours(0, 0, 0, 0);
        const end = new Date(day);
        end.setHours(23, 59, 59, 999);
        query.niyamDate = { $gte: start, $lte: end };
      }
    }

    const [found, total] = await Promise.all([
      SadhuNiyam.find(query)
        .sort({ isPinned: -1, niyamDate: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SadhuNiyam.countDocuments(query),
    ]);

    /* ── NEW: har niyam ke saath kitne logon ne liya, aur kya maine liya ──
       Do chhoti queries — har record ke liye alag call nahi (N+1 se bachne
       ke liye). Logged-out user ke liye hasTaken hamesha false. */
    const niyamIds = found.map((r) => r._id);
    const viewerId = req.user?._id || req.query.userId || null;

    const [counts, mine] = await Promise.all([
      SadhuNiyamTaker.aggregate([
        { $match: { niyamId: { $in: niyamIds } } },
        { $group: { _id: "$niyamId", count: { $sum: 1 } } },
      ]),
      viewerId
        ? SadhuNiyamTaker.find({
            niyamId: { $in: niyamIds },
            userId: viewerId,
          })
            .select("niyamId")
            .lean()
        : [],
    ]);

    const countMap = {};
    counts.forEach((c) => {
      countMap[c._id.toString()] = c.count;
    });

    const mineSet = new Set(mine.map((m) => m.niyamId.toString()));

    const records = found.map((r) => ({
      ...r,
      takenCount: countMap[r._id.toString()] || 0,
      hasTaken: mineSet.has(r._id.toString()),
    }));

    return successResponse(res, "Niyam records retrieved", {
      records,
      total,
      page,
      limit,
      hasMore: skip + records.length < total,
    });
  } catch (error) {
    console.error("getSadhuNiyamList error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── Aaj ka niyam ─────────────────────────────────────────── */

const getTodaySadhuNiyam = async (req, res) => {
  try {
    const { sadhuId } = req.params;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    let niyam = await SadhuNiyam.findOne({
      sadhuId,
      isPublished: true,
      niyamDate: { $gte: start, $lte: end },
    }).sort({ isPinned: -1, createdAt: -1 });

    // Aaj ka na ho to latest hi de do — profile khali na lage
    if (!niyam) {
      niyam = await SadhuNiyam.findOne({ sadhuId, isPublished: true }).sort({
        isPinned: -1,
        niyamDate: -1,
        _id: -1,
      });
    }

    return successResponse(res, "Today niyam retrieved", niyam || null);
  } catch (error) {
    console.error("getTodaySadhuNiyam error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── Update ───────────────────────────────────────────────── */

const updateSadhuNiyam = async (req, res) => {
  try {
    const { niyamId } = req.params;

    const niyam = await SadhuNiyam.findById(niyamId);
    if (!niyam) {
      return errorResponse(res, "Niyam not found", 404);
    }

    const fields = ["niyamType", "title", "niyamText", "tithi", "duration"];
    fields.forEach((key) => {
      if (req.body[key] !== undefined) niyam[key] = req.body[key];
    });

    if (req.body.niyamDate !== undefined) {
      niyam.niyamDate = toDateOrNull(req.body.niyamDate) || niyam.niyamDate;
    }
    if (req.body.mediaLink !== undefined) {
      niyam.mediaLink = req.body.mediaLink;
    }
    if (req.body.isPublished !== undefined) {
      niyam.isPublished = toBool(req.body.isPublished);
    }

    // Nayi file aayi to purani S3 se hata do
    const file = pickMediaFile(req);
    if (file) {
      await deleteFromS3(niyam.mediaUrl);
      niyam.mediaUrl = convertS3UrlToCDN(file.location);
      niyam.mediaType = detectMediaType(file);
    }

    // Media hatane ka explicit flag
    if (toBool(req.body.removeMedia)) {
      await deleteFromS3(niyam.mediaUrl);
      niyam.mediaUrl = "";
      niyam.mediaType = "none";
      niyam.duration = "";
    }

    if (req.body.isPinned !== undefined) {
      niyam.isPinned = toBool(req.body.isPinned);
    }

    await niyam.save();

    if (niyam.isPinned) {
      await SadhuNiyam.updateMany(
        { sadhuId: niyam.sadhuId, _id: { $ne: niyam._id } },
        { $set: { isPinned: false } },
      );
    }

    return successResponse(res, "Niyam updated", niyam);
  } catch (error) {
    console.error("updateSadhuNiyam error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── Pin / unpin ──────────────────────────────────────────── */

const pinSadhuNiyam = async (req, res) => {
  try {
    const { niyamId } = req.params;

    const niyam = await SadhuNiyam.findById(niyamId);
    if (!niyam) {
      return errorResponse(res, "Niyam not found", 404);
    }

    const next = !niyam.isPinned;

    if (next) {
      // Standalone mongod hai (no replica set) — koi transaction nahi
      await SadhuNiyam.updateMany(
        { sadhuId: niyam.sadhuId },
        { $set: { isPinned: false } },
      );
    }

    niyam.isPinned = next;
    await niyam.save();

    return successResponse(res, next ? "Pinned" : "Unpinned", niyam);
  } catch (error) {
    console.error("pinSadhuNiyam error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── View count ───────────────────────────────────────────── */

const incrementNiyamView = async (req, res) => {
  try {
    const { niyamId } = req.params;
    const niyam = await SadhuNiyam.findByIdAndUpdate(
      niyamId,
      { $inc: { viewCount: 1 } },
      { new: true },
    );
    if (!niyam) {
      return errorResponse(res, "Niyam not found", 404);
    }
    return successResponse(res, "View counted", {
      _id: niyam._id,
      viewCount: niyam.viewCount,
    });
  } catch (error) {
    return errorResponse(res, error.message);
  }
};

/* ══════════════════════════════════════════════════════════════
   ── NEW: Niyam lena / chhodna ──
   ══════════════════════════════════════════════════════════════ */

/**
 * Shravak ne niyam liya.
 * Dobara call hone par toggle nahi hota — takeNiyam sirf jodta hai,
 * hatane ke liye alag endpoint hai. Isse galti se tap hone par
 * niyam chhoot nahi jaata.
 */
const takeSadhuNiyam = async (req, res) => {
  try {
    const { niyamId } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      return errorResponse(res, "Please login first", 401);
    }

    const niyam = await SadhuNiyam.findById(niyamId).select(
      "_id sadhuId isPublished",
    );
    if (!niyam) {
      return errorResponse(res, "Niyam not found", 404);
    }
    if (niyam.isPublished === false) {
      return errorResponse(res, "This niyam is not published yet");
    }

    try {
      await SadhuNiyamTaker.create({
        niyamId: niyam._id,
        sadhuId: niyam.sadhuId,
        userId,
      });
    } catch (err) {
      // 11000 = duplicate key. Pehle se liya hua hai — error nahi,
      // seedha count wapas bhej do
      if (err.code !== 11000) throw err;
    }

    const takenCount = await SadhuNiyamTaker.countDocuments({
      niyamId: niyam._id,
    });

    return successResponse(res, "Niyam taken", {
      niyamId: niyam._id,
      takenCount,
      hasTaken: true,
    });
  } catch (error) {
    console.error("takeSadhuNiyam error:", error);
    return errorResponse(res, error.message);
  }
};

/** Shravak ne niyam wapas le liya */
const untakeSadhuNiyam = async (req, res) => {
  try {
    const { niyamId } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      return errorResponse(res, "Please login first", 401);
    }

    await SadhuNiyamTaker.findOneAndDelete({ niyamId, userId });

    const takenCount = await SadhuNiyamTaker.countDocuments({ niyamId });

    return successResponse(res, "Niyam removed", {
      niyamId,
      takenCount,
      hasTaken: false,
    });
  } catch (error) {
    console.error("untakeSadhuNiyam error:", error);
    return errorResponse(res, error.message);
  }
};

/**
 * Kis-kis ne ye niyam liya — naam aur photo ke saath.
 * Ye sirf sadhu ke manage screen ke liye hai (privacy).
 */
const getNiyamTakers = async (req, res) => {
  try {
    const { niyamId } = req.params;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 30, 1),
      50,
    );
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      SadhuNiyamTaker.find({ niyamId })
        .sort({ takenAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          "userId",
          "firstName lastName fullName profilePicture accountType businessName sadhuName tirthName",
        )
        .lean(),
      SadhuNiyamTaker.countDocuments({ niyamId }),
    ]);

    // Account type ke hisaab se sahi naam — baaki app me bhi yahi pattern hai
    const records = rows
      .filter((r) => r.userId)
      .map((r) => {
        const u = r.userId;
        const displayName =
          u.accountType === "business"
            ? u.businessName
            : u.accountType === "sadhu"
              ? u.sadhuName
              : u.accountType === "tirth"
                ? u.tirthName
                : u.fullName || u.firstName;

        return {
          _id: r._id,
          userId: u._id,
          name: displayName || u.firstName || "User",
          profilePicture: u.profilePicture || "",
          accountType: u.accountType || "user",
          takenAt: r.takenAt,
        };
      });

    return successResponse(res, "Niyam takers retrieved", {
      records,
      total,
      page,
      limit,
      hasMore: skip + rows.length < total,
    });
  } catch (error) {
    console.error("getNiyamTakers error:", error);
    return errorResponse(res, error.message);
  }
};

/* ── Delete ───────────────────────────────────────────────── */

const deleteSadhuNiyam = async (req, res) => {
  try {
    const { niyamId } = req.params;

    const niyam = await SadhuNiyam.findById(niyamId);
    if (!niyam) {
      return errorResponse(res, "Niyam not found", 404);
    }

    await deleteFromS3(niyam.mediaUrl);
    await SadhuNiyam.findByIdAndDelete(niyamId);

    // Orphan taker records na reh jaayein
    await SadhuNiyamTaker.deleteMany({ niyamId });

    return successResponse(res, "Niyam deleted", { _id: niyamId });
  } catch (error) {
    console.error("deleteSadhuNiyam error:", error);
    return errorResponse(res, error.message);
  }
};

module.exports = {
  addSadhuNiyam,
  // ── NEW ──
  takeSadhuNiyam,
  untakeSadhuNiyam,
  getNiyamTakers,
  getSadhuNiyamList,
  getTodaySadhuNiyam,
  updateSadhuNiyam,
  pinSadhuNiyam,
  incrementNiyamView,
  deleteSadhuNiyam,
};
