// routes/appVersion.js
const express = require('express');
const router = express.Router();

router.get('/version', (req, res) => {
  res.json({
    latestVersion: "1.2.0",
   apkUrl: "https://jainprabhudh-manch-backend.onrender.com/static/latest.apk"
     //apkUrl: "http://192.168.1.3:4000/api/static/latest.apk"
  });
});

module.exports = router;
