const PanchangEvent = require("../../model/Panchang/PanchangEventModel");
const {
  DEFAULT_LAT,
  DEFAULT_LNG,
  toDateKey,
  parseDateKey,
  getDayPanchang,
  getMonthPanchang,
} = require("../../utils/jainPanchangCalc");

/* ───────────────────────── helpers ───────────────────────── */

const normTradition = (t) => {
  if (t === "Digambar" || t === "Shwetambar") return t;
  return "All";
};

const matchesTradition = (itemTradition, want) => {
  if (want === "All") return true;
  return itemTradition === "Both" || itemTradition === want;
};

const readCoords = (req) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  return {
    lat: isNaN(lat) ? DEFAULT_LAT : lat,
    lng: isNaN(lng) ? DEFAULT_LNG : lng,
  };
};

/**
 * DB events ko computed panchang ke saath merge karta hai.
 * Multi-day event (endDateKey) bhi cover hota hai.
 */
const mergeEvents = (dayList, events, tradition) => {
  const byDate = {};
  events.forEach((ev) => {
    if (!matchesTradition(ev.tradition, tradition)) return;
    const start = ev.dateKey;
    const end = ev.endDateKey || ev.dateKey;
    const s = parseDateKey(start);
    const e = parseDateKey(end);
    if (!s || !e) return;
    const cursor = new Date(s);
    while (cursor <= e) {
      const key = toDateKey(cursor);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(ev);
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return dayList.map((day) => {
    const dbEvents = byDate[day.date] || [];
    const hasOverride = dbEvents.some((e) => e.isOverride);

    const dbParv = dbEvents.map((e) => ({
      _id: e._id,
      title: e.title,
      tradition: e.tradition,
      panth: e.panth || "",
      type: e.type,
      description: e.description || "",
      imageUrl: e.imageUrl || null,
      isHoliday: !!e.isHoliday,
      source: "admin",
    }));

    // Override hone par computed parv chhupa dete hain
    const parv = hasOverride ? dbParv : [...dbParv, ...day.parv];

    // Tithi override (trust ka panchang final)
    const tithiOverride = dbEvents.find(
      (e) => e.overrideTithi && e.overrideTithi.tithiName,
    );

    const merged = { ...day, parv, isVratDay: parv.length > 0 };

    if (tithiOverride) {
      const o = tithiOverride.overrideTithi;
      merged.tithiName = o.tithiName || merged.tithiName;
      merged.tithiNum = o.tithiNum || merged.tithiNum;
      merged.paksh = o.paksh || merged.paksh;
      merged.masa = o.masa || merged.masa;
      merged.tithiSource = "admin";
    } else {
      merged.tithiSource = "computed";
    }

    return merged;
  });
};

/* ───────────────────────── public APIs ───────────────────────── */

/**
 * GET /panchang/day?date=YYYY-MM-DD&tradition=Digambar
 */
exports.getDay = async (req, res) => {
  try {
    const tradition = normTradition(req.query.tradition);
    const { lat, lng } = readCoords(req);

    const date = req.query.date ? parseDateKey(req.query.date) : new Date();
    if (!date) {
      return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD" });
    }

    const day = getDayPanchang(date, tradition, lat, lng);

    // Multi-day events bhi pakadne ke liye thoda wide window
    const from = new Date(date);
    from.setDate(from.getDate() - 20);
    const events = await PanchangEvent.find({
      isActive: true,
      dateKey: { $lte: toDateKey(date), $gte: toDateKey(from) },
    }).lean();

    const [merged] = mergeEvents([day], events, tradition);

    res.status(200).json({ success: true, data: merged });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

/**
 * GET /panchang/month?year=2026&month=8&tradition=Digambar
 */
exports.getMonth = async (req, res) => {
  try {
    const tradition = normTradition(req.query.tradition);
    const { lat, lng } = readCoords(req);

    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || now.getMonth() + 1;

    if (month < 1 || month > 12) {
      return res.status(400).json({ error: "month must be between 1 and 12" });
    }

    const days = getMonthPanchang(year, month, tradition, lat, lng);

    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const from = new Date(first);
    from.setDate(from.getDate() - 20);

    const events = await PanchangEvent.find({
      isActive: true,
      dateKey: { $gte: toDateKey(from), $lte: toDateKey(last) },
    }).lean();

    const merged = mergeEvents(days, events, tradition);

    res.status(200).json({
      success: true,
      year,
      month,
      tradition,
      data: merged,
    });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

/**
 * GET /panchang/upcoming?date=YYYY-MM-DD&days=60&limit=8&tradition=Digambar
 * Sirf parv wale din return karta hai (rozana vrat chhod ke).
 */
exports.getUpcoming = async (req, res) => {
  try {
    const tradition = normTradition(req.query.tradition);
    const { lat, lng } = readCoords(req);

    const start = req.query.date ? parseDateKey(req.query.date) : new Date();
    if (!start) {
      return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD" });
    }

    const span = Math.min(parseInt(req.query.days, 10) || 90, 366);
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 50);
    const includeVrat = req.query.includeVrat === "true";

    const dayList = [];
    for (let i = 1; i <= span; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dayList.push(getDayPanchang(d, tradition, lat, lng));
    }

    const from = new Date(start);
    from.setDate(from.getDate() - 20);
    const to = new Date(start);
    to.setDate(to.getDate() + span);

    const events = await PanchangEvent.find({
      isActive: true,
      dateKey: { $gte: toDateKey(from), $lte: toDateKey(to) },
    }).lean();

    const merged = mergeEvents(dayList, events, tradition);

    const result = merged
      .map((day) => ({
        ...day,
        parv: includeVrat
          ? day.parv
          : day.parv.filter((p) => p.type !== "vrat"),
      }))
      .filter((day) => day.parv.length > 0)
      .slice(0, limit);

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

/* ───────────────────────── admin APIs ───────────────────────── */

/**
 * POST /panchang/event
 */
exports.createEvent = async (req, res) => {
  try {
    const {
      dateKey,
      endDateKey,
      title,
      description,
      tradition,
      panth,
      type,
      isOverride,
      overrideTithi,
      imageUrl,
      isHoliday,
      createdBy,
    } = req.body;

    if (!dateKey || !title) {
      return res.status(400).json({ error: "dateKey and title are required!" });
    }
    const parsed = parseDateKey(dateKey);
    if (!parsed) {
      return res.status(400).json({ error: "dateKey must be YYYY-MM-DD" });
    }
    if (endDateKey && !parseDateKey(endDateKey)) {
      return res.status(400).json({ error: "endDateKey must be YYYY-MM-DD" });
    }

    const event = new PanchangEvent({
      dateKey,
      date: parsed,
      endDateKey: endDateKey || null,
      title,
      description,
      tradition: tradition || "Both",
      panth: panth || "",
      type: type || "parv",
      isOverride: !!isOverride,
      overrideTithi: overrideTithi || {},
      imageUrl,
      isHoliday: !!isHoliday,
      createdBy,
    });

    await event.save();
    res.status(201).json({ message: "Panchang event created!", event });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

/**
 * GET /panchang/events?from=&to=&tradition=
 */
exports.listEvents = async (req, res) => {
  try {
    const query = { isActive: true };
    if (req.query.from || req.query.to) {
      query.dateKey = {};
      if (req.query.from) query.dateKey.$gte = req.query.from;
      if (req.query.to) query.dateKey.$lte = req.query.to;
    }
    if (req.query.tradition && req.query.tradition !== "All") {
      query.tradition = { $in: [req.query.tradition, "Both"] };
    }

    const events = await PanchangEvent.find(query).sort({ dateKey: 1 }).lean();
    res.status(200).json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

/**
 * PUT /panchang/event/:id
 */
exports.updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = { ...req.body };

    if (payload.dateKey) {
      const parsed = parseDateKey(payload.dateKey);
      if (!parsed) {
        return res.status(400).json({ error: "dateKey must be YYYY-MM-DD" });
      }
      payload.date = parsed;
    }

    const updated = await PanchangEvent.findByIdAndUpdate(id, payload, {
      new: true,
    });
    if (!updated) return res.status(404).json({ error: "Event not found!" });

    res.status(200).json({ message: "Event updated!", event: updated });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

/**
 * DELETE /panchang/event/:id  — soft delete
 */
exports.deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await PanchangEvent.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );
    if (!updated) return res.status(404).json({ error: "Event not found!" });

    res.status(200).json({ message: "Event deleted!" });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};
