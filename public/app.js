// ---------- Config ----------
// Allow dynamic backend API URL for standalone mobile packaging (e.g. Capacitor / Cordova)
const API =
  window.SAFE_SLEEP_API_URL ||
  localStorage.getItem("bsa_api_url") ||
  "/api";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Nominatim's usage policy asks for max 1 request/sec and an identifying
// referer/user-agent. The debounce below keeps us well within that.

// OSRM (Open Source Routing Machine) — also OpenStreetMap-based — turns two
// points into an actual road-following route instead of a straight line.
// This is the public demo server: fine for a prototype, but it's shared and
// rate-limited, so we throttle how often we call it (see ROUTE_REFRESH_MS)
// and self-host OSRM if this app goes into real production use.
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const ROUTE_REFRESH_MS = 45000; // re-fetch the road route at most every 45s
const ROUTE_REFRESH_KM = 0.3; // ...or sooner if the user has moved this far

// Tamil Nadu rough bounding box, used to bias/limit geocoding results.
const TN_VIEWBOX = "76.2,13.6,80.4,8.0"; // left,top,right,bottom

let state = {
  token: localStorage.getItem("bsa_token") || null,
  user: JSON.parse(localStorage.getItem("bsa_user") || "null"),
  selectedDest: null, // { name, lat, lng }
  watchId: null,
  map: null,
  userMarker: null,
  destMarker: null,
  routeLine: null,
  routeLineOutline: null,
  lastRouteOrigin: null, // { lat, lng } used for the most recent OSRM fetch
  lastRouteTime: 0,
  routeInFlight: false,
  alarmTriggered: false,
  alarmAudioCtx: null,
  alarmInterval: null,
  wakeLock: null
};

// ---------- API helper ----------
async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

  const resp = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// ---------- View routing ----------
function showView(name) {
  document
    .querySelectorAll(".container")
    .forEach((el) => el.classList.add("hidden"));
  document.getElementById(name + "View").classList.remove("hidden");

  document.querySelectorAll("#mainNav button[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });

  if (name === "stops") loadStops();
  if (name === "tickets") loadTickets();
  if (name === "profile") loadProfile();
}

function setLoggedInUI(loggedIn) {
  document.getElementById("mainNav").classList.toggle("hidden", !loggedIn);
  document.getElementById("authView").classList.toggle("hidden", loggedIn);
  if (loggedIn) showView("dashboard");
}

// ---------- Auth ----------
document.getElementById("showRegister").onclick = () => {
  document.getElementById("loginForm").classList.add("hidden");
  document.getElementById("registerForm").classList.remove("hidden");
};
document.getElementById("showLogin").onclick = () => {
  document.getElementById("registerForm").classList.add("hidden");
  document.getElementById("loginForm").classList.remove("hidden");
};

document.getElementById("loginBtn").onclick = async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  try {
    const data = await api("/auth/login", { method: "POST", body: { email, password }, auth: false });
    onAuthSuccess(data);
  } catch (e) {
    errEl.textContent = e.message;
  }
};

document.getElementById("registerBtn").onclick = async () => {
  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const phone = document.getElementById("regPhone").value.trim();
  const password = document.getElementById("regPassword").value;
  const errEl = document.getElementById("registerError");
  errEl.textContent = "";
  try {
    const data = await api("/auth/register", { method: "POST", body: { name, email, phone, password }, auth: false });
    onAuthSuccess(data);
  } catch (e) {
    errEl.textContent = e.message;
  }
};

function onAuthSuccess(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem("bsa_token", data.token);
  localStorage.setItem("bsa_user", JSON.stringify(data.user));
  setLoggedInUI(true);
}

document.getElementById("logoutBtn").onclick = () => {
  stopJourney();
  state.token = null;
  state.user = null;
  localStorage.removeItem("bsa_token");
  localStorage.removeItem("bsa_user");
  setLoggedInUI(false);
};

document.querySelectorAll("#mainNav button[data-view]").forEach((b) => {
  b.onclick = () => showView(b.dataset.view);
});

// ---------- Destination search (Nominatim / OpenStreetMap) ----------
let searchDebounce = null;
document.getElementById("destInput").addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  state.selectedDest = null;
  document.getElementById("startJourneyBtn").disabled = true;
  if (q.length < 3) {
    document.getElementById("destResults").innerHTML = "";
    return;
  }
  // Directory prefix-match is a fast local call, so fire it almost
  // immediately; Nominatim is a shared external service, so debounce it.
  searchStopDirectory(q);
  searchDebounce = setTimeout(() => searchNominatim(q), 450);
});

let latestStopMatches = [];
let latestGeoMatches = [];

// 1) Search our own Tamil Nadu bus stop directory by prefix — "type 3
//    letters, see stop names in the database that start with them".
async function searchStopDirectory(q) {
  try {
    const { stops } = await api(`/stops?prefix=${encodeURIComponent(q)}&limit=8`, { auth: false });
    latestStopMatches = stops;
    renderDestResults();
  } catch (e) {
    latestStopMatches = [];
    renderDestResults();
  }
}

// 2) Broader place search via Nominatim (OpenStreetMap), for destinations
//    not yet in our directory (addresses, landmarks, smaller places).
async function searchNominatim(q) {
  const url = `${NOMINATIM}?format=json&q=${encodeURIComponent(q)}&countrycodes=in&viewbox=${TN_VIEWBOX}&bounded=0&limit=5`;
  try {
    const resp = await fetch(url, { headers: { "Accept-Language": "en" } });
    latestGeoMatches = await resp.json();
  } catch (e) {
    latestGeoMatches = [];
  }
  renderDestResults();
}

function renderDestResults() {
  const box = document.getElementById("destResults");
  const hasStops = latestStopMatches.length > 0;
  const hasGeo = latestGeoMatches.length > 0;

  if (!hasStops && !hasGeo) {
    box.innerHTML = '<p class="lead" style="margin:8px 0;">No matches yet. Keep typing, or try a nearby town name.</p>';
    return;
  }

  let html = "";

  if (hasStops) {
    html += '<p class="meta" style="margin:10px 0 2px;">Bus stops in our directory</p>';
    html += latestStopMatches
      .map(
        (s, i) =>
          `<div class="stop-row" style="cursor:pointer" data-kind="stop" data-i="${i}">
            <div><div class="name">🚌 ${escapeHtml(s.name)}</div>
            <div class="meta">${escapeHtml(s.district)}</div></div>
          </div>`
      )
      .join("");
  }

  if (hasGeo) {
    html += '<p class="meta" style="margin:10px 0 2px;">Other places (OpenStreetMap)</p>';
    html += latestGeoMatches
      .map(
        (r, i) =>
          `<div class="stop-row" style="cursor:pointer" data-kind="geo" data-i="${i}">
            <div><div class="name">📍 ${escapeHtml(r.display_name.split(",")[0])}</div>
            <div class="meta">${escapeHtml(r.display_name)}</div></div>
          </div>`
      )
      .join("");
  }

  box.innerHTML = html;

  [...box.querySelectorAll(".stop-row")].forEach((row) => {
    row.onclick = () => {
      const kind = row.dataset.kind;
      const i = Number(row.dataset.i);
      if (kind === "stop") {
        const s = latestStopMatches[i];
        state.selectedDest = { name: s.name, lat: s.lat, lng: s.lng };
      } else {
        const r = latestGeoMatches[i];
        state.selectedDest = {
          name: r.display_name.split(",")[0],
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon)
        };
      }
      document.getElementById("destInput").value = state.selectedDest.name;
      box.innerHTML = "";
      latestStopMatches = [];
      latestGeoMatches = [];
      document.getElementById("startJourneyBtn").disabled = false;
    };
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Journey tracking ----------
document.getElementById("startJourneyBtn").onclick = startJourney;
document.getElementById("endJourneyBtn").onclick = stopJourney;
document.getElementById("stopAlarmBtn").onclick = silenceAlarm;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- Screen Wake Lock (prevents phone sleeping during journey) ----------
async function requestWakeLock() {
  if ("wakeLock" in navigator && !state.wakeLock) {
    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
      console.log("SafeSleep: Screen Wake Lock active (prevents screen sleep during transit).");
    } catch (err) {
      console.warn("Screen Wake Lock request failed:", err.message);
    }
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
    console.log("SafeSleep: Screen Wake Lock released.");
  }
}

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && state.watchId !== null) {
    await requestWakeLock();
  }
});

function startJourney() {
  if (!state.selectedDest) return;
  if (!("geolocation" in navigator)) {
    document.getElementById("journeyError").textContent = "This browser doesn't support location access.";
    return;
  }

  if (Notification && Notification.permission === "default") {
    Notification.requestPermission();
  }

  // Keep screen awake while tracking transit
  requestWakeLock();

  state.alarmTriggered = false;
  document.getElementById("setupCard").classList.add("hidden");
  document.getElementById("journeyCard").classList.remove("hidden");
  document.getElementById("destName").textContent = "to " + state.selectedDest.name;

  initMap();

  state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000
  });
}

function stopJourney() {
  releaseWakeLock();
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  silenceAlarm();
  document.getElementById("setupCard").classList.remove("hidden");
  document.getElementById("journeyCard").classList.add("hidden");
  document.getElementById("destInput").value = "";
  document.getElementById("destResults").innerHTML = "";
  document.getElementById("startJourneyBtn").disabled = true;
  document.getElementById("roadStats").textContent = "";
  state.selectedDest = null;
  state.lastRouteOrigin = null;
  state.lastRouteTime = 0;
}

const busIcon = L.divIcon({
  className: "",
  html: '<div style="font-size:22px; transform: translate(-50%,-50%);">🚌</div>',
  iconSize: [0, 0]
});
const pinIcon = L.divIcon({
  className: "",
  html: '<div style="font-size:26px; transform: translate(-50%,-95%);">📍</div>',
  iconSize: [0, 0]
});

function initMap() {
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  state.lastRouteOrigin = null;
  state.lastRouteTime = 0;

  state.map = L.map("map").setView([state.selectedDest.lat, state.selectedDest.lng], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(state.map);

  state.destMarker = L.marker([state.selectedDest.lat, state.selectedDest.lng], { icon: pinIcon })
    .addTo(state.map)
    .bindPopup("Destination: " + state.selectedDest.name);
}

function onPositionError(err) {
  document.getElementById("statusPill").textContent = "Location error: " + err.message;
  document.getElementById("statusPill").classList.add("alert");
}

function onPosition(pos) {
  const { latitude, longitude } = pos.coords;
  const dest = state.selectedDest;
  const distanceKm = haversineKm(latitude, longitude, dest.lat, dest.lng);
  const alertThreshold = parseFloat(document.getElementById("alertDistance").value) || 1.5;

  document.getElementById("distanceKm").textContent = distanceKm.toFixed(2) + " km";
  const pill = document.getElementById("statusPill");
  pill.classList.remove("alert");
  pill.textContent = distanceKm <= alertThreshold ? "Almost there" : "Tracking location…";

  if (!state.userMarker) {
    state.userMarker = L.marker([latitude, longitude], { icon: busIcon }).addTo(state.map);
  } else {
    state.userMarker.setLatLng([latitude, longitude]);
  }

  maybeRefreshRoute(latitude, longitude, dest);

  if (distanceKm <= alertThreshold && !state.alarmTriggered) {
    triggerAlarm(distanceKm, dest.name);
  }
}

// Draws a real road-following route (via OSRM) instead of a straight line,
// throttled so we don't hammer the shared public routing server on every
// single GPS update.
function maybeRefreshRoute(lat, lng, dest) {
  const now = Date.now();
  const movedFar =
    !state.lastRouteOrigin ||
    haversineKm(lat, lng, state.lastRouteOrigin.lat, state.lastRouteOrigin.lng) >= ROUTE_REFRESH_KM;
  const dueForRefresh = now - state.lastRouteTime >= ROUTE_REFRESH_MS;

  if (state.routeInFlight || (!movedFar && !dueForRefresh)) return;

  state.routeInFlight = true;
  state.lastRouteOrigin = { lat, lng };
  state.lastRouteTime = now;

  fetchRoadRoute(lat, lng, dest.lat, dest.lng)
    .then((route) => {
      if (route) drawRoute(route.coordinates, [lat, lng], [dest.lat, dest.lng]);
      if (route) updateRoadStats(route.distanceMeters, route.durationSeconds);
    })
    .catch(() => {
      // Fall back to a simple straight line if OSRM is unreachable/rate-limited.
      drawRoute(null, [lat, lng], [dest.lat, dest.lng]);
    })
    .finally(() => {
      state.routeInFlight = false;
    });
}

async function fetchRoadRoute(lat1, lng1, lat2, lng2) {
  const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("OSRM request failed");
  const data = await resp.json();
  const route = data.routes && data.routes[0];
  if (!route) return null;
  return {
    coordinates: route.geometry.coordinates.map(([lon, la]) => [la, lon]),
    distanceMeters: route.distance,
    durationSeconds: route.duration
  };
}

function drawRoute(latlngs, from, to) {
  const path = latlngs || [from, to]; // straight-line fallback
  if (state.routeLineOutline) state.map.removeLayer(state.routeLineOutline);
  if (state.routeLine) state.map.removeLayer(state.routeLine);

  // Two-layer line (a wider pale outline under a solid color) reads like a
  // navigation-app route rather than a plain drawn line.
  state.routeLineOutline = L.polyline(path, {
    color: "#ffffff",
    weight: 9,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(state.map);

  state.routeLine = L.polyline(path, {
    color: latlngs ? "#3D6EF2" : "#F2A65A",
    weight: 5,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
    dashArray: latlngs ? null : "6 8"
  }).addTo(state.map);

  const bounds = L.latLngBounds(path);
  state.map.fitBounds(bounds, { padding: [40, 40] });
}

function updateRoadStats(distanceMeters, durationSeconds) {
  const km = (distanceMeters / 1000).toFixed(1);
  const mins = Math.round(durationSeconds / 60);
  document.getElementById("roadStats").textContent = `Road distance: ${km} km · ETA ${mins} min`;
}

// ---------- Alarm ----------
function triggerAlarm(distanceKm, destName) {
  state.alarmTriggered = true;
  document.getElementById("alarmBanner").classList.remove("hidden");
  document.getElementById("alarmText").textContent =
    `You are about ${distanceKm.toFixed(2)} km from ${destName}. Wake up!`;

  if (navigator.vibrate) {
    navigator.vibrate([400, 200, 400, 200, 400]);
  }
  if (Notification && Notification.permission === "granted") {
    new Notification("Wake up! Your stop is near.", {
      body: `About ${distanceKm.toFixed(2)} km from ${destName}.`
    });
  }
  playBeepLoop();
}

function playBeepLoop() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  state.alarmAudioCtx = new Ctx();

  function beep() {
    const ctx = state.alarmAudioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  }

  beep();
  state.alarmInterval = setInterval(beep, 700);
}

function silenceAlarm() {
  document.getElementById("alarmBanner").classList.add("hidden");
  if (state.alarmInterval) {
    clearInterval(state.alarmInterval);
    state.alarmInterval = null;
  }
  if (state.alarmAudioCtx) {
    state.alarmAudioCtx.close();
    state.alarmAudioCtx = null;
  }
}

// ---------- Bus stops directory ----------
async function loadStops() {
  try {
    const { districts } = await api("/stops/districts", { auth: false });
    const sel = document.getElementById("districtFilter");
    sel.innerHTML =
      '<option value="">All districts</option>' +
      districts.map((d) => `<option value="${d}">${d}</option>`).join("");
  } catch (e) {
    /* non-fatal */
  }
  await refreshStopsList();
}

async function refreshStopsList() {
  const q = document.getElementById("stopSearch").value.trim();
  const district = document.getElementById("districtFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (district) params.set("district", district);

  try {
    const { stops } = await api("/stops?" + params.toString(), { auth: false });
    const box = document.getElementById("stopsList");
    if (!stops.length) {
      box.innerHTML = '<p class="lead">No stops match yet — raise a ticket below.</p>';
      return;
    }
    box.innerHTML = stops
      .map(
        (s) => `<div class="stop-row">
          <div><div class="name">${escapeHtml(s.name)}</div><div class="meta">${escapeHtml(s.district)}</div></div>
        </div>`
      )
      .join("");
  } catch (e) {
    document.getElementById("stopsList").innerHTML = '<p class="error-text">Could not load stops.</p>';
  }
}
document.getElementById("stopSearch").addEventListener("input", debounce(refreshStopsList, 300));
document.getElementById("districtFilter").addEventListener("change", refreshStopsList);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Tickets ----------
let ticketLocation = null;
document.getElementById("ticketUseLocation").onclick = () => {
  const btn = document.getElementById("ticketUseLocation");
  btn.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      ticketLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      btn.textContent = "Location captured ✓";
    },
    () => {
      btn.textContent = "Could not get location";
    }
  );
};

document.getElementById("submitTicketBtn").onclick = async () => {
  const stopName = document.getElementById("ticketName").value.trim();
  const district = document.getElementById("ticketDistrict").value.trim();
  const note = document.getElementById("ticketNote").value.trim();
  const errEl = document.getElementById("ticketError");
  errEl.textContent = "";

  if (!stopName) return (errEl.textContent = "Please name the stop.");
  if (!ticketLocation) return (errEl.textContent = "Please capture a location for the stop.");

  try {
    await api("/tickets", {
      method: "POST",
      body: { stopName, district, note, lat: ticketLocation.lat, lng: ticketLocation.lng }
    });
    document.getElementById("ticketName").value = "";
    document.getElementById("ticketDistrict").value = "";
    document.getElementById("ticketNote").value = "";
    document.getElementById("ticketUseLocation").textContent = "Use my current location";
    ticketLocation = null;
    errEl.style.color = "#3D8577";
    errEl.textContent = "Ticket submitted. Thanks for improving the directory!";
  } catch (e) {
    errEl.style.color = "";
    errEl.textContent = e.message;
  }
};

async function loadTickets() {
  const subtitle = document.getElementById("ticketsSubtitle");
  subtitle.textContent =
    state.user?.role === "admin" ? "All tickets raised by users." : "Stops you've asked us to add.";
  try {
    const { tickets } = await api("/tickets");
    const box = document.getElementById("ticketsList");
    if (!tickets.length) {
      box.innerHTML = '<p class="lead">No tickets yet.</p>';
      return;
    }
    box.innerHTML = tickets
      .slice()
      .reverse()
      .map(
        (t) => `<div class="ticket-row">
          <div><div class="name">${escapeHtml(t.stopName)}</div><div class="meta">${escapeHtml(t.district || "—")} · ${new Date(t.createdAt).toLocaleDateString()}</div></div>
          <span class="badge ${t.status}">${t.status}</span>
        </div>`
      )
      .join("");
  } catch (e) {
    document.getElementById("ticketsList").innerHTML = '<p class="error-text">Could not load tickets.</p>';
  }
}

// ---------- Profile ----------
async function loadProfile() {
  try {
    const { user } = await api("/auth/profile");
    state.user = user;
    document.getElementById("pName").textContent = user.name;
    document.getElementById("pEmail").textContent = user.email;
    document.getElementById("pPhone").textContent = user.phone || "—";
    document.getElementById("pRole").textContent = user.role;
    document.getElementById("editName").value = user.name;
    document.getElementById("editPhone").value = user.phone || "";
  } catch (e) {
    /* ignore */
  }
}

document.getElementById("saveProfileBtn").onclick = async () => {
  const name = document.getElementById("editName").value.trim();
  const phone = document.getElementById("editPhone").value.trim();
  const msg = document.getElementById("profileMsg");
  try {
    const { user } = await api("/auth/profile", { method: "PUT", body: { name, phone } });
    state.user = user;
    localStorage.setItem("bsa_user", JSON.stringify(user));
    msg.style.color = "#3D8577";
    msg.textContent = "Saved.";
    loadProfile();
  } catch (e) {
    msg.style.color = "";
    msg.textContent = e.message;
  }
};

// ---------- Boot ----------
setLoggedInUI(!!state.token);
