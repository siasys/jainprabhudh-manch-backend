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
      return res.status(404).json({ message: 'Application not found' });
    }

    // === Template Selection Logic ===
    let templateName = '';
    let pitaOrPatiLabel = '';

    if (application.gender === 'Female' && application.marriedStatus === 'Yes') {
      templateName = 'New_shravk1.jpeg'; // Married Female template
      pitaOrPatiLabel = application.husbandName || application.pitaOrpatiName || 'N/A';
    } else if (
      (application.gender === 'Male' && (application.marriedStatus === 'Yes' || application.marriedStatus === 'No')) ||
      (application.gender === 'Female' && application.marriedStatus === 'No')
    ) {
      templateName = 'new_shravk2.jpeg'; // Unmarried female or any male template
      pitaOrPatiLabel = application.fatherName || application.pitaOrpatiName || 'N/A';
    } else {
      templateName = 'new_shravk2.jpeg';
      pitaOrPatiLabel = application.pitaOrpatiName || 'N/A';
    }

    // === Create Canvas ===
    const GAP_BETWEEN_CARDS = 40;
    const width = 1011, height = 639;
    const combinedCanvas = createCanvas(width, height * 2 + GAP_BETWEEN_CARDS);
    const ctx = combinedCanvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height * 2 + GAP_BETWEEN_CARDS);

    // === FRONT SIDE ===
    const frontTemplate = await loadImage(path.join(__dirname, `../../Public/${templateName}`));
    ctx.drawImage(frontTemplate, 0, 0, width, height);

    if (application.userProfile) {
      const profileRes = await axios.get(application.userProfile, { responseType: 'arraybuffer' });
      const profileImg = await loadImage(profileRes.data);
      ctx.drawImage(profileImg, 30, 180, 250, 260);
    }

    ctx.fillStyle = 'black';
    ctx.font = '26px Georgia';
    ctx.fillText(application.name || 'N/A', 500, 170);
    ctx.fillText(pitaOrPatiLabel, 500, 225);
    ctx.fillText(application.dob || 'N/A', 500, 268);
    ctx.fillText(application.mulJain || 'N/A', 500, 318);

    // Hindi font for Panth
    ctx.font = '26px NotoDevanagari';
    ctx.fillText(application.panth || 'N/A', 500, 365);

    ctx.font = 'bold 30px Georgia';
    ctx.fillText(application.jainAadharNumber || 'N/A', 350, 560);

    // === BACK SIDE ===
    const backTemplate = await loadImage(path.join(__dirname, '../../Public/Shravak_back.jpg'));
    ctx.drawImage(backTemplate, 0, height + GAP_BETWEEN_CARDS, width, height);

    ctx.fillStyle = 'black';
    ctx.font = '26px Georgia';
    const xPos = 290;
    const addressLine1 = application.location?.address || 'N/A';
    const addressLine2 = `${application.location?.city || 'N/A'}, ${application.location?.pinCode || ''}`.trim();
    ctx.fillText(addressLine1, xPos, height + 230);
    ctx.fillText(addressLine2, xPos, height + 270);

    if (application.mobileNumber) {
      const mobileText = `Mobile: ${application.mobileNumber}`;
      const mobileTextWidth = ctx.measureText(mobileText).width;
      ctx.fillText(mobileText, width - mobileTextWidth - 100, height + 240);
    }

    ctx.font = 'bold 26px Georgia';
    ctx.fillText('Jain Prabuddh Manch Trust', 300, (height * 2) - 112);

    // === QR Code ===
    const qrUrl = `https://jainprabhudh-manch-backend.onrender.com/api/generate-card/verify/jain-shravak/${application.jainAadharNumber}`;
    const qrCodeDataURL = await QRCode.toDataURL(qrUrl);
    const qrImage = await loadImage(qrCodeDataURL);
    ctx.drawImage(qrImage, 600, height + 260, 180, 180);

    res.setHeader('Content-Type', 'image/jpeg');
    combinedCanvas.createJPEGStream().pipe(res);

  } catch (error) {
    console.error('❌ Error generating card:', error);
    res.status(500).json({ message: 'Failed to generate card', error: error.message });
  }
};

module.exports = { generateJainAadharCard };
