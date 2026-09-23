# SafeSleep — Tamil Nadu

Wake up automatically before your bus stop. Set your destination, fall asleep,
and the app tracks your live location in the background of your phone's
browser and alarms you (sound + vibration + notification) when you're within
a chosen distance (default **1.5 km**) of where you're getting off.

It also doubles as a growing **directory of Tamil Nadu bus stops**: if a stop
isn't listed yet, a user can raise a ticket, and an admin can approve it into
the shared directory.

## What's inside

- **Backend:** Node.js + Express, JWT auth, bcrypt password hashing.
- **Database:** a simple JSON file (`data/db.json`) — zero native dependencies,
  so `npm install` never needs a compiler. Swap it for Postgres/MongoDB later;
  `db.js` is the only file that touches storage.
- **Frontend:** plain HTML/CSS/JS, no build step. Uses:
  - **Leaflet** + **OpenStreetMap tiles** for the live map
  - **Nominatim** (OpenStreetMap's geocoding API) to search destinations
    outside your stop directory
  - **OSRM** (Open Source Routing Machine, also OSM-based) to draw a real
    road-following route with distance/ETA, instead of a straight line
  - **Overpass API** (via `scripts/import-overpass.js`) to bulk-import real
    bus stop coordinates for any Tamil Nadu district
  - Browser **Geolocation**, **Web Audio**, **Vibration**, and **Notification**
    APIs for the alarm itself

## Quick start

```bash
npm install
cp .env.example .env      # then edit JWT_SECRET
npm start
```

Open **http://localhost:3000**. The stop directory auto-seeds with ~20 major
Tamil Nadu bus stands on first run.

The **first account you register becomes an admin** (can approve tickets and
add stops directly). Every account after that is a normal user.

## Deployment

SafeSleep is ready to deploy to **Render**, **Railway**, **Docker / Docker Compose**, or a **Linux VPS (PM2 + Nginx + SSL)**.

> ⚠️ **Important:** Because SafeSleep uses the browser Geolocation API, **HTTPS is strictly required** in production (browsers disable geolocation on plain HTTP).

👉 See **[DEPLOYMENT.md](DEPLOYMENT.md)** for server hosting instructions.  
📱 See **[MOBILE_DEPLOYMENT.md](MOBILE_DEPLOYMENT.md)** to deploy/install as a **Mobile App (PWA & Android APK)**.

## How the alarm works

1. Log in and start typing a destination. From 3 letters onward you'll see
   two groups of suggestions: matching **bus stops already in your directory**
   (fast, local, prefix-matched — typing "sal" surfaces every stop starting
   with "Sal") and, just below, **other OpenStreetMap places** for anything
   not yet in your directory. Pick one, set your alert distance, and tap
   **Start journey**.
2. The browser's Geolocation API watches your position. Distance-to-alarm is
   calculated as straight-line (haversine) distance on every GPS update, so
   the alarm timing itself doesn't depend on an external routing service
   being reachable.
3. Separately, the map draws an actual **road-following route** (via OSRM)
   between you and your destination — like a normal navigation app — with a
   live road-distance/ETA line above the map. This refreshes at most every
   45 seconds or after you've moved ~300m, to stay well within the public
   OSRM demo server's fair-use limits; it falls back to a plain dashed line
   if that service is briefly unreachable.
4. When you're within the alert distance, the app plays a looping alarm tone,
   vibrates the phone (where supported), and shows a browser notification —
   even if the phone screen is dimmed, as long as the tab stays open.
5. Tap **Stop alarm** once you're awake.

> **Important limitation:** mobile browsers throttle or suspend background
> tabs to save battery, so for a truly reliable "keeps working while my phone
> is locked" alarm, this needs to become a real mobile app (Android/iOS) with
> a background location service — see Roadmap below. As a browser prototype,
> keep the screen on or the tab in the foreground for the alarm to fire
> reliably.

## Growing the Tamil Nadu bus stop directory

Two ways stops get added:

- **Admin import from OpenStreetMap:**
  ```bash
  node scripts/import-overpass.js "Salem"
  node scripts/import-overpass.js "Coimbatore"
  ```
  This queries the free Overpass API for every `highway=bus_stop` /
  `amenity=bus_station` node inside that district and merges new ones into
  the directory. Repeat per district to cover all of Tamil Nadu over time.

- **User tickets:** from the "Bus Stops" tab, a user can submit a stop name +
  location if it's missing. Admins see all open tickets under "My Tickets"
  and can approve (adds the stop) or reject them via the API:
  ```
  PATCH /api/tickets/:id   { "status": "approved" }
  ```
  (A simple admin approve/reject button in the UI is a natural next addition —
  see Roadmap.)

## API overview

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/login` | — | Get a JWT |
| GET/PUT | `/api/auth/profile` | user | View/update your profile |
| GET | `/api/stops?district=&q=&near=lat,lng&radiusKm=` | — | Search the directory |
| GET | `/api/stops/districts` | — | List known districts |
| POST | `/api/stops` | admin | Add a stop directly |
| POST | `/api/tickets` | user | Report a missing stop |
| GET | `/api/tickets` | user | Your tickets (all, if admin) |
| PATCH | `/api/tickets/:id` | admin | Approve/reject a ticket |

## Roadmap ideas

- Admin UI screen for one-click ticket approve/reject (currently via API/`curl`).
- Push notifications via a real mobile app (React Native / Flutter) with a
  foreground service, so the alarm survives a locked screen — the biggest
  gap in the current browser version.
- Multiple saved "favourite stops" per user for quick re-selection.
- Optionally base the *alarm* trigger on OSRM's road distance/duration
  instead of straight-line distance, once you're comfortable depending on
  the routing service being available in real time (current version keeps
  the alarm logic independent of it, for reliability).
- Self-host OSRM and Nominatim (both open-source) instead of using the free
  public demo servers, once usage grows beyond their fair-use limits.
- Move `data/db.json` to Postgres/MongoDB once usage grows — only `db.js`
  needs to change.

## Notes on OpenStreetMap usage

Nominatim and Overpass are free, shared community services. Keep request
rates low (the frontend already debounces search input), and add a proper
`User-Agent`/referer and consider self-hosting Nominatim if this app grows to
real production traffic — see the
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).
