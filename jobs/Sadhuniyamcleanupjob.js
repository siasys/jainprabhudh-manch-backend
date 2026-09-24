const SadhuNiyam = require("../model/SadhuModels/Sadhuniyammodel");
const { s3Client, DeleteObjectCommand } = require("../config/s3Config");
const { extractS3KeyFromUrl } = require("../utils/s3Utils");

const RETENTION_DAYS = 15;

const cleanupOldNiyam = async () => {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const oldNiyam = await SadhuNiyam.find({
      niyamDate: { $lt: cutoff },
      isPinned: { $ne: true },
    }).select("_id mediaUrl");

    if (oldNiyam.length === 0) {
      return;
    }

    const ids = [];
    let mediaDeleted = 0;

    for (const niyam of oldNiyam) {
      ids.push(niyam._id);

      if (!niyam.mediaUrl) continue;

      // CloudFront URL se bhi key nikal aati hai — pathname hi key hoti hai
      const key = extractS3KeyFromUrl(niyam.mediaUrl);
      if (!key) continue;

      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
          }),
        );
        mediaDeleted += 1;
      } catch (s3Err) {
        // S3 fail ho to bhi DB record hata dete hain, warna har din
        // wahi record dobara try hota rahega
        console.error("Niyam S3 delete failed:", key, s3Err.message);
      }
    }

    await SadhuNiyam.deleteMany({ _id: { $in: ids } });

    console.log(
      `Niyam cleanup: deleted ${ids.length} records and ${mediaDeleted} media files`,
    );
  } catch (error) {
    console.error("Niyam cleanup job failed:", error);
  }
};

/**
 * Din me ek baar chalta hai. Story cleanup ka hi pattern —
 * startup pe ek baar, phir 24 ghante ke interval pe.
 */
const scheduleNiyamCleanup = () => {
  // Startup pe ek baar
  cleanupOldNiyam();

  // Phir har 24 ghante
  setInterval(cleanupOldNiyam, 24 * 60 * 60 * 1000);

  console.log("Sadhu niyam cleanup job scheduled");
};

module.exports = {
  scheduleNiyamCleanup,
  cleanupOldNiyam,
};
