require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const Post = mongoose.connection.collection("posts");

  const r1 = await Post.updateMany(
    { isHidden: { $exists: false } },
    { $set: { isHidden: false } },
  );
  const r2 = await Post.updateMany(
    { isDeleted: { $exists: false } },
    { $set: { isDeleted: false } },
  );
  const r3 = await Post.updateMany(
    { isPinned: { $exists: false } },
    { $set: { isPinned: false } },
  );

  console.log("isHidden set:", r1.modifiedCount);
  console.log("isDeleted set:", r2.modifiedCount);
  console.log("isPinned set:", r3.modifiedCount);
  process.exit(0);
})();