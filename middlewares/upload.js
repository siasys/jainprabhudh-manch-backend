const multer = require('multer');
const multerS3 = require('multer-s3');
const { s3Client,PutObjectCommand} = require('../config/s3Config');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const os = require('os');

sharp.cache(false);
// Set FFmpeg path from npm package
try {
  const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
  ffmpeg.setFfmpegPath(ffmpegPath);
 // console.log('✅ FFmpeg loaded from:', ffmpegPath);
} catch (error) {
  console.warn('⚠️ @ffmpeg-installer/ffmpeg not found. Video compression may not work.');
  // console.warn('   Install it with: npm install @ffmpeg-installer/ffmpeg');
}

// File type validation
const allowedTypes = new Set([
  'image/jpeg',
  'image/jpg', 
  'image/png',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/x-m4a',
  'audio/flac'
]);

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'groupIcon') {
    if (['image/jpeg', 'image/png'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG files are allowed for group icons'));
    }
    return;
  }
  if (allowedTypes.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
};

// Determine folder based on file field name
const getS3Folder = (fieldname, req) => {
  switch(fieldname) {
    case 'profilePicture':
      return 'profile-pictures/';
    case 'coverPicture':
      return 'cover-pictures/';
    case 'bailorImage':
      return 'bailors/images/';
    case 'jainPrathibha':
      return 'jainPrathibha/images/';
    case 'jainHostal':
      return 'jainHostal/images/';
    case 'jainFood':
      return 'jainFood/images/';
    case 'aadharCard':
      return 'documents/aadhar-cards/';
    case 'userProfile':
      return 'documents/user-profiles/';
    case 'chatImage':
      return 'chat-media/images/';
    case 'groupImage':
      return 'groups/images/';
    case 'image':
      return 'posts/images/';
    case 'video':
      return 'posts/videos/';
    case 'media':
      if (req && req.baseUrl) {
        if (req.baseUrl.includes('sangh-posts')) {
          return 'sanghs/posts/media/';
        } else if (req.baseUrl.includes('panch-posts')) {
          return 'panch/posts/media/';
        } else if (req.baseUrl.includes('tirth-posts')) {
          return 'tirth/posts/media/';
        } else if (req.baseUrl.includes('vyapar/posts')) {
          return 'vyapar/posts/media/';
        }
      }
      return 'stories/';
    case 'presidentJainAadhar':
      return 'sangathan/documents/president/';
    case 'secretaryJainAadhar':
      return 'sangathan/documents/secretary/';
    case 'treasurerJainAadhar':
      return 'sangathan/documents/treasurer/';
    case 'presidentPhoto':
      return 'sangathan/photos/president/';
    case 'secretaryPhoto':
      return 'sangathan/photos/secretary/';
    case 'treasurerPhoto':
      return 'sangathan/photos/treasurer/';
    case 'jainAadharPhoto':
      return 'sangathan/panch/documents/';
    case 'profilePhoto':
      return 'sangathan/panch/photos/';
    case 'memberPhoto':
      return 'sangathan/members/photos/';
    case 'sanghImage':
      return 'sangathan/photos/';
    case 'coverImage':
      return 'sangathan/photos/';
    case 'biodataImage':
      return 'biodata/images/'
    case 'jobPost':
      return 'jobs/posts/';
    case 'candidateResume':
      return 'resumeUploads/';
    case 'jainItihas':
      return 'jainItihas/image/';
    case 'jainGranth':
      return 'jainGranth/';
    case 'govtYojana':
      return 'govtYojana/image/';
    case 'tirthPhoto':
      return 'tirth/photos/';
    case 'tirthDocument':
      return 'tirth/documents/';
    case 'businessPhotos':
      return 'vyapar/photos/';
    case 'businessDocuments':
      return 'vyapar/documents/';
    case 'uploadImage':
      return 'sadhu/profile-images/';
    case 'documents':
      return 'sadhu/documents/';
    case 'uploadActivity':
      return 'activity/uploads/';
    case 'entityPhoto':
      if (req && req.baseUrl) {
        if (req.baseUrl.includes('sadhu')) {
          return 'sadhu/photos/';
        } else if (req.baseUrl.includes('tirth')) {
          return 'tirth/photos/';
        } else if (req.baseUrl.includes('vyapar')) {
          return 'vyapar/photos/';
        }
      }
      return 'others/';
    case 'entityDocuments':
      if (req && req.baseUrl) {
        if (req.baseUrl.includes('sadhu')) {
          return 'sadhu/documents/';
        } else if (req.baseUrl.includes('tirth')) {
          return 'tirth/documents/';
        } else if (req.baseUrl.includes('vyapar')) {
          return 'vyapar/documents/';
        }
      }
      return 'others/';
    case 'audio':
      return 'music/';
    default:
      return 'others/';
  }
};

// Memory storage for compression processing
const upload = multer({
  storage: multer.memoryStorage(), // Changed to memory storage for compression
  limits: {
    fileSize: 20 * 1024 * 1024, // 50 MB maximum
    files: 10
  },
  fileFilter: fileFilter
});

// Image Compression Optimized
const compressImage = async (buffer) => {
  try {
    return await sharp(buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70, mozjpeg: true }) // Quality slightly reduced to save major RAM
      .toBuffer();
  } catch (error) {
    console.error('Image compression error:', error);
    return buffer;
  }
};

const compressVideo = async (inputBuffer) => {
  const tempInput = path.join(os.tmpdir(), `temp-in-${Date.now()}.mp4`);
  const tempOutput = path.join(os.tmpdir(), `temp-out-${Date.now()}.mp4`);

  try {
    // 1. Buffer ko disk par write karein (RAM bachane ke liye)
    await fs.writeFile(tempInput, inputBuffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .outputOptions([
          '-vcodec libx264',
          '-crf 28',            // Higher = smaller size (23-28 is sweet spot)
          '-preset superfast',  // Render ke slow CPU ke liye fast preset zaroori hai
          '-movflags +faststart',
          '-vf scale=w=720:h=-2', // Max 720p height, aspect ratio maintain
          '-maxrate 1M',        // Bitrate control
          '-bufsize 2M'
        ])
        .output(tempOutput)
        .on('end', async () => {
          try {
            const result = await fs.readFile(tempOutput);
            // Cleanup files immediately
            await Promise.all([fs.unlink(tempInput), fs.unlink(tempOutput)]);
            resolve(result);
          } catch (e) { reject(e); }
        })
        .on('error', async (err) => {
          console.error('FFmpeg Error:', err.message);
          await fs.unlink(tempInput).catch(() => {});
          resolve(inputBuffer); // Error par original upload hone dein
        })
        .run();
    });
  } catch (error) {
    console.error('Video Compression Catch:', error);
    return inputBuffer;
  }
};
// PDF Compression Optimized
const compressPDF = async (buffer) => {
  try {
    const pdfDoc = await PDFDocument.load(buffer);
    const compressedPdf = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false
    });
    return Buffer.from(compressedPdf);
  } catch (error) {
    return buffer;
  }
};

// Universal Compression Middleware
const compressFiles = async (req, res, next) => {
  try {
    const processFile = async (file) => {
      if (!file.buffer) return;

      if (file.mimetype.startsWith('image/')) {
        file.buffer = await compressImage(file.buffer);
      } 
      else if (file.mimetype.startsWith('video/')) {
        // Video compression tabhi karein agar file 5MB se badi ho
        if (file.size > 5 * 1024 * 1024) {
           file.buffer = await compressVideo(file.buffer);
        }
      } 
      else if (file.mimetype === 'application/pdf') {
        file.buffer = await compressPDF(file.buffer);
      }
    };

    // Single File
    if (req.file) await processFile(req.file);

    // Multiple Files (Array or Fields)
    if (req.files) {
      const allFiles = Array.isArray(req.files) 
        ? req.files 
        : Object.values(req.files).flat();
      
      // Sequential processing (RAM control ke liye ek-ek karke)
      for (const file of allFiles) {
        await processFile(file);
      }
    }
    next();
  } catch (error) {
    console.error('Compression Middleware Error:', error);
    next();
  }
};
// Upload to S3 and CLEANUP
const uploadToS3 = async (req, res, next) => {
  try {
    const performUpload = async (file) => {
      const folder = getS3Folder(file.fieldname, req);
      const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
      const key = folder + filename;

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype
      }));

      file.location = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
      file.key = key;
      
      // CRITICAL: Clear buffer from memory after upload
      delete file.buffer; 
    };

    if (req.file) await performUpload(req.file);

    if (req.files) {
      const filesToUpload = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
      for (let file of filesToUpload) await performUpload(file);
    }

    next();
  } catch (error) {
    console.error('S3 Upload Error:', error);
    return res.status(500).json({ error: 'File upload failed' });
  }
};

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
};

// Export configurations with compression and S3 upload
module.exports = upload;
module.exports.handleMulterError = handleMulterError;
module.exports.compressFiles = compressFiles;
module.exports.uploadToS3 = uploadToS3;

// Specific upload configurations
module.exports.chatImageUpload = [upload.single('chatImage'), compressFiles, uploadToS3];
module.exports.jainAadharDocs = [upload.fields([
  { name: 'aadharCard', maxCount: 1 },
  { name: 'userProfile', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.storyUpload = [upload.array('media', 10), compressFiles, uploadToS3];
module.exports.postMediaUpload = [upload.fields([
  { name: 'image', maxCount: 10 },
  { name: 'video', maxCount: 10 },
  { name: 'image1', maxCount: 1 },
  { name: 'image2', maxCount: 1 },
  { name: 'image3', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.jobPostUpload = [upload.fields([
  { name: 'jobPost', maxCount: 10 },
  { name: 'jobPdf', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.donationUpload = [upload.fields([
  { name: 'paymentScreenshot', maxCount: 1 },
  { name: 'donationPhoto', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.candidateResumeUpload = [upload.fields([
  { name: 'candidateResume', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.jaintihasUpload = [upload.single('image'), compressFiles, uploadToS3];
module.exports.jainGranthUpload = [upload.fields([
  { name: 'jainGranth', maxCount: 1 },
  { name: 'jainGranthImage', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.trainingMaterialUpload = [upload.fields([
  { name: 'trainingPdf', maxCount: 5 },
  { name: 'trainingVideo', maxCount: 5 }
]), compressFiles, uploadToS3];
module.exports.govtYojanaUpload = [upload.single('file'), compressFiles, uploadToS3];
module.exports.certificateUpload = [upload.single('certificate'), compressFiles, uploadToS3];
module.exports.sangathanDocs = [upload.fields([
  { name: 'presidentJainAadhar', maxCount: 1 },
  { name: 'secretaryJainAadhar', maxCount: 1 },
  { name: 'treasurerJainAadhar', maxCount: 1 },
  { name: 'presidentPhoto', maxCount: 1 },
  { name: 'secretaryPhoto', maxCount: 1 },
  { name: 'treasurerPhoto', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 },
  { name: 'sanghImage', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.memberUploads = [upload.fields([
  { name: 'memberPhoto', maxCount: 1 },
  { name: 'memberScreenshot', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.boostUploads = [upload.fields([
  { name: 'paymentScreenshot', maxCount: 1 }
]), compressFiles, uploadToS3];

module.exports.panchGroupDocs = [upload.fields([
  { name: 'members[0].jainAadharPhoto', maxCount: 1 },
  { name: 'members[0].profilePhoto', maxCount: 1 },
  { name: 'members[1].jainAadharPhoto', maxCount: 1 },
  { name: 'members[1].profilePhoto', maxCount: 1 },
  { name: 'members[2].jainAadharPhoto', maxCount: 1 },
  { name: 'members[2].profilePhoto', maxCount: 1 },
  { name: 'members[3].jainAadharPhoto', maxCount: 1 },
  { name: 'members[3].profilePhoto', maxCount: 1 },
  { name: 'members[4].jainAadharPhoto', maxCount: 1 },
  { name: 'members[4].profilePhoto', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.biodataImageUpload = [upload.fields([
  { name: 'passportPhoto', maxCount: 1 },
  { name: 'fullPhoto', maxCount: 1 },
  { name: 'familyPhoto', maxCount: 1 },
  { name: 'healthCertificate', maxCount: 1 },
  { name: 'educationCertificate', maxCount: 1 },
  { name: 'paymentScreenshot', maxCount: 1 },
  { name: 'divorceCertificate', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.sadhuDocs = [upload.fields([
  { name: 'entityPhoto', maxCount: 5 },
  { name: 'entityDocuments', maxCount: 5 },
  { name: 'uploadImage', maxCount: 10 }
]), compressFiles, uploadToS3];
module.exports.tirthDocs = [upload.fields([
  { name: 'tirthPhoto', maxCount: 10 }
]), compressFiles, uploadToS3];
module.exports.expenseBillUpload = [upload.fields([
  { name: 'uploadBill', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.vyaparDocs = [upload.fields([
  { name: 'entityPhoto', maxCount: 5 },
  { name: 'businessLogo', maxCount: 1 },
  { name: 'entityDocuments', maxCount: 5 }
]), compressFiles, uploadToS3];
module.exports.uploadActivityFiles = [upload.fields([
  { name: 'uploadActivity', maxCount: 5 }
]), compressFiles, uploadToS3];
module.exports.scholarshipUpload = [upload.fields([
  { name: 'lastYearMarksheet', maxCount: 5 }
]), compressFiles, uploadToS3];
module.exports.sponsorUpload = [upload.fields([
  { name: 'sponserImage', maxCount: 1 }
]), compressFiles, uploadToS3];
module.exports.entityPostUpload = [upload.array('media', 10), compressFiles, uploadToS3];
module.exports.compressImage = compressImage;
module.exports.compressVideo = compressVideo;
module.exports.compressPDF = compressPDF;