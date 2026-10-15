/* ══════════════════════════════════════════════════════════════
   ✅ GEONAMES → MongoDB "cities" import (TRIMMED + PATLA version)

   Chalane ka tarika (backend ke main folder se):
     node scripts/importCities.js
   ya MongoDB URL seedha dekar:
     node scripts/importCities.js "mongodb+srv://..."

   ⚠️ Pehle purani "cities" collection DROP hoti hai (sirf city data),
      phir naya data jaata hai. Dobara chalana safe hai.

   Kya rakhte hain:
     India  → SAARE sheher, kasbe, gaon (GeoNames me India ke zyadatar
              kasbon / gaon ki abaadi "0" hai, isliye abaadi se filter nahi)
              — sirf mohalle / purani / khaali jagah hat-ti hain
     Duniya → 15,000+ abaadi wale sheher + desh / state ki rajdhaniyan
   Na mile to app me "Add as other city" option hai.

   Files: scripts/geonames/IN.txt, cities1000.txt, admin1CodesASCII.txt
   Data: GeoNames (geonames.org), CC BY 4.0
   ══════════════════════════════════════════════════════════════ */
try {
  require("dotenv").config();
} catch {
  // dotenv na ho to URL command me do
}
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");
const { City } = require("../model/Location/CityModel");

const GEO_DIR = path.join(__dirname, "geonames");
const BATCH_SIZE = 2000;
const WORLD_MIN_POPULATION = 15000;

// Ye "populated place" types kabhi nahi chahiye:
// PPLX = mohalla, PPLH = historical, PPLQ = abandoned, PPLW = destroyed,
// PPLCH = purani rajdhani
const SKIP_FEATURE_CODES = new Set(["PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"]);

// Videsh me sirf desh / state ki rajdhani (chhote district HQ nahi)
const isCapital = (code) => code === "PPLC" || code === "PPLA";

// "Khargōne" → "khargone"
const toSearchName = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const getMongoUri = () =>
  process.argv[2] ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.MONGODB_URL ||
  process.env.DB_URI ||
  process.env.DATABASE_URL ||
  "";

const checkFile = (fileName) => {
  const file = path.join(GEO_DIR, fileName);
  if (!fs.existsSync(file)) throw new Error(`File nahi mili: ${file}`);
  if (fs.statSync(file).size === 0) {
    throw new Error(
      `File khaali hai (0 bytes): ${file} — dobara download karo`,
    );
  }
  return file;
};

// admin1CodesASCII.txt → { "IN.35": "Madhya Pradesh", ... }
const loadStates = async () => {
  const states = {};
  const rl = readline.createInterface({
    input: fs.createReadStream(checkFile("admin1CodesASCII.txt"), "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const [code, name, asciiName] = line.split("\t");
    if (code) states[code] = asciiName || name || "";
  }
  return states;
};

// GeoNames ki ek line → patla City doc (ya null agar nahi chahiye)
// Columns: 0 id, 1 name, 2 asciiname, 6 feature class, 7 feature code,
//          8 country code, 10 admin1 code, 14 population
const lineToCity = (line, states, mode) => {
  const c = line.split("\t");
  if (c.length < 15) return null;

  const id = Number(c[0]);
  const name = (c[2] || c[1] || "").trim(); // saaf ASCII naam: "Sanawad"
  const featureClass = c[6];
  const featureCode = c[7];
  const countryCode = c[8];
  const population = Number(c[14]) || 0;

  if (!id || !name) return null;
  if (featureClass !== "P") return null;
  if (SKIP_FEATURE_CODES.has(featureCode)) return null;

  if (mode !== "india") {
    if (countryCode === "IN") return null; // India upar aa chuka
    if (population < WORLD_MIN_POPULATION && !isCapital(featureCode)) {
      return null;
    }
  }

  const s = toSearchName(name);
  if (!s) return null;

  return {
    _id: id,
    n: name,
    s,
    st: states[`${countryCode}.${c[10]}`] || "",
    cc: countryCode,
    p: population,
  };
};

const saveBatch = async (batch) => {
  if (!batch.length) return;
  await City.bulkWrite(
    batch.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    })),
    { ordered: false },
  );
};

const importFile = async (fileName, states, mode) => {
  const rl = readline.createInterface({
    input: fs.createReadStream(checkFile(fileName), "utf8"),
    crlfDelay: Infinity,
  });

  let batch = [];
  let saved = 0;
  let skipped = 0;

  for await (const line of rl) {
    const city = lineToCity(line, states, mode);
    if (!city) {
      skipped += 1;
      continue;
    }
    batch.push(city);
    if (batch.length >= BATCH_SIZE) {
      await saveBatch(batch);
      saved += batch.length;
      batch = [];
      process.stdout.write(`\r   ${fileName}: ${saved} saved...`);
    }
  }
  await saveBatch(batch);
  saved += batch.length;

  console.log(`\r✅ ${fileName}: ${saved} saved, ${skipped} skipped        `);
  return saved;
};

const run = async () => {
  const uri = getMongoUri();
  if (!uri) {
    console.error(
      "❌ MongoDB URL nahi mila.\n" +
        "   .env me MONGO_URI daalo, ya chalao:\n" +
        '   node scripts/importCities.js "mongodb+srv://..."',
    );
    process.exit(1);
  }

  // Files pehle check (DB chhoone se pehle)
  ["IN.txt", "cities1000.txt", "admin1CodesASCII.txt"].forEach(checkFile);

  console.log("🔌 MongoDB se connect ho raha hai...");
  await mongoose.connect(uri);
  console.log("✅ Connected:", mongoose.connection.name);

  // Purana (mota) cities data hatao — naya schema alag hai
  const exists = await mongoose.connection.db
    .listCollections({ name: "cities" })
    .hasNext();
  if (exists) {
    await mongoose.connection.db.dropCollection("cities");
    console.log("🗑️  Purani 'cities' collection hata di");
  }

  const started = Date.now();
  const states = await loadStates();
  console.log(`✅ States loaded: ${Object.keys(states).length}`);

  const india = await importFile("IN.txt", states, "india");
  const world = await importFile("cities1000.txt", states, "world");

  console.log("🔧 Search index bana rahe hain...");
  await City.syncIndexes();

  const stats = await mongoose.connection.db.command({
    collStats: "cities",
    scale: 1024 * 1024,
  });
  console.log(
    `\n🎉 DONE — India: ${india}, World: ${world}, Total: ${stats.count}` +
      `\n   Data: ${stats.size.toFixed(1)} MB` +
      ` (${Math.round((Date.now() - started) / 1000)} sec)` +
      `\n   ℹ️  Storage / Index ka sahi size 1-2 minute baad dekho:` +
      `\n      db.cities.stats(1024*1024)  → storageSize, totalIndexSize`,
  );
  await mongoose.disconnect();
};

if (require.main === module) {
  run().catch(async (error) => {
    console.error("\n❌ Import fail:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { lineToCity, toSearchName };
