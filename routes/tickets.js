const express = require("express");
const { readDB, writeDB, nextId } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// A user raises a ticket when a stop they need isn't in the directory yet.
router.post("/", requireAuth, (req, res) => {
  const { stopName, district, lat, lng, note } = req.body || {};
  if (!stopName || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "stopName, lat and lng are required." });
  }

  const data = readDB();
  const ticket = {
    id: nextId(data, "tickets"),
    stopName,
    district: district || "",
    lat: Number(lat),
    lng: Number(lng),
    note: note || "",
    status: "open", // open | approved | rejected
    userId: req.user.id,
    createdAt: new Date().toISOString()
  };
  data.tickets.push(ticket);
  writeDB(data);
  res.status(201).json({ ticket });
});

// Regular users see their own tickets; admins see everything.
router.get("/", requireAuth, (req, res) => {
  const data = readDB();
  const tickets =
    req.user.role === "admin"
      ? data.tickets
      : data.tickets.filter((t) => t.userId === req.user.id);
  res.json({ tickets });
});

// Admin resolves a ticket. Approving also creates the stop.
router.patch("/:id", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be 'approved' or 'rejected'." });
  }

  const data = readDB();
  const ticket = data.tickets.find((t) => t.id === id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });

  ticket.status = status;

  if (status === "approved") {
    const stop = {
      id: nextId(data, "stops"),
      name: ticket.stopName,
      district: ticket.district || "Unknown",
      lat: ticket.lat,
      lng: ticket.lng,
      addedBy: ticket.userId,
      createdAt: new Date().toISOString()
    };
    data.stops.push(stop);
  }

  writeDB(data);
  res.json({ ticket });
});

module.exports = router;
