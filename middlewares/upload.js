const multer = require('multer');
const multerS3 = require('multer-s3');
const { s3Client } = require('../config/s3Config');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const os = require('os');

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
    fileSize: 50 * 1024 * 1024, // 50 MB maximum
    files: 10
  },
  fileFilter: fileFilter
});

// Image Compression
const compressImage = async (buffer, quality = 80) => {
  try {
    const originalSize = buffer.length;
    const compressed = await sharp(buffer)
      .resize(1920, 1920, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    
    const compressedSize = compressed.length;
    const savedSize = originalSize - compressedSize;
    const compressionRatio = ((savedSize / originalSize) * 100).toFixed(2);
    
    // console.log('📸 IMAGE COMPRESSION:');
    // console.log(`   Original Size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
    // console.log(`   Compressed Size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
    // console.log(`   Saved: ${(savedSize / 1024 / 1024).toFixed(2)} MB (${compressionRatio}% reduction)`);

    return compressed;
  } catch (error) {
    console.error('Image compression error:', error);
    return buffer; // Return original if compression fails
  }
};

// Video Compression
const compressVideo = async (inputBuffer) => {
  const tempInput = path.join(os.tmpdir(), `input-${Date.now()}.mp4`);
  const tempOutput = path.join(os.tmpdir(), `output-${Date.now()}.mp4`);

  try {
    const originalSize = inputBuffer.length;
    console.log('🎥 VIDEO COMPRESSION STARTED:');
    console.log(`   Original Size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
    
    // Write buffer to temp file
    await fs.writeFile(tempInput, inputBuffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInput)
        .outputOptions([
          '-c:v libx264',       // H.264 codec
          '-preset fast',       // Faster encoding
          '-crf 28',           // Higher CRF = more compression (23-28 is good)
          '-c:a aac',          // Audio codec
          '-b:a 128k',         // Audio bitrate
          '-movflags +faststart', // Web optimization
          '-vf scale=1280:-2'  // Scale to 720p, maintain aspect ratio
        ])
        .output(tempOutput)
        .on('end', async () => {
          try {
            const compressedBuffer = await fs.readFile(tempOutput);
            const compressedSize = compressedBuffer.length;
            const savedSize = originalSize - compressedSize;
            const compressionRatio = ((savedSize / originalSize) * 100).toFixed(2);
            
            console.log('✅ VIDEO COMPRESSION COMPLETED:');
            console.log(`   Compressed Size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
            console.log(`   Saved: ${(savedSize / 1024 / 1024).toFixed(2)} MB (${compressionRatio}% reduction)`);
            
            // Cleanup
            await fs.unlink(tempInput).catch(() => {});
            await fs.unlink(tempOutput).catch(() => {});
            resolve(compressedBuffer);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', async (error) => {
          console.error('❌ VIDEO COMPRESSION FAILED:', error.message);
          // Cleanup on error
          await fs.unlink(tempInput).catch(() => {});
          await fs.unlink(tempOutput).catch(() => {});
          reject(error);
        })
        .run();
    });
  } catch (error) {
    console.error('⚠️ VIDEO COMPRESSION ERROR:', error.message);
    console.log('⚠️ FFmpeg not found! Uploading original video without compression.');
    console.log('⚠️ Please install FFmpeg to enable video compression.');
    // Cleanup on error
    await fs.unlink(tempInput).catch(() => {});
    await fs.unlink(tempOutput).catch(() => {});
    return inputBuffer; // Return original if compression fails
  }
};

// PDF Compression
const compressPDF = async (buffer) => {
  try {
    const originalSize = buffer.length;
    console.log('📄 PDF COMPRESSION STARTED:');
    console.log(`   Original Size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
    
    const pdfDoc = await PDFDocument.load(buffer);
    
    // Remove metadata to reduce size
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer('');
    pdfDoc.setCreator('');

    // Save with compression
    const compressedPdf = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 50
    });

    const compressedBuffer = Buffer.from(compressedPdf);
    const compressedSize = compressedBuffer.length;
    const savedSize = originalSize - compressedSize;
    const compressionRatio = ((savedSize / originalSize) * 100).toFixed(2);
    
    console.log('✅ PDF COMPRESSION COMPLETED:');
    console.log(`   Compressed Size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Saved: ${(savedSize / 1024 / 1024).toFixed(2)} MB (${compressionRatio}% reduction)`);
    
    return compressedBuffer;
  } catch (error) {
    console.error('❌ PDF COMPRESSION FAILED:', error.message);
    return buffer; // Return original if compression fails
  }
};

// Universal compression middleware
const compressFiles = async (req, res, next) => {
  try {
    console.log('\n🔄 ========== FILE COMPRESSION STARTED ==========');
    
    // Handle single file
    if (req.file) {
      const mimetype = req.file.mimetype;
      console.log(`📁 Processing single file: ${req.file.originalname} (${req.file.fieldname})`);
      
      if (mimetype.startsWith('image/')) {
        req.file.buffer = await compressImage(req.file.buffer);
      } else if (mimetype.startsWith('video/')) {
        req.file.buffer = await compressVideo(req.file.buffer);
      } else if (mimetype === 'application/pdf') {
        req.file.buffer = await compressPDF(req.file.buffer);
      }
    }

    // Handle multiple files (req.files as array)
    if (req.files && Array.isArray(req.files)) {
      console.log(`📁 Processing ${req.files.length} files (array)`);
      
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const mimetype = file.mimetype;
        console.log(`\n   File ${i + 1}/${req.files.length}: ${file.originalname}`);
        
        if (mimetype.startsWith('image/')) {
          file.buffer = await compressImage(file.buffer);
        } else if (mimetype.startsWith('video/')) {
          file.buffer = await compressVideo(file.buffer);
        } else if (mimetype === 'application/pdf') {
          file.buffer = await compressPDF(file.buffer);
        }
      }
    }

    // Handle multiple files (req.files as object with fieldnames)
    if (req.files && typeof req.files === 'object' && !Array.isArray(req.files)) {
      const totalFiles = Object.values(req.files).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`📁 Processing ${totalFiles} files (fields)`);
      
      let fileCounter = 0;
      for (let fieldname in req.files) {
        const filesArray = req.files[fieldname];
        
        for (let file of filesArray) {
          fileCounter++;
          const mimetype = file.mimetype;
          console.log(`\n   File ${fileCounter}/${totalFiles}: ${file.originalname} (${fieldname})`);
          
          if (mimetype.startsWith('image/')) {
            file.buffer = await compressImage(file.buffer);
          } else if (mimetype.startsWith('video/')) {
            file.buffer = await compressVideo(file.buffer);
          } else if (mimetype === 'application/pdf') {
            file.buffer = await compressPDF(file.buffer);
          }
        }
      }
    }

    console.log('✅ ========== FILE COMPRESSION COMPLETED ==========\n');
    next();
  } catch (error) {
    console.error('❌ COMPRESSION MIDDLEWARE ERROR:', error);
    next(); // Continue even if compression fails
  }
};

// Upload to S3 after compression
const uploadToS3 = async (req, res, next) => {
  const { PutObjectCommand } = require('../config/s3Config');
  
  try {
    // Handle single file
    if (req.file) {
      const folder = getS3Folder(req.file.fieldname, req);
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const filename = uniqueSuffix + path.extname(req.file.originalname);
      const key = folder + filename;

      const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
      };

      await s3Client.send(new PutObjectCommand(uploadParams));
      
      req.file.location = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
      req.file.key = key;
    }

    // Handle multiple files (array)
    if (req.files && Array.isArray(req.files)) {
      for (let file of req.files) {
        const folder = getS3Folder(file.fieldname, req);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = uniqueSuffix + path.extname(file.originalname);
        const key = folder + filename;

        const uploadParams = {
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype
        };

        await s3Client.send(new PutObjectCommand(uploadParams));
        
        file.location = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
        file.key = key;
      }
    }

    // Handle multiple files (object)
    if (req.files && typeof req.files === 'object' && !Array.isArray(req.files)) {
      for (let fieldname in req.files) {
        const filesArray = req.files[fieldname];
        
        for (let file of filesArray) {
          const folder = getS3Folder(file.fieldname, req);
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          const filename = uniqueSuffix + path.extname(file.originalname);
          const key = folder + filename;

          const uploadParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype
          };

          await s3Client.send(new PutObjectCommand(uploadParams));
          
          file.location = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
          file.key = key;
        }
      }
    }

    next();
  } catch (error) {
    console.error('S3 upload error:', error);
    return res.status(500).json({ error: 'File upload failed' });
  }
};

// Error handling middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum is 10 files.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
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