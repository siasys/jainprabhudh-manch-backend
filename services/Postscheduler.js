// services/postScheduler.js
// ⏰ Har 1 minute me run karta hai — due scheduled posts ko "published" mark karta hai
// aur tag/collab notifications fire karta hai (jo create ke waqt skip kiye the).
//
// USAGE: apne app.js / server.js me ye add karo (app boot ke baad):
//   const { startPostScheduler } = require("./services/postScheduler");
//   startPostScheduler();

const Post = require("../model/SocialMediaModels/postModel");
const Notification = require("../model/SocialMediaModels/notificationModel");

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
let intervalHandle = null;
let isRunning = false; // overlap prevent karne ke liye

async function processDuePosts() {
  if (isRunning) return; // agar pichhla cycle abhi bhi chal raha hai to skip
  isRunning = true;
  try {
    const now = new Date();

    // Due scheduled posts — 2 tarike identify karte hain (double safety):
    // 1. status="scheduled" AND scheduledAt <= now  (ideal case)
    // 2. scheduledAt <= now AND status abhi bhi "published" nahi hui + notif nahi gayi
    // Simplest: dono conditions ka $or lekin sirf agar scheduledAt hai
    const duePosts = await Post.find({
      $and: [
        { scheduledAt: { $ne: null, $lte: now } },
        {
          $or: [
            { status: "scheduled" },
            { status: { $exists: false } }, // legacy safety
          ],
        },
      ],
    }).setOptions({ includeScheduled: true });

    if (!duePosts || duePosts.length === 0) {
      isRunning = false;
      return;
    }

    console.log(
      `⏰ [postScheduler] ${duePosts.length} scheduled post(s) due, publishing...`,
    );

    for (const post of duePosts) {
      try {
        // Publish karo
        post.status = "published";
        // scheduledAt ko rakhne me kuch nahi bigadta — history rehti hai
        await post.save();

        // Tag notifications
        if (Array.isArray(post.taggedUsers) && post.taggedUsers.length > 0) {
          post.taggedUsers.forEach((tuId) => {
            Notification.create({
              senderId: post.user,
              receiverId: tuId,
              type: "tag",
              postId: post._id,
              message: "tagged you in a post",
            }).catch((err) =>
              console.log(
                "⚠️ [scheduler] tag notif failed:",
                tuId?.toString(),
                err.message,
              ),
            );
          });
        }

        // Collaborator invite notifications
        if (
          Array.isArray(post.collaborators) &&
          post.collaborators.length > 0
        ) {
          post.collaborators.forEach((c) => {
            if (!c || !c.user) return;
            // sirf pending collabs ko notif (accepted/rejected pehle se responded hain)
            if (c.status && c.status !== "pending") return;
            Notification.create({
              senderId: post.user,
              receiverId: c.user,
              type: "collaborator_invite",
              postId: post._id,
              message: "invited you to collaborate on a post",
            }).catch((err) =>
              console.log(
                "⚠️ [scheduler] collab notif failed:",
                c.user?.toString(),
                err.message,
              ),
            );
          });
        }

        console.log(`✅ [postScheduler] published post ${post._id}`);
      } catch (innerErr) {
        console.error(
          `❌ [postScheduler] failed to publish post ${post._id}:`,
          innerErr.message,
        );
      }
    }
  } catch (err) {
    console.error("❌ [postScheduler] cycle failed:", err.message);
  } finally {
    isRunning = false;
  }
}

function startPostScheduler() {
  if (intervalHandle) {
    console.log("⏰ [postScheduler] already running");
    return;
  }
  console.log("⏰ [postScheduler] starting — checking every 60s");
  // First run after 5s (thoda buffer server boot ke liye)
  setTimeout(processDuePosts, 5000);
  intervalHandle = setInterval(processDuePosts, CHECK_INTERVAL_MS);
}

function stopPostScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("⏰ [postScheduler] stopped");
  }
}

module.exports = { startPostScheduler, stopPostScheduler };
