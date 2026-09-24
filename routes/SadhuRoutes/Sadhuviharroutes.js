const express = require("express");
const router = express.Router();

const {
  addSadhuVihar,
  getSadhuViharList,
  getSadhuCurrentVihar,
  updateSadhuVihar,
  setCurrentVihar,
  deleteSadhuVihar,
} = require("../../controller/SadhuControllers/Sadhuviharcontroller");

const { authMiddleware } = require("../../middlewares/authMiddlewares");

// Public — timeline aur current location sabko dikhega
router.get("/:sadhuId", getSadhuViharList);
router.get("/current/:sadhuId", getSadhuCurrentVihar);

// Protected — sirf logged-in user
router.use(authMiddleware);

router.post("/:sadhuId", addSadhuVihar);
router.put("/entry/:viharId", updateSadhuVihar);
router.put("/set-current/:viharId", setCurrentVihar);
router.delete("/entry/:viharId", deleteSadhuVihar);

module.exports = router;
