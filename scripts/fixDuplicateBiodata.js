/* ══════════════════════════════════════════════════════════════
   One-time script: duplicate Vyavahik Biodata hatao + unique index banao

   Run (backend root se):
     node scripts/fixDuplicateBiodata.js           → sirf report (DRY RUN, kuch delete nahi)
     node scripts/fixDuplicateBiodata.js --apply   → backup + delete + unique index

   Har userId ke liye EK biodata rakha jayega, is order me:
     1) paymentStatus "paid" wala
     2) isVisible true wala
     3) sabse latest updatedAt wala
   Baaki duplicates pehle "vyavahikbiodatas_duplicates_backup" collection me
   copy hote hain, phir delete. Kuch galat ho to backup se wapas la sakte hain.
   ══════════════════════════════════════════════════════════════ */
try {
  require("dotenv").config();
} catch {}

const mongoose = require("mongoose");
mongoose.set("autoIndex", false); // duplicates rehte index build fail na ho

const { VyavahikBiodata } = require("../model/Matrimonial/VyavahikBiodata");

const APPLY = process.argv.includes("--apply");
const MONGO_URI =
  process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;

const score = (doc) => [
  doc.membershipInfo?.paymentStatus === "paid" ? 1 : 0,
  doc.isVisible ? 1 : 0,
  new Date(doc.updatedAt || doc.createdAt || 0).getTime(),
];

const pickKeeper = (docs) =>
  [...docs].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++)
      if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return 0;
  })[0];

(async () => {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI env me nahi mila");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  const col = VyavahikBiodata.collection;
  const backup = mongoose.connection.db.collection(
    "vyavahikbiodatas_duplicates_backup",
  );

  const groups = await col
    .aggregate([
      { $match: { userId: { $type: "objectId" } } },
      {
        $group: { _id: "$userId", ids: { $push: "$_id" }, count: { $sum: 1 } },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

//   console.log(`\n${APPLY ? "🔴 APPLY MODE" : "🟡 DRY RUN"}`);
//   console.log(`Duplicate users: ${groups.length}`);

  let toRemoveTotal = 0;
  for (const g of groups) {
    const docs = await col.find({ _id: { $in: g.ids } }).toArray();
    const keeper = pickKeeper(docs);
    const remove = docs.filter((d) => !d._id.equals(keeper._id));
    toRemoveTotal += remove.length;

    // console.log(
    //   `\nuserId ${g._id} → ${docs.length} biodata | keep ${keeper._id} (${keeper.name || "-"}, ${keeper.membershipInfo?.paymentStatus || "-"})`,
    // );
    remove.forEach((d) =>
      console.log(
        `   remove ${d._id} (${d.name || "-"}, ${d.membershipInfo?.paymentStatus || "-"}, ${d.updatedAt?.toISOString?.() || "-"})`,
      ),
    );

    if (APPLY && remove.length) {
      await backup.insertMany(
        remove.map((d) => ({
          ...d,
          _backupAt: new Date(),
          _keptId: keeper._id,
        })),
      );
      await col.deleteMany({ _id: { $in: remove.map((d) => d._id) } });
    }
  }

  console.log(`\nTotal duplicate biodata: ${toRemoveTotal}`);

  if (APPLY) {
    await VyavahikBiodata.createIndexes();
    console.log("✅ Unique index uniq_userId ban gaya");
  } else {
    console.log("👉 Sab sahi lage to dobara --apply ke saath chalao");
  }

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("❌ Script error:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
