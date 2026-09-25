const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { readDB, writeDB } = require("./db");
const authRoutes = require("./routes/auth");
const stopsRoutes = require("./routes/stops");
const ticketsRoutes = require("./routes/tickets");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Seed the stop directory on first run.
function seedIfEmpty() {
  const data = readDB();
  if (data.stops.length === 0) {
    const seed = JSON.parse(
      fs.readFileSync(path.join(__dirname, "data", "seed-stops.json"), "utf-8")
    );
    seed.forEach((s) => {
      data.stops.push({
        id: data._nextId.stops++,
        name: s.name,
        district: s.district,
        lat: s.lat,
        lng: s.lng,
        addedBy: null,
        createdAt: new Date().toISOString()
      });
    });
    writeDB(data);
    console.log(`Seeded ${seed.length} Tamil Nadu bus stops.`);
  }
}
seedIfEmpty();

app.use("/api/auth", authRoutes);
app.use("/api/stops", stopsRoutes);
app.use("/api/tickets", ticketsRoutes);

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css") || filePath.endsWith(".json")) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      }
    }
  })
);

app.get("/health", (req, res) => res.json({ ok: true }));

const server = app.listen(PORT, () => {
  console.log(`SafeSleep running at http://localhost:${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log("SafeSleep HTTP server closed.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forcefully shutting down after timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
