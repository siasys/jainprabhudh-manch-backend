/**
 * Pehla admin (Trustee) banane ki one-time script.
 *
 * Kyu chahiye: naya admin member sirf Trustee/CEO hi bana sakta hai
 * (POST /api/admin-panel/team), lekin shuru me koi admin hai hi nahi.
 * Isliye pehla admin seedha database me banana padta hai.
 *
 * Chalane ka tarika (backend root folder se):
 *   node scripts/createAdmin.js "Sejal Bhawsar" admin@example.com "StrongPass@123"
 *
 * Password bhool gaye to usi email ke saath --reset lagao:
 *   node scripts/createAdmin.js "Sejal Bhawsar" admin@example.com "NewPass@123" --reset
 *
 * .env me MONGODB_URL (production DB) hona chahiye.
 */

require("dotenv").config();

// Windows par Atlas SRV lookup fail hota hai (querySrv ECONNREFUSED),
// isliye sirf is script ke liye Google/Cloudflare DNS use karo
require("dns").setServers(["8.8.8.8", "1.1.1.1"]);

const mongoose = require("mongoose");

// ⚠️ Admin panel ka folder naam alag ho to sirf ye path badlein
const AdminUser = require("../adminPanel/model/adminUserModel");

const URI =
  process.env.MONGODB_URL || process.env.MONGO_URI || process.env.MONGODB_URI;
(async () => {
  const [name, email, password, flag] = process.argv.slice(2);
  const reset = flag === "--reset";

  if (!name || !email || !password) {
    console.error(
      'Usage: node scripts/createAdmin.js "Name" email@example.com "Password" [--reset]',
    );
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password kam se kam 6 characters ka hona chahiye");
    process.exit(1);
  }
  if (!URI) {
    console.error("MONGODB_URL .env me nahi mila");
    process.exit(1);
  }
  if (!process.env.ADMIN_JWT_SECRET) {
    console.warn(
      "⚠️  ADMIN_JWT_SECRET .env me nahi hai — admin ban jayega, lekin login tab tak fail hoga jab tak server ke env me ye set na ho.",
    );
  }

  await mongoose.connect(URI);

  const cleanEmail = email.toLowerCase().trim();
  const existing = await AdminUser.findOne({ email: cleanEmail });

  if (existing && !reset) {
    console.error(
      `❌ ${cleanEmail} se admin pehle se bana hai. Password badalna ho to end me --reset lagayein.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  if (existing && reset) {
    // Plain password do — model ka pre-save hook khud hash karega
    existing.password = password;
    existing.isActive = true;
    await existing.save();
    console.log(
      `✅ Password reset ho gaya: ${cleanEmail} (role: ${existing.role})`,
    );
  } else {
    // Plain password do — model ka pre-save hook khud hash karega
    const admin = await AdminUser.create({
      name: name.trim(),
      email: cleanEmail,
      password,
      role: "trustee", // full access — team members isi se banayenge
      designation: "Trustee",
      isActive: true,
    });
    console.log(
      `✅ Admin ban gaya: ${admin.email} (role: ${admin.role}, id: ${admin._id})`,
    );
  }

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("❌ Error:", err.message);
  await mongoose.disconnect();
  process.exit(1);
});
