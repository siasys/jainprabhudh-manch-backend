/**
 * Pehla Trustee account banata hai.
 *
 * Chalao:  node adminPanel/scripts/seedTrustee.js
 *
 * Ek hi baar chalana hai. Dobara chalane pe kuch nahi hoga.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const AdminUser = require("../model/adminUserModel");

const TRUSTEE = {
  name: "Prabudh Manch Trustee",
  email: "trustee@jaintva.com",
  password: "Trustee@123", // ⚠️ login karke turant change karna
  designation: "Trustee",
  role: "trustee",
};

(async () => {
  try {
    const uri = process.env.MONGODB_URL;
    if (!uri) {
      console.error("❌ .env me MONGODB_URL nahi mila");
      process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("✅ MongoDB connected");

    const existing = await AdminUser.findOne({ email: TRUSTEE.email });
    if (existing) {
      console.log("ℹ️  Trustee already exists:", existing.email);
      process.exit(0);
    }

    const admin = await AdminUser.create(TRUSTEE);
    console.log("\n✅ Trustee ban gaya!");
    console.log("   Email    :", admin.email);
    console.log("   Password :", TRUSTEE.password);
    console.log("\n⚠️  Login karke password turant change karein.\n");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
})();