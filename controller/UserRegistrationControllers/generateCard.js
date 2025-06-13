const { createCanvas, loadImage } = require('canvas');
const QRCode = require('qrcode');
const JainAadhar = require('../../model/UserRegistrationModels/jainAadharModel');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const User = require('../../model/UserRegistrationModels/userModel');

const generateJainAadharCard = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await JainAadhar.findById(id);
    const user = await User.findById(application.userId);

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }
const GAP_BETWEEN_CARDS = 40;

    const width = 1011, height = 639;
    const combinedCanvas = createCanvas(width, height * 2 + GAP_BETWEEN_CARDS);
    const ctx = combinedCanvas.getContext('2d');
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, width, height * 2 + GAP_BETWEEN_CARDS);
    // === FRONT SIDE ===
    const frontTemplate = await loadImage(path.join(__dirname, '../../Public/shravak_front.jpeg'));
    ctx.drawImage(frontTemplate, 0, 0, width, height);

    if (application.userProfile) {
      const profileRes = await axios.get(application.userProfile, { responseType: 'arraybuffer' });
      const profileImg = await loadImage(profileRes.data);
      ctx.drawImage(profileImg, 40, 210, 240, 240);
    }

    ctx.fillStyle = 'black';
    ctx.font = '26px Georgia';
    ctx.fillText(application.name || 'N/A', 490, 170);
    ctx.fillText(application.pitaOrpatiName || 'N/A', 490, 224);
    ctx.fillText(application.dob || 'N/A', 490, 268);
    ctx.fillText(application.mulJain || 'N/A', 490, 317);
    ctx.fillText(application.panth || 'N/A', 490, 362);
    ctx.fillText(application.subCaste || 'N/A', 490, 408);
    ctx.fillText(application.gotra || 'N/A', 490, 460);
    ctx.fillText(application.location?.city || 'N/A', 490, 505);

    const jainAadharNumber = user?.jainAadharNumber || 'N/A';
    ctx.font = 'bold 24px Georgia';
    ctx.fillText(jainAadharNumber, 350, 560);

    // === BACK SIDE ===
    const backTemplate = await loadImage(path.join(__dirname, '../../Public/Shravak_back.jpeg'));
    ctx.drawImage(backTemplate, 0, height + GAP_BETWEEN_CARDS, width, height);


    ctx.fillStyle = 'black';
    ctx.font = '26px Georgia';
    const xPos = 280;
    const addressLine1 = application.location?.address || 'N/A';
    const addressLine2 = `${application.location?.city || 'N/A'}, ${application.location?.pinCode || ''}`.trim();
    ctx.fillText(addressLine1, xPos, height + 190);
    ctx.fillText(addressLine2, xPos, height + 220);

    if (application.mobileNumber) {
      const mobileText = `Mobile: ${application.mobileNumber}`;
      const mobileTextWidth = ctx.measureText(mobileText).width;
      ctx.fillText(mobileText, width - mobileTextWidth - 100, height + 240);
    }

    ctx.font = 'bold 26px Georgia';
    ctx.fillText('Jain Prabuddh Manch', 280, (height * 2) - 152);

    // === QR Code ===
    const qrUrl = `https://jainprabhudh-manch-backend.onrender.com/api/generate-card/verify/jain-shravak/${user._id}`;
    const qrCodeDataURL = await QRCode.toDataURL(qrUrl);
    const qrImage = await loadImage(qrCodeDataURL);
  ctx.drawImage(qrImage, 550, height + 260, 150, 150);// Right side QR code

    res.setHeader('Content-Type', 'image/jpeg');
    combinedCanvas.createJPEGStream().pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to generate card', error: error.message });
  }
};

module.exports = { generateJainAadharCard };
