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

        // === FRONT SIDE ===
        const frontCanvas = createCanvas(width, height);
        const frontCtx = frontCanvas.getContext('2d');

        const frontTemplatePath = path.join(__dirname, '../../Public/front.jpeg');
        const frontTemplate = await loadImage(frontTemplatePath);
        frontCtx.drawImage(frontTemplate, 0, 0, width, height);

        if (application.userProfile) {
            const profileRes = await axios.get(application.userProfile, { responseType: 'arraybuffer' });
            const profileImg = await loadImage(profileRes.data);
            frontCtx.drawImage(profileImg, 40, 40, 120, 120);
        }

        frontCtx.fillStyle = 'black';
        frontCtx.font = '28px sans-serif';
        frontCtx.fillText(application.name || 'N/A', 200, 80);
        frontCtx.font = '24px sans-serif';
        frontCtx.fillText(application.pitaOrpatiName || 'Pita Orpati Name', 200, 120);
        frontCtx.fillText(application.dob || 'DOB', 200, 160);
        frontCtx.fillText(application.mulJain || 'Mul Jain', 200, 200);
        frontCtx.fillText(application.panth || 'Panth', 200, 240);
        frontCtx.fillText(application.subCaste || 'Sub Cast', 200, 280);
        frontCtx.fillText(application.gotra || 'Gotra', 200, 320);
        frontCtx.fillText(application.city || 'Gotra', 200, 320);

        // === BACK SIDE ===
        const backCanvas = createCanvas(width, height);
        const backCtx = backCanvas.getContext('2d');

        const backTemplatePath = path.join(__dirname,'../../Public/back.jpeg');
        const backTemplate = await loadImage(backTemplatePath);
        backCtx.drawImage(backTemplate, 0, 0, width, height);

        backCtx.fillStyle = 'black';
        backCtx.font = '24px sans-serif';
        backCtx.fillText(application.address || 'Address N/A', 100, 100);
        backCtx.fillText(application.city || 'City N/A', 100, 150);

        // Combine and send both images (returning front for now)
        res.setHeader('Content-Type', 'image/jpeg');
        frontCanvas.createJPEGStream().pipe(res);

        // Optional: Save to file or buffer for zip/send both
        // const frontBuffer = frontCanvas.toBuffer('image/jpeg');
        // const backBuffer = backCanvas.toBuffer('image/jpeg');
        // Combine or zip if needed

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to generate card', error: error.message });
    }
};

module.exports = {
    generateJainAadharCard,
};
