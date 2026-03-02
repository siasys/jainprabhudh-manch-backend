const { createCanvas, loadImage, registerFont } = require('canvas');
const QRCode = require('qrcode');
const JainAadhar = require('../../model/UserRegistrationModels/jainAadharModel');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// Force Pango backend (fixes Devanagari rendering issue)
process.env.PANGOCAIRO_BACKEND = 'fontconfig';

// ✅ Use absolute path for font and confirm existence
const fontPath = path.resolve(__dirname, '../../Public/fonts/NotoSansDevanagari-Regular.ttf');
if (!fs.existsSync(fontPath)) {
  console.error('❌ Font file not found at:', fontPath);
} else {
  console.log('✅ Font file found:', fontPath);
  registerFont(fontPath, { family: 'NotoDevanagari' });
}

const generateJainAadharCard = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await JainAadhar.findById(id);

    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    // === Template Selection Logic ===
    let templateName = "";
    let pitaOrPatiLabel = "";

    if (
      application.gender === "Female" &&
      application.marriedStatus === "Yes"
    ) {
      templateName = "jain_shravak_2.jpeg"; // Married Female template
      pitaOrPatiLabel =
        application.husbandName || application.pitaOrpatiName || "N/A";
    } else if (
      (application.gender === "Male" &&
        (application.marriedStatus === "Yes" ||
          application.marriedStatus === "No")) ||
      (application.gender === "Female" && application.marriedStatus === "No")
    ) {
      templateName = "jain_shravak_2.jpeg"; // Unmarried female or any male template
      pitaOrPatiLabel =
        application.fatherName || application.pitaOrpatiName || "N/A";
    } else {
      templateName = "jain_shravak_2.jpeg";
      pitaOrPatiLabel = application.pitaOrpatiName || "N/A";
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

    // PROFILE IMAGE (Right Side Now)
    if (application.userProfile) {
      const profileRes = await axios.get(application.userProfile, {
        responseType: "arraybuffer",
      });
      const profileImg = await loadImage(profileRes.data);

      const imgX = 760;
      const imgY = 170;
      const imgWidth = 215;
      const imgHeight = 240;
      const radius = 25;

      ctx.save();

      // Rounded rectangle path
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

    // ✅ TEXT POSITIONS (Left Side Now)
    ctx.fillStyle = "#333333";
    ctx.font = "28px Georgia";

    // LEFT aligned fields
    ctx.fillText(application.name || "N/A", 335, 225);
    ctx.fillText(pitaOrPatiLabel, 335, 275);
    ctx.fillText(application.dob || "N/A", 335, 330);
    ctx.fillText(application.mulJain || "N/A", 335, 384);

    // Hindi font for Panth
    ctx.font = "27px NotoDevanagari";
    ctx.fillText(application.panth || "N/A", 335, 435);

    // Aadhar Number bottom center
    ctx.font = "bold 30px Georgia";
    ctx.fillText(application.jainAadharNumber || "N/A", 380, 560);

    // === BACK SIDE ===
    const backTemplate = await loadImage(
      path.join(__dirname, "../../Public/jain_shravak_3.jpeg"),
    );
    ctx.drawImage(backTemplate, 0, height + GAP_BETWEEN_CARDS, width, height);

    ctx.fillStyle = "#333333";
    ctx.font = "27px Georgia";
    const xPos = 430;
    let yPos = height + 240;
    const maxWidth = 500;
    // Full address + city/pin
    const fullAddress =
      `${application.location?.address || "N/A"} ${application.location?.city || ""} - ${application.location?.pinCode || ""}`.trim();

    // Function to split text into multiple lines based on maxWidth
    function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
      const words = text.split(" ");
      let line = "";
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;

        if (testWidth > maxWidth && n > 0) {
          ctx.fillText(line.trim(), x, y);
          line = words[n] + " ";
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line.trim(), x, y);
      return y + lineHeight; // return next y position
    }

    // Call wrapText
    yPos = wrapText(ctx, fullAddress, xPos, yPos, maxWidth, 40);

    if (application.mobileNumber) {
      const mobileText = `Mobile: ${application.mobileNumber}`;
      const mobileTextWidth = ctx.measureText(mobileText).width;
      ctx.fillText(mobileText, width - mobileTextWidth - 100, height + 240);
    }

    // ctx.font = "bold 26px Georgia";
    // ctx.fillText("Jain Prabuddh Manch Trust", 300, height * 2 - 112);

    // === QR Code ===
    const qrUrl = `https://jainprabhudh-manch-backend.onrender.com/api/generate-card/verify/jain-shravak/${application.jainAadharNumber}`;
    const qrCodeDataURL = await QRCode.toDataURL(qrUrl);
    const qrImage = await loadImage(qrCodeDataURL);
    ctx.drawImage(qrImage, 750, height + 280, 180, 180);

    res.setHeader("Content-Type", "image/jpeg");
    combinedCanvas.createJPEGStream().pipe(res);
  } catch (error) {
    console.error('❌ Error generating card:', error);
    res.status(500).json({ message: 'Failed to generate card', error: error.message });
  }
};

module.exports = { generateJainAadharCard };
