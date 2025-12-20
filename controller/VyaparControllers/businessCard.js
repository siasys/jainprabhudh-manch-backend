const { createCanvas, loadImage, registerFont } = require('canvas');
const QRCode = require('qrcode');
const JainVyapar = require('../../model/VyaparModels/vyaparModel');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

process.env.PANGOCAIRO_BACKEND = 'fontconfig';

// 🔤 Font
const fontPath = path.resolve(__dirname, '../../Public/fonts/NotoSansDevanagari-Regular.ttf');
if (fs.existsSync(fontPath)) {
  registerFont(fontPath, { family: 'NotoDevanagari' });
}

const generateBusinessCard = async (req, res) => {
  try {
    const { id } = req.params;
    const business = await JainVyapar.findById(id);

    if (!business) {
      return res.status(404).json({ message: 'Business not found' });
    }

    const WIDTH = 1011;
    const HEIGHT = 639;
    const GAP = 40;

    const canvas = createCanvas(WIDTH, HEIGHT * 2 + GAP);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ================= FRONT =================
    const frontTemplate = await loadImage(
      path.join(__dirname, '../../Public/business-1.jpeg')
    );
    ctx.drawImage(frontTemplate, 0, 0, WIDTH, HEIGHT);

    // 🖼️ Business Logo
    if (business.businessLogo) {
      const imgRes = await axios.get(business.businessLogo, {
        responseType: 'arraybuffer'
      });
      const logo = await loadImage(imgRes.data);
      ctx.drawImage(logo, 40, 200, 240, 240);
    }

    ctx.fillStyle = '#000';
    ctx.font = '26px Georgia';

    // 🔥 Text Wrapping Helper Function
    const wrapTextMultiLine = (text, x, startY, maxWidth, lineHeight) => {
      if (!text || text === 'N/A') {
        ctx.fillText(text || 'N/A', x, startY);
        return startY + lineHeight;
      }

      const words = text.split(' ');
      let line = '';
      let y = startY;

      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;

        if (testWidth > maxWidth && i > 0) {
          ctx.fillText(line.trim(), x, y);
          line = words[i] + ' ';
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line.trim(), x, y);
      return y + lineHeight;
    };

    // 🔥 Business Name with Wrapping (max 2 lines)
    let currentY = 245;
    currentY = wrapTextMultiLine(
      business.businessName || 'N/A',
      720,
      currentY,
      280, // max width for business name
      32   // line height
    );

    // Owner Name
    ctx.fillText(business.ownerName || 'N/A', 720, currentY + 0);
    
    // City
    ctx.fillText(business.location?.city || 'N/A', 720, currentY + 45);
    
    // Contact Person
    ctx.fillText(business.contactPerson || 'N/A', 720, currentY + 90);
    
    // Email (at fixed position)
    ctx.fillText(business.email || 'N/A', 580, 580);

    // ✅ VERIFIED BADGE (only if approved)
    if (business.applicationStatus === 'approved' && business.status === 'active') {
      ctx.fillStyle = '#2ECC71';
      ctx.font = 'bold 28px Georgia';
      ctx.fillText('✔ VERIFIED BUSINESS', 680, 190);
    }

    // ================= BACK =================
    const backTemplate = await loadImage(
      path.join(__dirname, '../../Public/business-2.jpeg')
    );
    ctx.drawImage(backTemplate, 0, HEIGHT + GAP, WIDTH, HEIGHT);

    ctx.fillStyle = '#fff';
    ctx.font = '26px Georgia';

    let yPos = HEIGHT + 245;
    const xPos = 320;
    const maxWidth = 500;

    const addressText = `
${business.location?.address || ''}
${business.location?.city || ''}, ${business.location?.district || ''}
${business.location?.state || ''}
`.trim();

    // 🔥 Address Text Wrapping
    const wrapText = (text) => {
      const words = text.split(' ');
      let line = '';
      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        if (ctx.measureText(testLine).width > maxWidth) {
          ctx.fillText(line, xPos, yPos);
          line = words[i] + ' ';
          yPos += 38;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, xPos, yPos);
    };

    wrapText(addressText);

    // 🆔 Business Code
    ctx.font = 'bold 30px Georgia';
    ctx.fillText(
      business.businessCode || 'N/A',
      320,
      HEIGHT * 2 - 145
    );

    // ================= QR CODE =================
    const qrUrl = `https://jainprabhudh-manch-backend.onrender.com/api/vyapar/generate-card/verify/business/${business.businessCode}`;
    const qrDataURL = await QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: 'H'
    });

    const qrImage = await loadImage(qrDataURL);
    ctx.drawImage(qrImage, 760, HEIGHT + 260, 180, 180);

    // 🔥 Add Headers for Better Compatibility
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    canvas.createJPEGStream({ quality: 0.95 }).pipe(res);

  } catch (error) {
    console.error('❌ Business card error:', error);
    res.status(500).json({ message: 'Failed to generate business card' });
  }
};

module.exports = { generateBusinessCard };