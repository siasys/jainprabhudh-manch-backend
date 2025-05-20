const { createCanvas, loadImage } = require('canvas');
const JainAadhar = require('../../model/UserRegistrationModels/jainAadharModel');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const generateJainAadharCard = async (req, res) => {
    try {
        const { id } = req.params;
        const application = await JainAadhar.findById(id);
        if (!application) {
            return res.status(404).json({ message: 'Application not found' });
        }

        const width = 1011, height = 639;

        // === COMBINED CANVAS ===
        const combinedCanvas = createCanvas(width, height * 2);
        const combinedCtx = combinedCanvas.getContext('2d');

        // === FRONT SIDE ===
        const frontTemplatePath = path.join(__dirname, '../../Public/shravak_front.jpeg');
        const frontTemplate = await loadImage(frontTemplatePath);
        combinedCtx.drawImage(frontTemplate, 0, 0, width, height);

        if (application.userProfile) {
            const profileRes = await axios.get(application.userProfile, { responseType: 'arraybuffer' });
            const profileImg = await loadImage(profileRes.data);
            combinedCtx.drawImage(profileImg, 40, 210, 240, 240);
        }

        combinedCtx.fillStyle = 'black';
        combinedCtx.font = '26px Georgia';
        combinedCtx.fillText(application.name || 'N/A', 490, 170);
        combinedCtx.fillText(application.pitaOrpatiName || 'N/A', 490, 224);
        combinedCtx.fillText(application.dob || 'N/A', 490, 268);
        combinedCtx.fillText(application.mulJain || 'N/A', 490, 317);
        combinedCtx.fillText(application.panth || 'N/A', 490, 362);
        combinedCtx.fillText(application.subCaste || 'N/A', 490, 408);
        combinedCtx.fillText(application.gotra || 'N/A', 490, 460);
        combinedCtx.fillText(application.location?.city || 'N/A', 490, 505);

        // === BACK SIDE ===
        const backTemplatePath = path.join(__dirname, '../../Public/Shravak_back.jpeg');
        const backTemplate = await loadImage(backTemplatePath);
        combinedCtx.drawImage(backTemplate, 0, height, width, height);

       const addressLine1 = application.location?.address || 'N/A';
        const addressLine2 = `${application.location?.city || 'N/A'}, ${application.location?.pinCode || ''}`.trim();

        // Left side ke liye fixed x coordinate
        const xPos = 280;

        // Text draw karo
        combinedCtx.fillText(addressLine1, xPos, height + 190);
        combinedCtx.fillText(addressLine2, xPos, height + 220);

        if (application.mobileNumber) {
            const mobileText = `Mobile: ${application.mobileNumber}`;
            const mobileTextWidth = combinedCtx.measureText(mobileText).width;
            combinedCtx.fillText(mobileText, width - mobileTextWidth - 100, height + 240);
        }
        const footerText = 'Jain Prabuddh Manch Trust';
        combinedCtx.font = 'bold 26px Georgia';  // Bold font set karo
        combinedCtx.fillText(footerText, 280, (height * 2) - 152);

        if (application.qrCode) {
            const qrRes = await axios.get(application.qrCode, { responseType: 'arraybuffer' });
            const qrImg = await loadImage(qrRes.data);
            combinedCtx.drawImage(qrImg, width - 200, height * 2 - 200, 150, 150);
        }

        res.setHeader('Content-Type', 'image/jpeg');
        combinedCanvas.createJPEGStream().pipe(res);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to generate card', error: error.message });
    }
};

module.exports = { generateJainAadharCard };
