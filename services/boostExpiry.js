// cronJobs/boostExpiry.js
const cron = require('node-cron');
const BoostPlan = require('../model/BoostPlan/BoostPlan');
const User = require('../model/UserRegistrationModels/userModel');
const Post = require('../model/SocialMediaModels/postModel');

//console.log('✅ boostExpiry cron file loaded');

cron.schedule('* * * * *', async () => { // ✅ every minute (testing)
  try {
    const now = new Date();
   // console.log(`\n🔥 [CRON RUNNING] ${now.toISOString()}`);

    const expiredBoosts = await BoostPlan.find({
      endDate: { $lte: now }
    });

    if (expiredBoosts.length === 0) {
     // console.log('⏰ No expired boosts found');
      return;
    }

   // console.log(`🚨 Expired Boosts Found: ${expiredBoosts.length}`);

    for (const boost of expiredBoosts) {
      //console.log(`➡️ Expiring Boost: ${boost._id}`);

      // 1️⃣ Post update
      await Post.updateMany(
        { activeBoost: boost._id },
        { $set: { isBoosted: false, activeBoost: null } }
      );

      // 2️⃣ Remove boost from user
      await User.findByIdAndUpdate(
        boost.user,
        {
          $pull: { activeBoosts: boost._id }
        }
      );

      // 3️⃣ Check if user still has active boosts
      const remainingBoosts = await User.findOne({
        _id: boost.user,
        activeBoosts: { $exists: true, $not: { $size: 0 } }
      });

      await User.findByIdAndUpdate(boost.user, {
        isBoostActive: !!remainingBoosts
      });

      // 4️⃣ Optional: mark boost as expired
      await BoostPlan.findByIdAndUpdate(boost._id, {
        isExpired: true
      });

     // console.log(`✅ Boost expired successfully: ${boost._id}`);
    }
  } catch (err) {
    console.error('❌ Cron error:', err);
  }
});
