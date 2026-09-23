const express = require("express");
const { readDB, writeDB, nextId } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GET /api/stops?district=Salem&near=11.68,78.14&radiusKm=15&q=text&prefix=sal&limit=8
router.get("/", (req, res) => {
  const { district, near, radiusKm, q, prefix, limit } = req.query;
  const data = readDB();
  let results = data.stops;

  if (district) {
    results = results.filter(
      (s) => s.district.toLowerCase() === String(district).toLowerCase()
    );
  }

  if (q) {
    const needle = String(q).toLowerCase();
    results = results.filter((s) => s.name.toLowerCase().includes(needle));
  }

  // Used for destination-search autocomplete: "type 3 letters, see matching
  // stop names that start with them" — startsWith rather than includes so
  // results feel like a proper autocomplete instead of a fuzzy search.
  if (prefix) {
    const p = String(prefix).toLowerCase();
    results = results.filter((s) => s.name.toLowerCase().startsWith(p));
  }

  if (near) {
    const [lat, lng] = String(near).split(",").map(Number);
    const radius = Number(radiusKm) || 20;
    results = results
      .map((s) => ({ ...s, distanceKm: haversineKm(lat, lng, s.lat, s.lng) }))
      .filter((s) => s.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  if (limit) {
    results = results.slice(0, Number(limit));
  }

  res.json({ stops: results });
});

router.get("/districts", (req, res) => {
  const data = readDB();
  const districts = [...new Set(data.stops.map((s) => s.district))].sort();
  res.json({ districts });
});

// Admin-only direct add. Regular users should raise a ticket instead (see /api/tickets).
router.post("/", requireAuth, requireAdmin, (req, res) => {
  const { name, district, lat, lng } = req.body || {};
  if (!name || !district || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "name, district, lat and lng are required." });
  }

  const data = readDB();
  const stop = {
    id: nextId(data, "stops"),
    name,
    district,
    lat: Number(lat),
    lng: Number(lng),
    addedBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  data.stops.push(stop);
  writeDB(data);
  res.status(201).json({ stop });
});

module.exports = router;
