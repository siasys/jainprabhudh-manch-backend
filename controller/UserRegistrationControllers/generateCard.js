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
        const frontTemplatePath = path.join(__dirname, '../../Public/card-front.jpg');
        const frontTemplate = await loadImage(frontTemplatePath);
        frontCtx.drawImage(frontTemplate, 0, 0, width, height);

        // Draw Profile Image (optional)
        if (application.userProfile) {
            try {
                const profileRes = await axios.get(application.userProfile, { responseType: 'arraybuffer' });
                const profileImg = await loadImage(profileRes.data);
                // Adjusted position for profile image to match template
                frontCtx.drawImage(profileImg, 40, 190, 230, 250);
            } catch (error) {
                console.error('Error loading profile image:', error.message);
            }
        }
        frontCtx.fillStyle = 'black';
        frontCtx.font = '26px sans-serif';

        frontCtx.fillText(application.name || 'N/A', 490, 170);
        frontCtx.fillText(application.pitaOrpatiName || 'N/A', 490, 225);
        frontCtx.fillText(application.dob || 'N/A', 490, 270);
        frontCtx.fillText(application.mulJain || 'N/A', 490, 317);
        frontCtx.fillText(application.panth || 'N/A', 490, 362);
        frontCtx.fillText(application.subCaste || 'N/A', 490, 408);
        frontCtx.fillText(application.gotra || 'N/A', 490, 460);
        frontCtx.fillText(application.location?.city || 'N/A', 490, 505);
        
        // Add name at the top (appears to be in header area)
        // frontCtx.font = 'bold 30px sans-serif';
        // frontCtx.fillText(application.name || 'N/A', 280, 70);

        // === BACK SIDE ===
        const backCanvas = createCanvas(width, height);
        const backCtx = backCanvas.getContext('2d');
        const backTemplatePath = path.join(__dirname, '../../Public/card-back.jpg');
        const backTemplate = await loadImage(backTemplatePath);
        backCtx.drawImage(backTemplate, 0, 0, width, height);

        backCtx.fillStyle = 'black';
        backCtx.font = '26px sans-serif';
        
        // Multi-line address with better positioning
        const address = application.location?.address || 'Address N/A';
        const addressLines = wrapTextLines(backCtx, address, 800);
        
        // Start address at appropriate position on back template
        let startY = 150;
        addressLines.forEach((line, index) => {
            backCtx.fillText(line, 100, startY + index * 30);
        });
        
        backCtx.fillText(application.location?.city || 'City N/A', 100, startY + addressLines.length * 30 + 20);
        backCtx.fillText(application.location?.state || 'State N/A', 100, startY + addressLines.length * 30 + 50);
        backCtx.fillText(application.location?.pincode || 'Pincode N/A', 100, startY + addressLines.length * 30 + 80);

        // Mobile number if available
        if (application.mobileNumber) {
            backCtx.fillText(`Mobile: ${application.mobileNumber}`, 100, startY + addressLines.length * 30 + 110);
        }

        // Add QR code if available
        if (application.qrCode) {
            try {
                const qrRes = await axios.get(application.qrCode, { responseType: 'arraybuffer' });
                const qrImg = await loadImage(qrRes.data);
                backCtx.drawImage(qrImg, width - 200, height - 200, 150, 150);
            } catch (error) {
                console.error('Error loading QR code:', error.message);
            }
        }

        // === Output Front Side ===
        res.setHeader('Content-Type', 'image/jpeg');
        
        // Determine which side to send based on query param
        const side = req.query.side || 'front';
        if (side === 'front') {
            frontCanvas.createJPEGStream().pipe(res);
        } else if (side === 'back') {
            backCanvas.createJPEGStream().pipe(res);
        } else if (side === 'both') {
            // If both sides requested, create a combined image
            const combinedCanvas = createCanvas(width * 2, height);
            const combinedCtx = combinedCanvas.getContext('2d');
            combinedCtx.drawImage(frontCanvas, 0, 0);
            combinedCtx.drawImage(backCanvas, width, 0);
            combinedCanvas.createJPEGStream().pipe(res);
        } else {
            frontCanvas.createJPEGStream().pipe(res);
        }
        
        // Optional: Save both sides to disk for debugging
        // const frontBuffer = frontCanvas.toBuffer('image/jpeg');
        // const backBuffer = backCanvas.toBuffer('image/jpeg');
        // fs.writeFileSync('debug_front.jpeg', frontBuffer);
        // fs.writeFileSync('debug_back.jpeg', backBuffer);
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to generate card', error: error.message });
    }
};

// Helper function for text wrapping
function wrapTextLines(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (let word of words) {
        const testLine = currentLine + word + ' ';
        const { width } = ctx.measureText(testLine);
        
        if (width > maxWidth && currentLine !== '') {
            lines.push(currentLine.trim());
            currentLine = word + ' ';
        } else {
            currentLine = testLine;
        }
    }
    
    lines.push(currentLine.trim());
    return lines;
}

module.exports = {
    generateJainAadharCard,
};