const multer = require('multer');
const sharp = require('sharp');
const { s3Client, PutObjectCommand } = require('../config/s3Config');

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const compressImage = async (req, res, next) => {
  if (!req.file || !req.file.mimetype.startsWith('image/')) return next();

  req.file.buffer = await sharp(req.file.buffer)
    .resize({ width: 1080 })
    .jpeg({ quality: 70 })
    .toBuffer();

  req.file.mimetype = 'image/jpeg';
  next();
};

const uploadImageToS3 = async (req, res, next) => {
  if (!req.file) return next();

  const key = `posts/images/${Date.now()}-${Math.random()
    .toString(36)
    .substring(7)}.jpg`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: 'image/jpeg',
    })
  );

  req.file.location = `https://${process.env.CLOUDFRONT_DOMAIN}/${key}`;
  next();
};

module.exports = {
  uploadImage,
  compressImage,
  uploadImageToS3,
};
