const { createCanvas, loadImage, registerFont } = require("canvas");
const QRCode = require("qrcode");
const JainAadhar = require("../../model/UserRegistrationModels/jainAadharModel");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");
// Force Pango backend (fixes Devanagari rendering issue)
process.env.PANGOCAIRO_BACKEND = "fontconfig";

// ================= FONT LOAD =================
const fontPath = path.resolve(
  __dirname,
  "../../Public/fonts/NotoSansDevanagari-Regular.ttf",
);

if (fs.existsSync(fontPath)) {
  registerFont(fontPath, { family: "NotoDevanagari" });
//  console.log("✅ Font Loaded");
} else {
  console.error("❌ Font not found:", fontPath);
}

// ================= TEMPLATE PRELOAD =================
let templateShravak1;
let templateShravak2;
let templateBack;

// Helper: format DOB as DD/MM/YYYY
function formatDOB(dob) {
  if (!dob) return "N/A";
  const d = new Date(dob);
  if (isNaN(d.getTime())) {
    // agar already string format me hai "YYYY-MM-DD" type
    const parts = String(dob).split(/[-/]/);
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return String(dob);
  }
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}
async function loadTemplates() {
  try {
    templateShravak1 = await loadImage(
      path.join(__dirname, "../../Public/shravak_1.jpeg"),
    );

    templateShravak2 = await loadImage(
      path.join(__dirname, "../../Public/shravak_3.jpeg"),
    );

    templateBack = await loadImage(
      path.join(__dirname, "../../Public/sharavk_2.jpeg"),
    );

   // console.log("✅ Card Templates Loaded");
  } catch (err) {
    console.error("❌ Template Load Error:", err);
  }
}

loadTemplates();

const generateJainAadharCard = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await JainAadhar.findById(id);

    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    // === Template Selection Logic ===
    // jain_shravak_1.jpeg → "FATHER" label → Male (any) + Female (Unmarried)
    // jain_shravak_2.jpeg → "HUSBAND" label → Female (Married) only
    let templateName = "";
    let pitaOrPatiLabel = "";

    if (
      application.gender === "Female" &&
      application.marriedStatus === "Yes"
    ) {
      // Married Female → Husband name + jain_shravak_2 (HUSBAND label)
      templateName = "jain_shravak_2.jpeg";
      pitaOrPatiLabel =
        application.husbandName ||
        application.husbandWifeName ||
        application.pitaOrpatiName ||
        "N/A";
    } else {
      // Male (married/unmarried) + Female (unmarried) → Father name + jain_shravak_1 (FATHER label)
      templateName = "jain_shravak_1.jpeg";
      pitaOrPatiLabel =
        application.fatherName ||
        application.pitaOrpatiName ||
        application.pitaKaNaam ||
        "N/A";
    }

    // === Create Canvas ===
    const GAP_BETWEEN_CARDS = 40;
    const width = 1011,
      height = 639;
    const combinedCanvas = createCanvas(width, height * 2 + GAP_BETWEEN_CARDS);
    const ctx = combinedCanvas.getContext("2d");

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height * 2 + GAP_BETWEEN_CARDS);

    // === FRONT SIDE ===
    const frontTemplate = await loadImage(
      path.join(__dirname, `../../Public/${templateName}`),
    );
    ctx.drawImage(frontTemplate, 0, 0, width, height);

    // PROFILE IMAGE (Right Side)
    if (application.userProfile) {
      const profileRes = await axios.get(application.userProfile, {
        responseType: "arraybuffer",
      });
      const resizedBuffer = await sharp(profileRes.data)
        .resize(220, 240)
        .jpeg({ quality: 80 })
        .toBuffer();

      const profileImg = await loadImage(resizedBuffer);

      const imgX = 760;
      const imgY = 170;
      const imgWidth = 215;
      const imgHeight = 240;
      const radius = 25;

      ctx.save();

      ctx.beginPath();
      ctx.moveTo(imgX + radius, imgY);
      ctx.lineTo(imgX + imgWidth - radius, imgY);
      ctx.quadraticCurveTo(
        imgX + imgWidth,
        imgY,
        imgX + imgWidth,
        imgY + radius,
      );
      ctx.lineTo(imgX + imgWidth, imgY + imgHeight - radius);
      ctx.quadraticCurveTo(
        imgX + imgWidth,
        imgY + imgHeight,
        imgX + imgWidth - radius,
        imgY + imgHeight,
      );
      ctx.lineTo(imgX + radius, imgY + imgHeight);
      ctx.quadraticCurveTo(
        imgX,
        imgY + imgHeight,
        imgX,
        imgY + imgHeight - radius,
      );
      ctx.lineTo(imgX, imgY + radius);
      ctx.quadraticCurveTo(imgX, imgY, imgX + radius, imgY);
      ctx.closePath();

      ctx.clip();
      ctx.drawImage(profileImg, imgX, imgY, imgWidth, imgHeight);
      ctx.restore();
    }

    // TEXT POSITIONS
    ctx.fillStyle = "#333333";
    ctx.font = "28px Georgia";

    ctx.fillText(application.name || "N/A", 335, 225);
    ctx.fillText(pitaOrPatiLabel, 335, 275);
    ctx.fillText(formatDOB(application.dob), 335, 330);
    ctx.fillText(application.mulJain || "N/A", 335, 384);

    // Hindi font for Panth
    ctx.font = "27px NotoDevanagari";
    ctx.fillText(application.panth || "N/A", 335, 435);

    // Aadhar Number
    ctx.font = "bold 30px Georgia";
    ctx.fillText(application.jainAadharNumber || "N/A", 380, 560);

    // === BACK SIDE ===
    const backTemplate = await loadImage(
      path.join(__dirname, "../../Public/sharavk_2.jpeg"),
    );
    ctx.drawImage(backTemplate, 0, height + GAP_BETWEEN_CARDS, width, height);

    ctx.fillStyle = "#333333";
    ctx.font = "27px Georgia";
    const xPos = 370;
    let yPos = height + 240;
    const maxWidth = 500;

    const fullAddress =
      `${application.location?.address || "N/A"} ${application.location?.city || ""} - ${application.location?.pinCode || ""}`.trim();

    function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
      const words = text.split(" ");
      let line = "";
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const testWidth = ctx.measureText(testLine).width;
        if (testWidth > maxWidth && n > 0) {
          ctx.fillText(line.trim(), x, y);
          line = words[n] + " ";
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line.trim(), x, y);
      return y + lineHeight;
    }

    yPos = wrapText(ctx, fullAddress, xPos, yPos, maxWidth, 40);

    // === QR Code ===
    const qrUrl = `https://jainprabhudh-manch-backend.onrender.com/api/generate-card/verify/jain-shravak/${application.jainAadharNumber}`;
    const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 200 });
    const qrImage = await loadImage(qrBuffer);
    ctx.drawImage(qrImage, 750, height + 280, 180, 180);
    ctx.font = "bold 24px Georgia";
    ctx.fillStyle = "#333333";
    ctx.fillText(
      "Reg. No: DL/2025/0487190",
      350, // ← 310 → 340 (thoda right)
      height + GAP_BETWEEN_CARDS + 490, 
    );
    const issueDate = formatDOB(application.createdAt);
    ctx.font = "bold 24px Georgia";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(issueDate, 280, height + GAP_BETWEEN_CARDS + 625);

    res.setHeader("Content-Type", "image/jpeg");
    combinedCanvas.createJPEGStream().pipe(res);
  } catch (error) {
    console.error("❌ Error generating card:", error);
    res
      .status(500)
      .json({ message: "Failed to generate card", error: error.message });
  }
};

// ================= MINORITY CARD TEMPLATE PRELOAD =================
let templateMinority;

async function loadMinorityTemplate() {
  try {
    templateMinority = await loadImage(
      path.join(__dirname, "../../Public/minoritycard.png"),
    );
   // console.log("Minority Card Template Loaded");
  } catch (err) {
    console.error("❌ Minority Template Load Error:", err);
  }
}
loadMinorityTemplate();

// Helper: truncate text if exceeds maxWidth
function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

// Helper: wrap text into max 2 lines (with ellipsis if even 2 lines overflow)
function wrapTextTwoLines(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) {
    return [text]; // fits in single line
  }

  const words = text.split(" ");
  let line1 = "";
  let i = 0;

  // Build line 1 — add words until next word would overflow
  for (; i < words.length; i++) {
    const test = line1 ? line1 + " " + words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth) break;
    line1 = test;
  }

  // Edge case: even first word too long → hard truncate
  if (!line1) {
    line1 = truncateText(ctx, words[0], maxWidth);
    i = 1;
  }

  // Build line 2 from remaining words
  let line2 = words.slice(i).join(" ");
  if (ctx.measureText(line2).width > maxWidth) {
    line2 = truncateText(ctx, line2, maxWidth);
  }

  return [line1, line2];
}

// ================= GENERATE MINORITY CARD =================
const generateMinorityCard = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await JainAadhar.findById(id);
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    // === Canvas size match karo template se (portrait) ===
    const width = 800;
    const height = 1300;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // === Background: minority_card.png ===
    const template = templateMinority || await loadImage(
      path.join(__dirname, "../../Public/minoritycard.png"),
    );
    ctx.drawImage(template, 0, 0, width, height);

    // === PROFILE IMAGE (left box) ===
    if (application.userProfile) {
      try {
        const profileRes = await axios.get(application.userProfile, {
          responseType: "arraybuffer",
        });
        const resizedBuffer = await sharp(profileRes.data)
          .resize(210, 270)
          .jpeg({ quality: 80 })
          .toBuffer();
        const profileImg = await loadImage(resizedBuffer);

        const imgX = 85;
        const imgY = 465;
        const imgWidth = 223;
        const imgHeight = 268;
        const radius = 15;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(imgX + radius, imgY);
        ctx.lineTo(imgX + imgWidth - radius, imgY);
        ctx.quadraticCurveTo(imgX + imgWidth, imgY, imgX + imgWidth, imgY + radius);
        ctx.lineTo(imgX + imgWidth, imgY + imgHeight - radius);
        ctx.quadraticCurveTo(imgX + imgWidth, imgY + imgHeight, imgX + imgWidth - radius, imgY + imgHeight);
        ctx.lineTo(imgX + radius, imgY + imgHeight);
        ctx.quadraticCurveTo(imgX, imgY + imgHeight, imgX, imgY + imgHeight - radius);
        ctx.lineTo(imgX, imgY + radius);
        ctx.quadraticCurveTo(imgX, imgY, imgX + radius, imgY);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(profileImg, imgX, imgY, imgWidth, imgHeight);
        ctx.restore();
      } catch (imgErr) {
        console.warn("⚠️ Profile image load failed:", imgErr.message);
      }
    }

    // === Name (top) ===
    ctx.fillStyle = "#333333";
    ctx.font = "bold 24px Georgia";
    ctx.fillText(application.name || "N/A", 350, 500); // adjust y as needed

    // === Father/Husband Name logic ===
    let fatherOrHusband = "N/A";

    if (application.gender === "Female") {
      // Female (married ya unmarried) → pitaOrpatiName → pitaKaNaam → fatherName
      fatherOrHusband =
        application.pitaOrpatiName ||
        application.pitaKaNaam ||
        application.fatherName ||
        "N/A";
    } else {
      // Male → fatherName → pitaOrpatiName → pitaKaNaam
      fatherOrHusband =
        application.fatherName ||
        application.pitaOrpatiName ||
        application.pitaKaNaam ||
        "N/A";
    }

    ctx.fillStyle = "#333333";
    ctx.font = "18px Georgia";

    const maxFieldWidth = 220; // colon ke baad available space

    // === Father's Name → 2-line wrap if needed ===
    const fatherLines = wrapTextTwoLines(ctx, fatherOrHusband, maxFieldWidth);
    if (fatherLines.length === 1) {
      // Single line → original position (no visual change for short names)
      ctx.fillText(fatherLines[0], 535, 545);
    } else {
      // 2 lines → shift slightly so both lines stay around field centre
      ctx.fillText(fatherLines[0], 535, 535);
      ctx.fillText(fatherLines[1], 535, 560);
    }

    ctx.fillText(
      truncateText(ctx, application.gender || "N/A", maxFieldWidth),
      535,
      598,
    );
   ctx.fillText(
     truncateText(ctx, formatDOB(application.dob), maxFieldWidth),
     535,
     650,
   );
    ctx.fillText(
      truncateText(ctx, application.jainAadharNumber || "N/A", maxFieldWidth),
      535,
      703,
    );

    // === Permanent Address ===
    const fullAddress =
      [
        application.location?.address,
        application.location?.city,
        application.location?.state,
        application.location?.pinCode
          ? `- ${application.location.pinCode}`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || "N/A";

    ctx.font = "23px Georgia";
    wrapTextMinority(ctx, fullAddress, 100, 830, 600, 36);

    // === Certify Name (between "certify that" and "belongs") ===
    ctx.font = "25px bold Georgia";
    ctx.fillStyle = "#8B0000"; // dark red to match card style
    ctx.fillText(application.name || "N/A", 320, 959);

    // === Issue Date ===
    const issueDate = application.createdAt
      ? new Date(application.createdAt).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : new Date().toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

    ctx.fillStyle = "#333333";
    ctx.font = "20px Georgia";
    ctx.fillText(issueDate, 100, 1080);

    // === Send Response ===
    res.setHeader("Content-Type", "image/jpeg");
    canvas.createJPEGStream({ quality: 0.95 }).pipe(res);
  } catch (error) {
    console.error("❌ Error generating minority card:", error);
    res.status(500).json({
      message: "Failed to generate minority card",
      error: error.message,
    });
  }
};

// Helper: wrap text for address
function wrapTextMinority(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, y);
}

module.exports = { generateJainAadharCard, generateMinorityCard };