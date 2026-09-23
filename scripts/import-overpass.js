/**
 * Import real bus stop locations from OpenStreetMap's Overpass API for a
 * given Tamil Nadu district (or any place name), and add any new ones into
 * data/db.json.
 *
 * Usage:
 *   node scripts/import-overpass.js "Salem"
 *   node scripts/import-overpass.js "Coimbatore"
 *
 * Requires Node 18+ (for the built-in fetch). Be considerate with Overpass:
 * this is a shared public service, so don't run it in a tight loop.
 */

const { readDB, writeDB, nextId } = require("../db");

const place = process.argv[2];
if (!place) {
  console.error('Usage: node scripts/import-overpass.js "<District or place name>"');
  process.exit(1);
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

async function main() {
  console.log(`Looking up "${place}" and querying Overpass for bus stops...`);

  const query = `
    [out:json][timeout:60];
    area["name"="${place}"]["boundary"="administrative"]->.searchArea;
    (
      node["highway"="bus_stop"](area.searchArea);
      node["amenity"="bus_station"](area.searchArea);
    );
    out body;
  `;

  const resp = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: query
  });

  if (!resp.ok) {
    throw new Error(`Overpass request failed: ${resp.status} ${resp.statusText}`);
  }

  const json = await resp.json();
  const elements = json.elements || [];
  console.log(`Overpass returned ${elements.length} stop(s) for "${place}".`);

  const data = readDB();
  const existingKeys = new Set(
    data.stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)
  );

  let added = 0;
  for (const el of elements) {
    const name = el.tags?.name || `Unnamed stop near ${place}`;
    const key = `${el.lat.toFixed(5)},${el.lon.toFixed(5)}`;
    if (existingKeys.has(key)) continue;

    data.stops.push({
      id: nextId(data, "stops"),
      name,
      district: place,
      lat: el.lat,
      lng: el.lon,
      addedBy: null,
      createdAt: new Date().toISOString()
    });
    existingKeys.add(key);
    added++;
  }

  writeDB(data);
  console.log(`Added ${added} new stop(s) to data/db.json.`);
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
