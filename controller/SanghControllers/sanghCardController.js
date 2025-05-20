const { createCanvas, loadImage } = require('canvas');
const HierarchicalSangh = require('../../model/SanghModels/hierarchicalSanghModel');
const path = require('path');
const fs = require('fs');

const generateMemberCard = async (req, res) => {
    try {
        const { userId } = req.params;
        const member = await HierarchicalSangh.findOne({ user: userId });

        if (!member) {
            return res.status(404).json({ message: 'Member not found' });
        }

        const width = 1011, height = 639;
        const canvas = createCanvas(width, height * 2); // Front + Back
        const ctx = canvas.getContext('2d');

        // === FRONT SIDE ===
        const frontImg = await loadImage(path.join(__dirname, '../Public/member_front.jpeg'));
        ctx.drawImage(frontImg, 0, 0, width, height);

        ctx.fillStyle = 'black';
        ctx.font = '28px Georgia';

        ctx.fillText(member.name || 'N/A', 60, 180);
        ctx.fillText(`Membership No: ${member.membershipNumber || 'N/A'}`, 60, 230);
        ctx.fillText(`Shravak No: ${member.shravakNumber || 'N/A'}`, 60, 280);
        ctx.fillText(`Designation: ${member.designation || 'N/A'}`, 60, 330);
        ctx.font = 'bold 28px Georgia';
        ctx.fillText(`Member: Jain Prabuddh Manch`, 60, 380);

        // === BACK SIDE ===
        const backImg = await loadImage(path.join(__dirname, '../Public/member_back.jpeg'));
        ctx.drawImage(backImg, 0, height, width, height);

        ctx.font = '26px Georgia';
        const addressLine1 = member.address?.street || 'N/A';
        const addressLine2 = `${member.address?.city || 'N/A'}, ${member.address?.pincode || ''}`;

        ctx.fillText(addressLine1, 60, height + 180);
        ctx.fillText(addressLine2, 60, height + 220);

        res.setHeader('Content-Type', 'image/jpeg');
        canvas.createJPEGStream().pipe(res);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Card generation failed', error: error.message });
    }
};

module.exports = { generateMemberCard };
