// One-time script: users collection se purane unique indexes hatata hai.
// Schema me email/phoneNumber ka unique band ho chuka hai, lekin Mongoose
// purane indexes khud drop nahi karta — wahi E11000 ki wajah hai.
//
// Chalane ka tarika (backend root folder se):
//   node scripts/dropLeftoverUserIndexes.js
// .env me MONGO_URI (ya MONGODB_URI) hona chahiye.

require("dotenv").config();
const mongoose = require("mongoose");

const URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const TARGETS = ["email", "phoneNumber"]; // sirf in fields ke unique indexes

(async () => {
  if (!URI) {
    console.error("MONGO_URI / MONGODB_URI .env me nahi mila");
    process.exit(1);
  }
  await mongoose.connect(URI);
  const col = mongoose.connection.db.collection("users");

  const indexes = await col.indexes();
  console.log("Current indexes:");
  indexes.forEach((i) =>
    console.log(
      `  ${i.name}  key=${JSON.stringify(i.key)}  unique=${!!i.unique}`,
    ),
  );

  for (const idx of indexes) {
    const keys = Object.keys(idx.key);
    const isTarget = keys.length === 1 && TARGETS.includes(keys[0]);
    if (idx.unique && isTarget) {
      await col.dropIndex(idx.name);
      console.log(`Dropped: ${idx.name}`);
    }
  }

  console.log("Done.");
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
