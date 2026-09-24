const express = require("express");
const router = express.Router();

const {
  addSadhuNiyam,
  getSadhuNiyamList,
  getTodaySadhuNiyam,
  updateSadhuNiyam,
  pinSadhuNiyam,
  incrementNiyamView,
  deleteSadhuNiyam,
  // ── NEW ──
  takeSadhuNiyam,
  untakeSadhuNiyam,
  getNiyamTakers,
} = require("../../controller/SadhuControllers/Sadhuniyamcontroller");

const { authMiddleware } = require("../../middlewares/authMiddlewares");
const upload = require("../../middlewares/upload");

/* ── Public ──
   Timeline aur aaj ka niyam sabko dikhega.
   NOTE: "/today/:sadhuId" ko "/:sadhuId" se PEHLE rakhna zaroori hai,
   warna Express "today" ko sadhuId samajh lega. */
router.get("/today/:sadhuId", getTodaySadhuNiyam);
router.get("/:sadhuId", getSadhuNiyamList);

// View count — bina login ke bhi ginna hai
router.put("/view/:niyamId", incrementNiyamView);

// ── NEW: kis-kis ne niyam liya — sadhu ke manage screen ke liye ──
router.get("/takers/:niyamId", getNiyamTakers);

/* ── Protected ── */
router.use(authMiddleware);

router.post("/:sadhuId", upload.sadhuNiyamMedia, addSadhuNiyam);
router.put("/entry/:niyamId", upload.sadhuNiyamMedia, updateSadhuNiyam);
router.put("/pin/:niyamId", pinSadhuNiyam);

// ── NEW: shravak niyam le / wapas le ──
router.post("/take/:niyamId", takeSadhuNiyam);
router.delete("/take/:niyamId", untakeSadhuNiyam);
router.delete("/entry/:niyamId", deleteSadhuNiyam);

module.exports = router;
