const express = require("express");
const {
  getDay,
  getMonth,
  getUpcoming,
  createEvent,
  listEvents,
  updateEvent,
  deleteEvent,
} = require("../../controller/Panchang/panchangController");

const router = express.Router();

// ─── Public (app + web) ───
router.get("/day", getDay);
router.get("/month", getMonth);
router.get("/upcoming", getUpcoming);

// ─── Admin / trust ke apne parv ───
router.get("/events", listEvents);
router.post("/event", createEvent);
router.put("/event/:id", updateEvent);
router.delete("/event/:id", deleteEvent);

module.exports = router;
