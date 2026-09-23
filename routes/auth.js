const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { readDB, writeDB, nextId } = require("../db");
const { requireAuth, JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

router.post("/register", async (req, res) => {
  const { name, email, phone, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const data = readDB();
  const exists = data.users.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase()
  );
  if (exists) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: nextId(data, "users"),
    name,
    email,
    phone: phone || "",
    passwordHash,
    role: data.users.length === 0 ? "admin" : "user", // first user becomes admin
    createdAt: new Date().toISOString()
  };
  data.users.push(user);
  writeDB(data);

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: "30d"
  });
  res.status(201).json({ token, user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const data = readDB();
  const user = data.users.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase()
  );
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: "30d"
  });
  res.json({ token, user: publicUser(user) });
});

router.get("/profile", requireAuth, (req, res) => {
  const data = readDB();
  const user = data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user) });
});

router.put("/profile", requireAuth, (req, res) => {
  const { name, phone } = req.body || {};
  const data = readDB();
  const user = data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found." });

  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;
  writeDB(data);

  res.json({ user: publicUser(user) });
});

module.exports = router;
