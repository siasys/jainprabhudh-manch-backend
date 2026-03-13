const { createCanvas, loadImage, registerFont } = require("canvas");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");
const SadhuModel = require("../../model/SadhuModels/sadhuModel");

process.env.PANGOCAIRO_BACKEND = "fontconfig";

// ================= FONT =================
const fontPath = path.resolve(
  __dirname,
  "../../Public/fonts/NotoSansDevanagari-Regular.ttf",
);

if (fs.existsSync(fontPath)) {
  registerFont(fontPath, { family: "NotoDevanagari" });
  console.log("✅ Sadhu font loaded");
} else {
  console.error("❌ Font not found:", fontPath);
}

// ================= TEMPLATE PRELOAD =================
let sadhuTemplate;

async function loadTemplates() {
  try {
    const templatePath = path.join(__dirname, "../../Public/Sadhucard.jpeg");

    if (!fs.existsSync(templatePath)) {
      console.error("❌ Sadhu card template missing");
      return;
    }

    sadhuTemplate = await loadImage(templatePath);
    console.log("✅ Sadhu template loaded");
  } catch (err) {
    console.error("❌ Template load error:", err);
  }
}

loadTemplates();

// ================= GENERATE SADHU CARD =================
const generateSadhuCard = async (req, res) => {
  try {
    const { id } = req.params;

    const sadhu = await SadhuModel.findById(id);

    if (!sadhu) {
      return res.status(404).json({ message: "Sadhu not found" });
    }

    const width = 1011;
    const height = 639;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(sadhuTemplate, 0, 0, width, height);

    // ================= PROFILE IMAGE =================
  let imageUrl = Array.isArray(sadhu.uploadImage)
    ? sadhu.uploadImage[0]
    : sadhu.uploadImage;

  if (imageUrl) {
    try {
      const profileRes = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 5000,
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });

      const resizedBuffer = await sharp(profileRes.data)
        .resize(230, 270)
        .jpeg({ quality: 80 })
        .toBuffer();

      const profileImg = await loadImage(resizedBuffer);

      ctx.drawImage(profileImg, 30, 185, 230, 270);
    } catch (err) {
      console.warn("⚠️ Failed to load profile image:", err.message);
    }
  }
    // ================= SADHU DETAILS =================
    ctx.fillStyle = "black";

    ctx.font = "bold 37px Georgia";
    ctx.fillText(sadhu.sadhuName || "N/A", 570, 230);

    ctx.fillText(sadhu.guruName || "N/A", 570, 320);

    // ===== Format Diksha Date =====
    let formattedDikshaTithi = "N/A";

    if (sadhu.dikshaTithi) {
      const dateObj = new Date(sadhu.dikshaTithi);
      const day = String(dateObj.getDate()).padStart(2, "0");
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const year = dateObj.getFullYear();

      formattedDikshaTithi = `${day}/${month}/${year}`;
    }

    ctx.fillText(formattedDikshaTithi, 570, 395);

    // ================= SADHU ID =================
    ctx.font = "bold 34px Georgia";

    const sadhuIdText = sadhu.sadhuID || "N/A";

    const textWidth = ctx.measureText(sadhuIdText).width;
    const centerX = (width - textWidth) / 2;

    ctx.fillText(sadhuIdText, centerX, 560);

    // ================= RESPONSE =================
    res.setHeader("Content-Type", "image/jpeg");

    canvas.createJPEGStream().pipe(res);
  } catch (error) {
    console.error("❌ Error generating Sadhu card:", error);

    res.status(500).json({
      message: "Failed to generate Sadhu card",
      error: error.message,
    });
  }
};

module.exports = { generateSadhuCard };
