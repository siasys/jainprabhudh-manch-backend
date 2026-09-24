const mongoose = require("mongoose");
const Donation = require("../../model/Donation/donation");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");
const Sangh = require("../../model/SanghModels/hierarchicalSanghModel");
const Counter = require("../../model/Donation/Counter"); // additive: receipt no.

// Financial year helper (April–March) e.g. 2025-26
const getFinancialYear = (dt = new Date()) => {
  const y = dt.getFullYear();
  const m = dt.getMonth(); // 0=Jan ... 3=Apr
  const start = m >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};

/**
 * CREATE DONATION
 */
const createDonation = async (req, res) => {
  try {
    const {
      userId,
      title,
      occasionDetails,
      purpose,
      amount,
      onBehalfOf,
      onBehalfOfName,
      isGuptDaan,
      //Razorpay fields
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      // Tirth (optional) — tirth screen se daan ho tab aata hai
      tirthId,
      tirthName,
    } = req.body;

    // ✅ Tirth optional — galat / khaali id ho to null (daan phir bhi hoga)
    const validTirthId =
      tirthId && mongoose.Types.ObjectId.isValid(String(tirthId))
        ? tirthId
        : null;

    // ✅ Tirth ka daan — Trust ka share ADMIN tay karega.
    //    Yahan koi percent nahi lagta (pehle 10% default lag raha tha).
    //    Tab tak: commission 0, poora amount tirth ka payable.
    let tirthSettlement = {};
    if (validTirthId) {
      const total = Math.max(0, Math.round(Number(amount) || 0));
      tirthSettlement = {
        beneficiaryTirthId: validTirthId,
        commissionPercent: 0,
        commissionAmount: 0,
        payableAmount: total,
        commissionSet: false, // admin ne abhi tay nahi kiya
        settlementStatus: "pending",
      };
    }

    // 🔒 FETCH FOUNDATION SANGH (ALWAYS FIXED)
    const foundationSangh = await Sangh.findOne({ level: "foundation" });

    if (!foundationSangh) {
      return res.status(404).json({
        success: false,
        message: "Foundation Sangh not found",
      });
    }

    let paymentScreenshotUrl = "";
    let donationPhotoUrl = "";
    let paymentStatus = "pending";
    let paymentMethod = "pending";
    let paidAt = null;

    // ✅ CASE 1: Razorpay payment verified
    if (razorpayPaymentId && razorpayPaymentId.trim() !== "") {
      paymentStatus = "success";
      paymentMethod = "razorpay";
      paidAt = new Date();
      // console.log("✅ Donation via Razorpay:", razorpayPaymentId);
    }

    // ✅ CASE 2: Manual screenshot upload (QR flow)
    if (
      req.files?.paymentScreenshot &&
      req.files.paymentScreenshot.length > 0
    ) {
      const s3Url = req.files.paymentScreenshot[0].location;
      paymentScreenshotUrl = convertS3UrlToCDN(s3Url);
      paymentStatus = "success";
      paymentMethod = "screenshot";
      paidAt = new Date();
    }

    // ✅ Donation Photo
    if (req.files?.donationPhoto && req.files.donationPhoto.length > 0) {
      const s3Url = req.files.donationPhoto[0].location;
      donationPhotoUrl = convertS3UrlToCDN(s3Url);
    }

    // ✅ CREATE DONATION
    const donation = await Donation.create({
      userId,
      sanghId: foundationSangh._id,
      title,
      occasionDetails,
      purpose,
      amount,
      onBehalfOf,
      onBehalfOfName,
      paymentStatus,
      paymentMethod,
      paidAt,
      isGuptDan: isGuptDaan === true || isGuptDaan === "true",
      paymentScreenshot: paymentScreenshotUrl,
      donationPhoto: donationPhotoUrl,
      // ✅ Razorpay details
      razorpayOrderId: razorpayOrderId || "",
      razorpayPaymentId: razorpayPaymentId || "",
      razorpaySignature: razorpaySignature || "",
      currency: "INR",
      // ✅ Tirth ka daan ho to (normal daan me null / "")
      tirthId: validTirthId,
      tirthName: validTirthId ? String(tirthName || "").trim() : "",
      // ✅ Tirth settlement ke fields (normal daan me kuch nahi)
      ...tirthSettlement,
    });

    // ===== RECEIPT NUMBER GENERATION (additive) =====
    // Only for successful/paid donations
    if (donation.paymentStatus === "success" && !donation.receiptNumber) {
      try {
        const fy = getFinancialYear();
        const counter = await Counter.findByIdAndUpdate(
          `donationReceipt_${fy}`,
          { $inc: { seq: 1 } },
          { new: true, upsert: true },
        );
        donation.receiptNumber = `JPM/${fy}/${String(counter.seq).padStart(5, "0")}`;
        donation.receiptDate = new Date();
        donation.financialYear = fy;
        await donation.save();
      } catch (e) {
        console.error("RECEIPT NUMBER GEN ERROR:", e.message);
        // Donation is already saved; receipt no. can be backfilled later
      }
    }

    return res.status(201).json({
      success: true,
      message: "Donation submitted successfully",
      data: donation,
    });
  } catch (error) {
    console.error("CREATE DONATION ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 *GET ALL DONATIONS
 */
const getAllDonations = async (req, res) => {
  try {
    // ✅ Optional: ?tirthId=... se sirf us tirth ke daan
    // (bina param ke pehle jaisa — saare daan)
    const filter = { isGuptDan: { $ne: true } }; // ✅ Gupt Dan hide
    const { tirthId } = req.query;
    if (tirthId && mongoose.Types.ObjectId.isValid(String(tirthId))) {
      filter.tirthId = tirthId;
    }

    const donations = await Donation.find(filter)
      .populate("userId", "fullName gender phoneNumber profilePicture")
      .populate("sanghId", "name sanghImage")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: donations.length,
      data: donations,
    });
  } catch (error) {
    console.error("GET ALL DONATIONS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * GET DONATION BY ID
 */
const getDonationById = async (req, res) => {
  try {
    const { donationId } = req.params;

    const donation = await Donation.findById(donationId).populate(
      "userId",
      "fullName gender phoneNumber profilePicture",
    );

    if (!donation) {
      return res.status(404).json({
        success: false,
        message: "Donation not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: donation,
    });
  } catch (error) {
    console.error("GET DONATION BY ID ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
/**
 * UPDATE DONATION
 */
const updateDonation = async (req, res) => {
  try {
    const { donationId } = req.params;

    if (!donationId) {
      return res.status(400).json({
        success: false,
        message: "Donation ID is required",
      });
    }

    const donation = await Donation.findById(donationId);
    if (!donation) {
      return res.status(404).json({
        success: false,
        message: "Donation not found",
      });
    }

    const { title, purpose, amount, onBehalfOf, onBehalfOfName } = req.body;

    // 🔐 Update fields only if provided
    if (title) donation.title = title;
    if (purpose) donation.purpose = purpose;
    if (amount) donation.amount = amount;
    if (onBehalfOf) donation.onBehalfOf = onBehalfOf;
    if (onBehalfOfName) donation.onBehalfOfName = onBehalfOfName;

    // ✅ Update donationPhoto if new file provided
    if (req.files?.donationPhoto && req.files.donationPhoto.length > 0) {
      const s3Url = req.files.donationPhoto[0].location;
      donation.donationPhoto = convertS3UrlToCDN(s3Url);
    }

    // ✅ Update paymentScreenshot if new file provided
    if (
      req.files?.paymentScreenshot &&
      req.files.paymentScreenshot.length > 0
    ) {
      const s3Url = req.files.paymentScreenshot[0].location;
      donation.paymentScreenshot = convertS3UrlToCDN(s3Url);
      donation.paymentStatus = "success"; // mark payment success if screenshot updated
    }

    await donation.save();

    return res.status(200).json({
      success: true,
      message: "Donation updated successfully",
      data: donation,
    });
  } catch (error) {
    console.error("UPDATE DONATION ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createDonation,
  getAllDonations,
  getDonationById,
  updateDonation,
};
