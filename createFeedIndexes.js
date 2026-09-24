/**
 * ONE-TIME SCRIPT — feed ke liye zaroori indexes banata hai.
 *
 * Chalane ka tareeka (backend repo root se):
 *   node createFeedIndexes.js
 *
 * Ye script sirf indexes banati hai. Koi data touch nahi karti.
 * Ek baar chala do, phir file delete kar sakte ho.
 *
 * NOTE: background:true ke saath ban rahe hain, isliye live traffic
 * block nahi hoga. Bade collection pe 1-3 min lag sakte hain.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function run() {
  if (!MONGO_URI) {
    console.error("❌ MONGODB_URI env variable nahi mila.");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected\n");

  const db = mongoose.connection.db;

  const jobs = [
    // ---- POSTS ----
    // Main feed sort. Iske bina har request pe in-memory sort hota hai.
    ["posts", { createdAt: -1 }, { name: "feed_createdAt" }],

    // { likes: userId } wali query ke liye multikey index.
    // Iske bina poora posts collection scan hota hai — sabse bada bottleneck.
    ["posts", { likes: 1 }, { name: "feed_likes" }],

    // Boosted posts ko feed query se turant filter karne ke liye.
    ["posts", { isBoosted: 1, createdAt: -1 }, { name: "feed_boost_created" }],

    // ---- BLOCK ----
    ["blocks", { blocker: 1 }, { name: "block_blocker" }],
    ["blocks", { blocked: 1 }, { name: "block_blocked" }],

    // ---- REPORT ----
    ["reports", { reportedBy: 1, postId: 1 }, { name: "report_by_post" }],

    // ---- BOOSTPLAN ----
    [
      "boostplans",
      { status: 1, paymentStatus: 1, endDate: 1, startDate: 1 },
      { name: "boost_active_window" },
    ],

    // ---- USERINTEREST ----
    ["userinterests", { user: 1 }, { name: "interest_user" }],

    // ---- DONATION ----
    ["donations", { createdAt: -1 }, { name: "donation_createdAt" }],
  ];

  for (const [coll, keys, opts] of jobs) {
    try {
      const name = await db
        .collection(coll)
        .createIndex(keys, { background: true, ...opts });
      console.log(`✅ ${coll} -> ${name}`);
    } catch (e) {
      console.log(`⚠️  ${coll} ${JSON.stringify(keys)} :: ${e.message}`);
    }
  }

  console.log("\n🎉 Done.");
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error("❌ Script failed:", e);
  process.exit(1);
});
