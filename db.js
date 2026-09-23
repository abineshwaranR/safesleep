// Simple JSON-file database.
// This keeps the project dependency-free of native modules (no build tools
// needed for SQLite drivers). Swap this file out for a real database
// (Postgres/MongoDB/etc.) later without touching route files, as long as
// you keep the same function signatures.

const fs = require("fs");
const path = require("path");

const DB_FILE = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "data", "db.json");

const DEFAULT_DATA = {
  users: [],
  stops: [],
  tickets: [],
  _nextId: { users: 1, stops: 1, tickets: 1 }
};

function ensureFile() {
  if (!fs.existsSync(DB_FILE)) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

function readDB() {
  ensureFile();
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  return JSON.parse(raw);
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function nextId(data, collection) {
  const id = data._nextId[collection]++;
  return id;
}

module.exports = { readDB, writeDB, nextId, DB_FILE };
