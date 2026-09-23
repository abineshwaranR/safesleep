// ---------- Config ----------
// Default to the live production server hosted on Render
const DEFAULT_HOSTED_API = "https://safesleep.onrender.com/api";
const API =
  window.SAFE_SLEEP_API_URL ||
  localStorage.getItem("bsa_api_url") ||
  (window.location.protocol.startsWith("http") && window.location.hostname === "localhost" && !window.Capacitor
    ? "/api"
    : DEFAULT_HOSTED_API);
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const ROUTE_REFRESH_MS = 45000;
const ROUTE_REFRESH_KM = 0.3;
const TN_VIEWBOX = "76.2,13.6,80.4,8.0";

// Pre-bundled Tamil Nadu major bus stands so mobile app works 100% offline
const BUNDLED_STOPS = [
  { name: "Chennai - CMBT (Koyambedu)", district: "Chennai", lat: 13.0702, lng: 80.1953 },
  { name: "Chennai - Broadway Bus Terminus", district: "Chennai", lat: 13.0919, lng: 80.2847 },
  { name: "Coimbatore - Gandhipuram Bus Stand", district: "Coimbatore", lat: 11.0183, lng: 76.9725 },
  { name: "Madurai - Mattuthavani Bus Stand", district: "Madurai", lat: 9.9450, lng: 78.1650 },
  { name: "Trichy - Central Bus Stand", district: "Tiruchirappalli", lat: 10.8155, lng: 78.6907 },
  { name: "Salem - New Bus Stand", district: "Salem", lat: 11.6822, lng: 78.1461 },
  { name: "Salem - Old Bus Stand", district: "Salem", lat: 11.6643, lng: 78.1460 },
  { name: "Erode - Bus Stand", district: "Erode", lat: 11.3410, lng: 77.7172 },
  { name: "Vellore - New Bus Stand", district: "Vellore", lat: 12.9165, lng: 79.1325 },
  { name: "Tirunelveli - Bus Stand", district: "Tirunelveli", lat: 8.7139, lng: 77.7567 },
  { name: "Thanjavur - New Bus Stand", district: "Thanjavur", lat: 10.7870, lng: 79.1378 },
  { name: "Dindigul - Bus Stand", district: "Dindigul", lat: 10.3624, lng: 77.9695 },
  { name: "Karur - Bus Stand", district: "Karur", lat: 10.9601, lng: 78.0766 },
  { name: "Namakkal - Bus Stand", district: "Namakkal", lat: 11.2189, lng: 78.1677 },
  { name: "Hosur - Bus Stand", district: "Krishnagiri", lat: 12.7409, lng: 77.8253 },
  { name: "Pollachi - Bus Stand", district: "Coimbatore", lat: 10.6588, lng: 77.0084 },
  { name: "Kumbakonam - Bus Stand", district: "Thanjavur", lat: 10.9601, lng: 79.3788 },
  { name: "Nagercoil - Bus Stand", district: "Kanniyakumari", lat: 8.1780, lng: 77.4340 },
  { name: "Villupuram - Bus Stand", district: "Villupuram", lat: 11.9401, lng: 79.4861 },
  { name: "Cuddalore - Bus Stand", district: "Cuddalore", lat: 11.7480, lng: 79.7714 }
];

function filterBundledStops(q = "", district = "") {
  const term = q.toLowerCase();
  return BUNDLED_STOPS.filter((s) => {
    const matchQ = !term || s.name.toLowerCase().includes(term);
    const matchD = !district || s.district.toLowerCase() === district.toLowerCase();
    return matchQ && matchD;
  });
}

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
  lastRouteOrigin: null,
  lastRouteTime: 0,
  routeInFlight: false,
  alarmTriggered: false,
  alarmAudioCtx: null,
  alarmInterval: null,
  vibrationInterval: null,
  isTestingAlarm: false,
  testAlarmTimer: null,
  wakeLock: null
};

// ---------- API helper ----------
async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

  try {
    const resp = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  } catch (err) {
    // Friendly error when mobile app is not connected to a remote server
    if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      throw new Error(
        "Cannot reach backend server. Tap 'Use Offline / Continue as Guest' below to start immediately, or set your server URL in Server Settings."
      );
    }
    throw err;
  }
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

// Guest Mode: allows running the app immediately with zero server/login required
const guestBtn = document.getElementById("guestBtn");
if (guestBtn) {
  guestBtn.onclick = () => {
    state.user = { id: 0, name: "Guest Traveller", role: "guest" };
    state.token = "guest-session";
    localStorage.setItem("bsa_user", JSON.stringify(state.user));
    localStorage.setItem("bsa_token", state.token);
    setLoggedInUI(true);
  };
}

// Server URL Settings
const toggleServer = document.getElementById("toggleServerConfig");
const serverBox = document.getElementById("serverConfigBox");
const serverInput = document.getElementById("serverUrlInput");
const saveServerBtn = document.getElementById("saveServerUrlBtn");
const serverStatus = document.getElementById("serverUrlStatus");

if (serverInput) {
  serverInput.value = localStorage.getItem("bsa_api_url") || "";
}
if (toggleServer && serverBox) {
  toggleServer.onclick = () => serverBox.classList.toggle("hidden");
}
if (saveServerBtn && serverInput) {
  saveServerBtn.onclick = () => {
    let url = serverInput.value.trim();
    if (url && !url.endsWith("/api")) {
      url = url.replace(/\/+$/, "") + "/api";
    }
    if (url) {
      localStorage.setItem("bsa_api_url", url);
      serverStatus.textContent = "Saved! Reloading...";
      setTimeout(() => location.reload(), 500);
    } else {
      localStorage.removeItem("bsa_api_url");
      serverStatus.textContent = "Reset to default. Reloading...";
      setTimeout(() => location.reload(), 500);
    }
  };
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
const destInputEl = document.getElementById("destInput");
const startJourneyBtnEl = document.getElementById("startJourneyBtn");

destInputEl.addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  state.selectedDest = null;
  // Enable start button as soon as 2 characters are typed
  startJourneyBtnEl.disabled = q.length < 2;

  if (q.length < 2) {
    document.getElementById("destResults").innerHTML = "";
    return;
  }
  searchStopDirectory(q);
  searchDebounce = setTimeout(() => searchNominatim(q), 350);
});

destInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    startJourney();
  }
});

let latestStopMatches = [];
let latestGeoMatches = [];

// 1) Search Tamil Nadu bus stop directory by prefix — falls back to bundled stops offline
async function searchStopDirectory(q) {
  try {
    const { stops } = await api(`/stops?prefix=${encodeURIComponent(q)}&limit=8`, { auth: false });
    latestStopMatches = (stops && stops.length > 0) ? stops : filterBundledStops(q);
    renderDestResults();
  } catch (e) {
    latestStopMatches = filterBundledStops(q);
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

const testAlarmBtn = document.getElementById("testAlarmBtn");
if (testAlarmBtn) testAlarmBtn.onclick = toggleTestAlarm;
const testAlarmJourneyBtn = document.getElementById("testAlarmJourneyBtn");
if (testAlarmJourneyBtn) testAlarmJourneyBtn.onclick = toggleTestAlarm;

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
  unlockAudio();
  const errEl = document.getElementById("journeyError");
  if (errEl) errEl.textContent = "";

  // 1. If user hasn't explicitly tapped a dropdown item, auto-select from typed query!
  if (!state.selectedDest) {
    const typed = (document.getElementById("destInput").value || "").trim();
    if (!typed) {
      if (errEl) errEl.textContent = "Please enter your destination stop name.";
      return;
    }
    const match = latestStopMatches[0] || filterBundledStops(typed)[0] || latestGeoMatches[0];
    if (match) {
      state.selectedDest = {
        name: match.name || match.display_name.split(",")[0],
        lat: parseFloat(match.lat),
        lng: parseFloat(match.lng || match.lon)
      };
      document.getElementById("destInput").value = state.selectedDest.name;
    } else {
      if (errEl) errEl.textContent = "Searching destination... Please tap a stop from the suggestions.";
      return;
    }
  }

  if (!("geolocation" in navigator)) {
    if (errEl) errEl.textContent = "This device or browser does not support GPS location.";
    return;
  }

  // Safe notification permission check (never throw ReferenceError in Android WebView)
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch (notifErr) {
    console.warn("Notification check skipped:", notifErr);
  }

  // Keep screen awake while tracking transit
  try {
    requestWakeLock();
  } catch (wErr) {
    console.warn("WakeLock check skipped:", wErr);
  }

  state.alarmTriggered = false;

  // Immediately switch cards from setup to active journey
  document.getElementById("setupCard").classList.add("hidden");
  document.getElementById("journeyCard").classList.remove("hidden");
  document.getElementById("destName").textContent = "to " + state.selectedDest.name;
  document.getElementById("statusPill").textContent = "Acquiring GPS location…";
  document.getElementById("statusPill").classList.remove("alert");

  try {
    initMap();
  } catch (mapErr) {
    console.warn("Map initialization error:", mapErr);
  }

  try {
    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    });
  } catch (geoErr) {
    console.error("watchPosition error:", geoErr);
    if (errEl) errEl.textContent = "GPS error: " + geoErr.message;
  }
}

function stopJourney() {
  releaseWakeLock();
  if (state.watchId !== null) {
    try {
      navigator.geolocation.clearWatch(state.watchId);
    } catch (e) {}
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

const busIcon = (typeof L !== "undefined") ? L.divIcon({
  className: "",
  html: '<div style="font-size:22px; transform: translate(-50%,-50%);">🚌</div>',
  iconSize: [0, 0]
}) : null;

const pinIcon = (typeof L !== "undefined") ? L.divIcon({
  className: "",
  html: '<div style="font-size:26px; transform: translate(-50%,-95%);">📍</div>',
  iconSize: [0, 0]
}) : null;

function initMap() {
  if (typeof L === "undefined") {
    console.warn("Leaflet map library is not loaded yet.");
    return;
  }
  if (state.map) {
    try {
      state.map.remove();
    } catch (e) {}
    state.map = null;
  }
  state.lastRouteOrigin = null;
  state.lastRouteTime = 0;

  try {
    state.map = L.map("map").setView([state.selectedDest.lat, state.selectedDest.lng], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19
    }).addTo(state.map);

    if (pinIcon) {
      state.destMarker = L.marker([state.selectedDest.lat, state.selectedDest.lng], { icon: pinIcon })
        .addTo(state.map)
        .bindPopup("Destination: " + state.selectedDest.name);
    }

    // Force Leaflet to compute correct dimensions when container becomes visible
    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 200);
  } catch (err) {
    console.warn("Leaflet setup warning:", err);
  }
}

function onPositionError(err) {
  console.warn("GPS Position Error:", err);
  const pill = document.getElementById("statusPill");
  if (pill) {
    pill.textContent = "GPS waiting: " + (err.message || "Please enable phone Location.");
    pill.classList.add("alert");
  }
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

// ---------- Audio & Alarm Engine ----------
function getAudioContext() {
  if (!state.alarmAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      state.alarmAudioCtx = new AudioCtx();
    }
  }
  return state.alarmAudioCtx;
}

let cachedAlarmWavUri = null;
function getAlarmWavDataUri() {
  if (cachedAlarmWavUri) return cachedAlarmWavUri;
  try {
    const sampleRate = 11025;
    const duration = 1.0;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;
      // 4 loud urgent alarm beeps:
      if (t < 0.11) {
        sample = Math.sin(2 * Math.PI * 950 * t);
      } else if (t >= 0.13 && t < 0.24) {
        sample = Math.sin(2 * Math.PI * 1350 * t);
      } else if (t >= 0.26 && t < 0.37) {
        sample = Math.sin(2 * Math.PI * 950 * t);
      } else if (t >= 0.39 && t < 0.52) {
        sample = Math.sin(2 * Math.PI * 1350 * t);
      }
      const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 28000)));
      view.setInt16(44 + i * 2, intSample, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    cachedAlarmWavUri = "data:audio/wav;base64," + btoa(binary);
  } catch (err) {
    console.warn("WAV synthesis warning:", err);
  }
  return cachedAlarmWavUri;
}

function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      // Play 1-sample silence to unlock hardware audio routing
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch (e) {
    console.warn("AudioContext unlock warning:", e);
  }

  try {
    const audioEl = document.getElementById("alarmAudioFallback");
    if (audioEl) {
      if (!audioEl.src) {
        const uri = getAlarmWavDataUri();
        if (uri) audioEl.src = uri;
      }
      const p = audioEl.play();
      if (p !== undefined) {
        p.then(() => {
          if (!state.alarmTriggered && !state.isTestingAlarm) {
            audioEl.pause();
            audioEl.currentTime = 0;
          }
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn("Audio element unlock warning:", e);
  }
}

// User-gesture triggers for early audio pre-warming on touch or click
document.addEventListener("click", () => unlockAudio(), { once: true });
document.addEventListener("touchstart", () => unlockAudio(), { once: true });

function playAlarmChirp() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const tones = [
    { freq: 950, start: 0, dur: 0.11 },
    { freq: 1350, start: 0.13, dur: 0.11 },
    { freq: 950, start: 0.26, dur: 0.11 },
    { freq: 1350, start: 0.39, dur: 0.14 }
  ];

  tones.forEach(({ freq, start, dur }) => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0.001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.85, now + start + 0.015);
      gain.gain.setValueAtTime(0.85, now + start + dur - 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + dur);
    } catch (err) {
      console.warn("Chirp play warning:", err);
    }
  });
}

function startVibrationLoop() {
  if (!navigator.vibrate) return;
  if (state.vibrationInterval) clearInterval(state.vibrationInterval);

  const pattern = [700, 300, 700, 300, 700, 800];
  try {
    navigator.vibrate(pattern);
  } catch (e) {}

  state.vibrationInterval = setInterval(() => {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }, 3500);
}

function stopVibrationLoop() {
  if (state.vibrationInterval) {
    clearInterval(state.vibrationInterval);
    state.vibrationInterval = null;
  }
  if (navigator.vibrate) {
    try {
      navigator.vibrate(0);
    } catch (e) {}
  }
}

function startAlarmAudioLoop() {
  unlockAudio();

  // Web Audio siren loop
  if (state.alarmInterval) clearInterval(state.alarmInterval);
  playAlarmChirp();
  state.alarmInterval = setInterval(playAlarmChirp, 900);

  // Fallback Audio Element
  try {
    const audioEl = document.getElementById("alarmAudioFallback");
    if (audioEl) {
      if (!audioEl.src) {
        const uri = getAlarmWavDataUri();
        if (uri) audioEl.src = uri;
      }
      audioEl.currentTime = 0;
      audioEl.play().catch((err) => console.warn("Fallback audio play warning:", err));
    }
  } catch (e) {}
}

function triggerAlarm(distanceKm, destName) {
  state.alarmTriggered = true;
  const banner = document.getElementById("alarmBanner");
  if (banner) banner.classList.remove("hidden");
  
  const text = document.getElementById("alarmText");
  if (text) {
    text.textContent = `You are about ${distanceKm.toFixed(2)} km from ${destName}. Wake up!`;
  }

  // Looping continuous vibration
  startVibrationLoop();

  // System notification
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Wake up! Your stop is near.", {
        body: `About ${distanceKm.toFixed(2)} km from ${destName}.`,
        requireInteraction: true
      });
    }
  } catch (e) {}

  // Continuous sound
  startAlarmAudioLoop();
}

function silenceAlarm() {
  state.alarmTriggered = false;
  state.isTestingAlarm = false;

  const banner = document.getElementById("alarmBanner");
  if (banner) banner.classList.add("hidden");

  if (state.alarmInterval) {
    clearInterval(state.alarmInterval);
    state.alarmInterval = null;
  }

  const audioEl = document.getElementById("alarmAudioFallback");
  if (audioEl) {
    try {
      audioEl.pause();
      audioEl.currentTime = 0;
    } catch (e) {}
  }

  stopVibrationLoop();

  const testBtn = document.getElementById("testAlarmBtn");
  if (testBtn) testBtn.textContent = "🔔 Test Alarm Sound & Vibration";
  const testJourneyBtn = document.getElementById("testAlarmJourneyBtn");
  if (testJourneyBtn) testJourneyBtn.textContent = "🔔 Test Alarm";

  if (state.testAlarmTimer) {
    clearTimeout(state.testAlarmTimer);
    state.testAlarmTimer = null;
  }
}

function toggleTestAlarm() {
  unlockAudio();
  if (state.isTestingAlarm) {
    silenceAlarm();
    return;
  }

  state.isTestingAlarm = true;
  const testBtn = document.getElementById("testAlarmBtn");
  if (testBtn) testBtn.textContent = "⏹️ Stop Alarm Test";
  const testJourneyBtn = document.getElementById("testAlarmJourneyBtn");
  if (testJourneyBtn) testJourneyBtn.textContent = "⏹️ Stop Alarm Test";

  startVibrationLoop();
  startAlarmAudioLoop();

  state.testAlarmTimer = setTimeout(() => {
    if (state.isTestingAlarm) {
      silenceAlarm();
    }
  }, 5000);
}

// ---------- Bus stops directory ----------
async function loadStops() {
  const sel = document.getElementById("districtFilter");
  try {
    const { districts } = await api("/stops/districts", { auth: false });
    sel.innerHTML =
      '<option value="">All districts</option>' +
      districts.map((d) => `<option value="${d}">${d}</option>`).join("");
  } catch (e) {
    // Offline / fallback districts
    const districts = [...new Set(BUNDLED_STOPS.map((s) => s.district))].sort();
    sel.innerHTML =
      '<option value="">All districts</option>' +
      districts.map((d) => `<option value="${d}">${d}</option>`).join("");
  }
  await refreshStopsList();
}

async function refreshStopsList() {
  const q = document.getElementById("stopSearch").value.trim();
  const district = document.getElementById("districtFilter").value;
  const box = document.getElementById("stopsList");

  let stops = [];
  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (district) params.set("district", district);
    const data = await api("/stops?" + params.toString(), { auth: false });
    stops = data.stops || [];
  } catch (e) {
    // Offline fallback from pre-bundled Tamil Nadu stops
    stops = filterBundledStops(q, district);
  }

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
  if (state.user?.role === "guest") {
    document.getElementById("pName").textContent = "Guest Traveller (Offline Mode)";
    document.getElementById("pEmail").textContent = "Local Session";
    document.getElementById("pPhone").textContent = "—";
    document.getElementById("pRole").textContent = "guest";
    document.getElementById("editName").value = "Guest Traveller";
    document.getElementById("editPhone").value = "";
    return;
  }
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
