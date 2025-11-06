const { createCanvas, loadImage, registerFont } = require("canvas");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const SadhuModel = require("../../model/SadhuModels/sadhuModel");

// === Font setup ===
process.env.PANGOCAIRO_BACKEND = "fontconfig";

const fontPath = path.resolve(__dirname, "../../Public/fonts/NotoSansDevanagari-Regular.ttf");
if (!fs.existsSync(fontPath)) {
  console.error("❌ Font file not found:", fontPath);
} else {
  registerFont(fontPath, { family: "NotoDevanagari" });
}

// === Generate Sadhu Card (Front Only) ===
const generateSadhuCard = async (req, res) => {
  try {
    const { id } = req.params;
    const sadhu = await SadhuModel.findById(id);

    if (!sadhu) {
      return res.status(404).json({ message: "Sadhu not found" });
    }

    // === Canvas setup ===
    const width = 1011;
    const height = 639;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // === Load Sadhu card template ===
    const templatePath = path.join(__dirname, "../../Public/Sadhucard.jpeg");
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ message: "Sadhu card template not found" });
    }

    const frontTemplate = await loadImage(templatePath);
    ctx.drawImage(frontTemplate, 0, 0, width, height);

    // === Profile Image ===
    if (sadhu.uploadImage) {
      try {
        const profileRes = await axios.get(sadhu.uploadImage, { responseType: "arraybuffer" });
        const profileImg = await loadImage(profileRes.data);
       ctx.drawImage(profileImg, 30, 185, 230, 270);
      } catch (err) {
        console.warn("⚠️ Failed to load profile image:", err.message);
      }
    }

    // === Sadhu Details ===
    ctx.fillStyle = "black";
    ctx.font = "bold 37px Georgia";
    ctx.fillText(sadhu.sadhuName || "N/A", 570, 230);
    ctx.fillText(sadhu.guruName || "N/A", 570, 320);
   // === Format dikshaTithi ===
    let formattedDikshaTithi = "N/A";
    if (sadhu.dikshaTithi) {
    const dateObj = new Date(sadhu.dikshaTithi);
    const day = String(dateObj.getDate()).padStart(2, "0");
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const year = dateObj.getFullYear();
    formattedDikshaTithi = `${day}/${month}/${year}`;
    }
    ctx.fillText(formattedDikshaTithi, 570, 395);

    // === Sadhu ID (center bottom like Aadhar Number) ===
    ctx.font = "bold 34px Georgia";
    const sadhuIdText = sadhu.sadhuID || "N/A";
    const textWidth = ctx.measureText(sadhuIdText).width;
    const centerX = (width - textWidth) / 2;
    ctx.fillText(sadhuIdText, centerX, 560);

    // === Footer (Optional) ===
    // ctx.font = "22px Georgia";
    // ctx.fillText("Jain Prabuddh Manch Trust", 360, 610);

    // === Send the image ===
    res.setHeader("Content-Type", "image/jpeg");
    canvas.createJPEGStream().pipe(res);
  } catch (error) {
    console.error("❌ Error generating Sadhu card:", error);
    res.status(500).json({ message: "Failed to generate Sadhu card", error: error.message });
  }
};

module.exports = { generateSadhuCard };
