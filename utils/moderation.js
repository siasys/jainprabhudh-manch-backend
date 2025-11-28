// utils/moderation.js
const sightengineClient = require('./sightengineClient');
const axios = require("axios");
const FormData = require("form-data");
const data = new FormData();
const fs = require("fs");

// Sightengine credentials
const API_USER = '663573471';
const API_SECRET = 'ae5xJfC2YhuxfK6wusLbHX3TpPszEY6a';
const WORKFLOW_ID = 'wfl_jEI1qZ5CEKU8DH49VRKVs';
const VIDEO_WORKFLOW_ID = 'wfl_jEIDigwSG9Pcjb96Rf5aj'; 
// ----------------------------------------------------
// TEXT MODERATION (SAFE + COMPLETE)
// ----------------------------------------------------
async function moderateText(text) {
  try {
    const response = await axios.get(
      "https://api.sightengine.com/1.0/text/check.json",
      {
        params: {
          text: text,
          lang: "en",
          mode: "standard",        // safest mode
          api_user: process.env.SIGHTENGINE_USER,
          api_secret: process.env.SIGHTENGINE_SECRET,
        },
      }
    );

    const data = response.data;

    // -----------------------------
    // Categories SightEngine returns:
    // profanity, personal, disallowed, link, drug,
    // weapon, violence, hate, sexual, self-harm, etc.
    // -----------------------------

    const unsafeCategories = [
      "profanity",
      "personal",
      "disallowed",
      "drug",
      "weapon",
      "violence",
      "hate",
      "sexual",
      "extremism",
      "self-harm"
    ];

    for (const category of unsafeCategories) {
      if (data[category]?.matches?.length > 0) {
        console.log("❌ Unsafe detected in:", category, data[category].matches);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("❌ Text moderation error:", error.response?.data || error.message);
    return false; // Block if API fails
  }
}


// ----------------------------------------------------
// IMAGE MODERATION
// ----------------------------------------------------
async function moderateImage(imageUrl) {
  try {
    const response = await axios.get(
      "https://api.sightengine.com/1.0/check-workflow.json",
      {
        params: {
          url: imageUrl,
          workflow: WORKFLOW_ID,
          api_user: API_USER,
          api_secret: API_SECRET,
        },
      }
    );

    const result = response.data;

    // ❌ Workflow failed
    if (result.status !== "success") return false;

    // ❌ MOST IMPORTANT FIELD: reject signal
    if (result?.summary?.action === "reject") {
      console.log("❌ IMAGE REJECTED:", result.summary);
      return false;
    }

    return true; // Safe
  } catch (error) {
    console.log("❌ Image moderation error:", error.response?.data || error.message);
    return false;
  }
}


async function moderateVideo(videoUrl) {
  try {
    const response = await axios.get(
      'https://api.sightengine.com/1.0/video/check-workflow-sync.json',
      {
        params: {
          stream_url: videoUrl,       // <-- public CDN URL
          workflow: VIDEO_WORKFLOW_ID,
          api_user: API_USER,
          api_secret: API_SECRET
        }
      }
    );

    const result = response.data;
    console.log("Video moderation result:", result);

    if (result.status !== 'success') return false;
    if (result.summary?.action === 'reject') {
      console.log("❌ VIDEO REJECTED:", result.summary.reject_reason);
      return false;
    }

    return true; // Safe
  } catch (error) {
    console.error("❌ Video moderation error:", error.response?.data || error.message);
    return false;
  }
}


module.exports = {
  moderateText,
  moderateImage,
  moderateVideo,
};
