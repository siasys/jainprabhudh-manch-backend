const { createCanvas, loadImage, registerFont } = require("canvas");
const path = require("path");
const fs = require("fs");
const HierarchicalSangh = require("../../model/SanghModels/hierarchicalSanghModel");

process.env.PANGOCAIRO_BACKEND = "fontconfig";

// ================= FONT LOAD =================
const fontPath = path.resolve(
  __dirname,
  "../../Public/fonts/NotoSansDevanagari-Regular.ttf",
);
const fontBoldPath = path.resolve(
  __dirname,
  "../../Public/fonts/NotoSansDevanagari-Bold.ttf",
);

if (fs.existsSync(fontPath)) {
  registerFont(fontPath, { family: "NotoDevanagari" });
  console.log("✅ NotoDevanagari Regular Font Loaded");
} else {
  console.error("❌ Font not found:", fontPath);
}

if (fs.existsSync(fontBoldPath)) {
  registerFont(fontBoldPath, { family: "NotoDevanagari", weight: "bold" });
  console.log("✅ NotoDevanagari Bold Font Loaded");
}

// ================= TEMPLATE PRELOAD =================
let templateSanghCertificate;

async function loadSanghTemplate() {
  try {
    templateSanghCertificate = await loadImage(
      path.join(__dirname, "../../Public/sangh_certificate.png"),
    );
    console.log("✅ Sangh Certificate Template Loaded");
  } catch (err) {
    console.error("❌ Sangh Certificate Template Load Error:", err);
  }
}

loadSanghTemplate();

// ================= HELPERS =================
const getHindiSanghType = (type) => {
  const sanghTypeMap = {
    main: "मुख्य संघ",
    mukhya: "मुख्य संघ",
    women: "महिला संघ",
    woman: "महिला संघ",
    mahila: "महिला संघ",
    youth: "युवा संघ",
    yuth: "युवा संघ",
    yuva: "युवा संघ",
  };

  return sanghTypeMap[String(type || "").toLowerCase()] || "मुख्य संघ";
};

const getCityForRegistration = (sangh) => {
  const fromLocation =
    sangh.location?.city || sangh.location?.district || sangh.location?.state;

  if (fromLocation) return fromLocation;

  const name = sangh.name || "SANGH";
  return name.split(" ")[0] || "SANGH";
};

const generateRegistrationNumber = (sangh, sanghId) => {
  const cityName = getCityForRegistration(sangh)
    .toString()
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();

  const randomDigits = Math.floor(1000 + Math.random() * 9000);

  return `${cityName}-${randomDigits}`;
};

const fitText = (ctx, text, maxWidth) => {
  let finalText = text || "";
  while (ctx.measureText(finalText).width > maxWidth && finalText.length > 5) {
    finalText = finalText.slice(0, -1);
  }
  return finalText !== text ? `${finalText}...` : finalText;
};

// ================= MAIN FUNCTION =================
const generateSanghCertificate = async (req, res) => {
  try {
    const { sanghId } = req.params;

    // === Fetch Sangh from DB ===
    const sangh = await HierarchicalSangh.findById(sanghId);

    if (!sangh) {
      return res.status(404).json({ message: "Sangh not found" });
    }

    // === Sangh Details ===
    const sanghName = sangh.name || "N/A";

    // Example:
    // Khargone Shahar Sangh => KHARGONE-1234
    const registrationNumber = generateRegistrationNumber(sangh, sanghId);

    // main => मुख्य संघ, women => महिला संघ, youth/yuth => युवा संघ
    const role = getHindiSanghType(sangh.sanghType);

    // Place: city > district > state
    const place =
      sangh.location?.city ||
      sangh.location?.district ||
      sangh.location?.state ||
      "N/A";

    // Date: establishedDate ya today
    const issueDate = sangh.establishedDate
      ? new Date(sangh.establishedDate).toLocaleDateString("hi-IN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : new Date().toLocaleDateString("hi-IN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

    // === Canvas Setup ===
    const width = 1600;
    const height = 1131;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // === Draw Background Template ===
    const template =
      templateSanghCertificate ||
      (await loadImage(
        path.join(__dirname, "../../Public/sangh_certificate.png"),
      ));

    ctx.drawImage(template, 0, 0, width, height);

    // =========================================================
    // === DYNAMIC TEXT OVERLAY ===
    // =========================================================

    // ---------------------------------------------------------
    // 1. "द्वारा यह प्रमाणित किया जाता है कि" ke niche Sangh Name
    // ---------------------------------------------------------
    ctx.save();
    ctx.font = "bold 34px NotoDevanagari";
    ctx.fillStyle = "#1a1a6e";
    ctx.textAlign = "center";

    const displaySanghName = fitText(ctx, sanghName, 650);
    ctx.fillText(displaySanghName, width / 2, 425);
    ctx.restore();

    // ---------------------------------------------------------
    // 2. "पंजीयन क्रमांक :" ke aage Registration Number
    // ---------------------------------------------------------
    ctx.save();
    ctx.font = "bold 32px NotoDevanagari";
    ctx.fillStyle = "#1a1a6e";
    ctx.textAlign = "left";
    ctx.fillText(registrationNumber, width / 2 + 20, 475);
    ctx.restore();

    // ---------------------------------------------------------
    // 3. Badge ke andar Role
    // मुख्य संघ / महिला संघ / युवा संघ
    // ---------------------------------------------------------
    ctx.save();
    ctx.font = "bold 33px NotoDevanagari";
    ctx.fillStyle = "#FFD700";
    ctx.textAlign = "center";
    ctx.fillText(role, width / 2, 610);
    ctx.restore();

    // ---------------------------------------------------------
    // 4. DATE — "दिनांक :" ke baad
    // ---------------------------------------------------------
    ctx.save();
    ctx.font = "28px NotoDevanagari";
    ctx.fillStyle = "#1a1a6e";
    ctx.textAlign = "left";
    ctx.fillText(issueDate, 280, 930);
    ctx.restore();

    // ---------------------------------------------------------
    // 5. PLACE — "स्थान :" ke baad
    // ---------------------------------------------------------
    ctx.save();
    ctx.font = "28px NotoDevanagari";
    ctx.fillStyle = "#1a1a6e";
    ctx.textAlign = "left";
    ctx.fillText(place, 280, 980);
    ctx.restore();

    // === Send Response ===
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="sangh_certificate_${sanghId}.jpg"`,
    );

    canvas.createJPEGStream({ quality: 0.95 }).pipe(res);
  } catch (error) {
    console.error("❌ Error generating Sangh Certificate:", error);

    res.status(500).json({
      message: "Failed to generate Sangh Certificate",
      error: error.message,
    });
  }
};

module.exports = { generateSanghCertificate };
