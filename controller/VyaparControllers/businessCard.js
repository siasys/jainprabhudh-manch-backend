const { createCanvas, loadImage, registerFont } = require("canvas");
const QRCode = require("qrcode");
const JainVyapar = require("../../model/VyaparModels/vyaparModel");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");

process.env.PANGOCAIRO_BACKEND = "fontconfig";

// ===== FONT =====
const fontPath = path.resolve(
  __dirname,
  "../../Public/fonts/NotoSansDevanagari-Regular.ttf",
);

if (fs.existsSync(fontPath)) {
  registerFont(fontPath, { family: "NotoDevanagari" });
}

// ===== TEMPLATE PRELOAD =====
let businessFrontTemplate;
let businessBackTemplate;

async function loadTemplates() {
  try {
    businessFrontTemplate = await loadImage(
      path.join(__dirname, "../../Public/business-1.jpeg"),
    );

    businessBackTemplate = await loadImage(
      path.join(__dirname, "../../Public/business-2.jpeg"),
    );

    console.log("✅ Business templates loaded");
  } catch (err) {
    console.error("❌ Template load error:", err);
  }
}

loadTemplates();

const generateBusinessCard = async (req, res) => {
  try {
    const { id } = req.params;

    const business = await JainVyapar.findById(id);

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    const WIDTH = 1011;
    const HEIGHT = 639;
    const GAP = 40;

    const canvas = createCanvas(WIDTH, HEIGHT * 2 + GAP);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ================= FRONT =================
    ctx.drawImage(businessFrontTemplate, 0, 0, WIDTH, HEIGHT);

    // ===== BUSINESS LOGO =====
    if (business.businessLogo) {
      try {
        const imgRes = await axios.get(business.businessLogo, {
          responseType: "arraybuffer",
          timeout: 5000,
          headers: { "User-Agent": "Mozilla/5.0" },
        });

        const resizedLogo = await sharp(imgRes.data)
          .resize(240, 240)
          .jpeg({ quality: 80 })
          .toBuffer();

        const logo = await loadImage(resizedLogo);

        ctx.drawImage(logo, 40, 200, 240, 240);
      } catch (err) {
        console.warn("⚠️ Logo load failed:", err.message);
      }
    }

    ctx.fillStyle = "#000";
    ctx.font = "26px Georgia";

    // ===== TEXT WRAP HELPER =====
    const wrapTextToLines = (text, maxWidth) => {
      if (!text || text === "N/A") return [text || "N/A"];

      const words = text.split(" ");
      const lines = [];
      let line = "";

      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + " ";
        const testWidth = ctx.measureText(testLine).width;

        if (testWidth > maxWidth && i > 0) {
          lines.push(line.trim());
          line = words[i] + " ";
        } else {
          line = testLine;
        }
      }

      lines.push(line.trim());
      return lines;
    };

    // ===== BUSINESS NAME =====
    const businessNameLines = wrapTextToLines(
      business.businessName || "N/A",
      280,
    );

    const businessNameStartY = 245;
    const businessNameLineHeight = 32;

    businessNameLines.slice(0, 2).forEach((line, index) => {
      ctx.fillText(
        line,
        720,
        businessNameStartY + index * businessNameLineHeight,
      );
    });

    const baselineY = businessNameStartY + 2 * businessNameLineHeight - 5;

    ctx.fillText(business.ownerName || "N/A", 720, baselineY);

    ctx.fillText(business.location?.city || "N/A", 720, baselineY + 50);

    ctx.fillText(business.contactPerson || "N/A", 720, baselineY + 95);

    ctx.fillText(business.email || "N/A", 580, 580);

    // ================= BACK =================
    ctx.drawImage(businessBackTemplate, 0, HEIGHT + GAP, WIDTH, HEIGHT);

    ctx.fillStyle = "#fff";
    ctx.font = "26px Georgia";

    let yPos = HEIGHT + 245;
    const xPos = 320;
    const maxWidth = 500;

    const addressText = `
${business.location?.address || ""}
${business.location?.city || ""}, ${business.location?.district || ""}
${business.location?.state || ""}
`.trim();

    const wrapText = (text) => {
      const words = text.split(" ");
      let line = "";

      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + " ";

        if (ctx.measureText(testLine).width > maxWidth) {
          ctx.fillText(line, xPos, yPos);
          line = words[i] + " ";
          yPos += 38;
        } else {
          line = testLine;
        }
      }

      ctx.fillText(line, xPos, yPos);
    };

    wrapText(addressText);

    // ===== BUSINESS CODE =====
    ctx.font = "bold 30px Georgia";

    ctx.fillText(business.businessCode || "N/A", 320, HEIGHT * 2 - 145);

    // ================= QR CODE =================
    const qrUrl = `https://jainprabhudh-manch-backend.onrender.com/api/vyapar/generate-card/verify/business/${business.businessCode}`;

    const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 200 });

    const qrImage = await loadImage(qrBuffer);

    ctx.drawImage(qrImage, 760, HEIGHT + 260, 180, 180);

    // ===== RESPONSE =====
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-cache");

    canvas.createJPEGStream({ quality: 0.9 }).pipe(res);
  } catch (error) {
    console.error("❌ Business card error:", error);

    res.status(500).json({
      message: "Failed to generate business card",
    });
  }
};

module.exports = { generateBusinessCard };
