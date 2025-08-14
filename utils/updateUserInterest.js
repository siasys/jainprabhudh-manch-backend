const UserInterest = require('../utils/updateUserInterest');

async function updateUserInterest(userId, hashtags, weight = 1) {
  let interestDoc = await UserInterest.findOne({ user: userId });

  if (!interestDoc) {
    interestDoc = new UserInterest({ user: userId, hashtags: [] });
  }

  hashtags.forEach(tag => {
    const existing = interestDoc.hashtags.find(h => h.name === tag);
    if (existing) {
      existing.score += weight; 
    } else {
      interestDoc.hashtags.push({ name: tag, score: weight });
    }
  });

  await interestDoc.save();
}

module.exports = updateUserInterest;