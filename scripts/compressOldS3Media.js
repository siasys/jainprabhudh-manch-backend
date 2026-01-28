const { s3Client } = require('../config/s3Config');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { extractS3KeyFromUrl } = require('../utils/s3Utils');
const { compressImage, compressVideo, compressPDF } = require('../middlewares/upload');

const streamToBuffer = async (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
};

const compressAndOverwrite = async (fileUrl) => {
  const key = extractS3KeyFromUrl(fileUrl);
  if (!key) return;

  console.log('🔄 Processing:', key);

  const data = await s3Client.send(
    new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key
    })
  );

  const buffer = await streamToBuffer(data.Body);
  const contentType = data.ContentType;

  let finalBuffer = buffer;

  if (contentType?.startsWith('image/')) {
    finalBuffer = await compressImage(buffer);
  } 
  else if (contentType?.startsWith('video/')) {
    finalBuffer = await compressVideo(buffer);
  } 
  else if (contentType === 'application/pdf') {
    finalBuffer = await compressPDF(buffer);
  } 
  else {
    console.log('⏭ Skipped:', contentType);
    return;
  }

  if (finalBuffer.length >= buffer.length) {
    console.log('⚠️ No compression benefit, skipped');
    return;
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: finalBuffer,
      ContentType: contentType
    })
  );

  console.log('✅ Overwritten with compressed file:', key);
};

module.exports = { compressAndOverwrite };
