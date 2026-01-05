const asyncHandler = require("express-async-handler");
const BoostPlan = require("../../model/BoostPlan/BoostPlan");
const Post = require("../../model/SocialMediaModels/postModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { convertS3UrlToCDN } = require("../../utils/s3Utils");

exports.createBoostPlan = asyncHandler(async (req, res) => {

  console.log("🔵 RAW REQ BODY:", req.body);
  console.log("🔵 RAW REQ FILES:", req.files);

  const userId = req.user?._id;
  const { postId, states, districts, cities, duration, amount } = req.body;

  let parsedDuration = duration;
  if (typeof duration === "string") {
    try { parsedDuration = JSON.parse(duration); } 
    catch (err) { 
      return res.status(400).json({ error: "Invalid duration format" }); 
    }
  }

  if (!userId || !parsedDuration?.value || !parsedDuration?.unit || !amount) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!["day", "month"].includes(parsedDuration.unit)) {
    return res.status(400).json({ error: "Invalid duration unit" });
  }

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (!["business", "sadhu", "tirth"].includes(user.accountType)) {
    return res.status(403).json({ error: "Boost allowed only for Business / Sadhu / Tirth accounts" });
  }

  let post = null;
  if (postId) {
    post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });
  }

  const startDate = new Date();
  const endDate = new Date(startDate);
  if (parsedDuration.unit === "day") endDate.setDate(endDate.getDate() + Number(parsedDuration.value));
  if (parsedDuration.unit === "month") endDate.setMonth(endDate.getMonth() + Number(parsedDuration.value));

  let paymentScreenshot = null;
  if (req.files?.paymentScreenshot?.length > 0) {
    paymentScreenshot = convertS3UrlToCDN(req.files.paymentScreenshot[0].location);
  }

  // CREATE BOOST
  const boost = await BoostPlan.create({
    user: userId,
    post: postId || null,
    accountType: user.accountType,
    targeting: {
      states: states ? JSON.parse(states) : [],
      districts: districts ? JSON.parse(districts) : [],
      cities: cities ? JSON.parse(cities) : []
    },
    duration: { value: Number(parsedDuration.value), unit: parsedDuration.unit },
    startDate,
    endDate,
    price: amount,
    paymentScreenshot,
    paymentStatus: "verified",
    status: "active"
  });

  // ✅ ADD TO USER BOOSTS ARRAY
  if (!user.boosts) user.boosts = [];
  if (!user.activeBoosts) user.activeBoosts = [];

  user.boosts.push(boost._id);
  user.activeBoosts.push(boost._id);
  user.isBoostActive = true;

  await user.save();

  console.log("✅ BOOST CREATED SUCCESSFULLY:", boost._id);

  res.status(201).json({
    success: true,
    message: "Boost activated successfully",
    data: boost
  });
});
exports.getAllBoostPlans = asyncHandler(async (req, res) => {
  try {
    const boosts = await BoostPlan.find()
      .populate({
        path: "user",
        select: "fullName profilePicture accountType businessName sadhuName tirthName",
      })
      .populate({
        path: "post",
        select: "caption media type",
      })
      .sort({ createdAt: -1 });

    // ✅ CDN conversion (optional but recommended)
    const formattedBoosts = boosts.map(boost => {
      const boostObj = boost.toObject();

      if (boostObj.user?.profilePicture) {
        boostObj.user.profilePicture = convertS3UrlToCDN(
          boostObj.user.profilePicture
        );
      }

      if (boostObj.paymentScreenshot) {
        boostObj.paymentScreenshot = convertS3UrlToCDN(
          boostObj.paymentScreenshot
        );
      }

      return boostObj;
    });

    res.status(200).json({
      success: true,
      count: formattedBoosts.length,
      data: formattedBoosts,
    });
  } catch (error) {
    console.error("❌ Error fetching boost plans:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch boost plans",
    });
  }
});