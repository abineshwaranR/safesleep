// ==========================================================================
// SafeSleep — Google Maps Style Fullscreen Transit Alarm Application Logic
// ==========================================================================

// ---------- Config & APIs ----------
const DEFAULT_HOSTED_API = "https://safesleep.onrender.com/api";
const API =
  window.SAFE_SLEEP_API_URL ||
  localStorage.getItem("bsa_api_url") ||
  (window.location.protocol.startsWith("http") && window.location.hostname === "localhost" && !window.Capacitor
    ? "/api"
    : DEFAULT_HOSTED_API);

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const ROUTE_REFRESH_MS = 35000;
const ROUTE_REFRESH_KM = 0.25;
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

// ---------- Global State ----------
let state = {
  token: localStorage.getItem("bsa_token") || null,
  user: JSON.parse(localStorage.getItem("bsa_user") || "null"),
  selectedDest: null, // { name, lat, lng, district }
  userCoords: null, // { lat, lng }
  initialJourneyDistance: null,
  watchId: null,
  map: null,
  currentTileLayer: null,
  currentLayerName: "streets", // "streets", "satellite", "night"
  userMarker: null,
  destMarker: null,
  alertCircle: null,
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

// ---------- API Helper ----------
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
    if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      throw new Error(
        "Cannot reach backend server. Tap 'Use Offline / Continue as Guest' to use all GPS alarm features immediately without an account."
      );
    }
    throw err;
  }
}

// ---------- View Management ----------
function showView(name) {
  // Modal overlay views
  const overlays = ["stops", "tickets", "profile"];
  
  if (name === "dashboard") {
    overlays.forEach((v) => {
      const el = document.getElementById(v + "View");
      if (el) el.classList.add("hidden");
    });
    if (state.map) {
      setTimeout(() => state.map.invalidateSize(), 150);
    }
  } else {
    overlays.forEach((v) => {
      const el = document.getElementById(v + "View");
      if (el) el.classList.toggle("hidden", v !== name);
    });
  }

  // Update topbar nav active state
  document.querySelectorAll("#mainNav button[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });

  if (name === "stops") loadStops();
  if (name === "tickets") loadTickets();
  if (name === "profile") loadProfile();
}

function setLoggedInUI(loggedIn) {
  const mainNav = document.getElementById("mainNav");
  const authView = document.getElementById("authView");
  if (mainNav) mainNav.classList.toggle("hidden", !loggedIn);
  if (authView) authView.classList.toggle("hidden", loggedIn);

  if (loggedIn) {
    showView("dashboard");
    // Ensure map is properly sized
    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 200);
  }
}

// Close buttons for modals
document.getElementById("closeStopsBtn")?.addEventListener("click", () => showView("dashboard"));
document.getElementById("closeTicketsBtn")?.addEventListener("click", () => showView("dashboard"));
document.getElementById("closeProfileBtn")?.addEventListener("click", () => showView("dashboard"));
document.getElementById("brandLogo")?.addEventListener("click", () => showView("dashboard"));

document.querySelectorAll("#mainNav button[data-view]").forEach((b) => {
  b.onclick = () => showView(b.dataset.view);
});

document.getElementById("logoutBtn").onclick = () => {
  stopJourney();
  state.token = null;
  state.user = null;
  localStorage.removeItem("bsa_token");
  localStorage.removeItem("bsa_user");
  setLoggedInUI(false);
};

// ---------- Auth Handlers ----------
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

// Guest Mode (instant offline travel)
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

// Backend Server URL Settings
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

// ==========================================================================
// Google Maps Style Map Engine
// ==========================================================================

// Layer Definitions
const TILE_LAYERS = {
  streets: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20
    }
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
      maxZoom: 19
    }
  },
  night: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20
    }
  }
};

// Google Maps Custom SVG & Pulsing HTML Markers
function createGoogleUserMarker() {
  return L.divIcon({
    className: "gm-user-marker-container",
    html: '<div class="gm-user-marker"><div class="gm-accuracy-ring"></div><div class="gm-user-dot"></div></div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

function createGoogleDestPin() {
  return L.divIcon({
    className: "gm-dest-pin-container",
    html: `
      <div class="gm-dest-marker">
        <svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17 0C7.61 0 0 7.61 0 17C0 27.2 14.88 42.5 15.52 43.24C16.3 44.14 17.7 44.14 18.48 43.24C19.12 42.5 34 27.2 34 17C34 7.61 26.39 0 17 0Z" fill="#EA4335"/>
          <circle cx="17" cy="16" r="6.5" fill="#FFFFFF"/>
        </svg>
      </div>`,
    iconSize: [34, 44],
    iconAnchor: [17, 44],
    popupAnchor: [0, -42]
  });
}

function initMap() {
  if (typeof L === "undefined") {
    console.warn("Leaflet not available yet.");
    return;
  }
  if (state.map) return;

  try {
    // Initialize centered on Tamil Nadu center
    state.map = L.map("map", {
      center: [11.1271, 78.6569],
      zoom: 8,
      zoomControl: false // Using our custom Google Maps floating zoom pill
    });

    setMapLayer("streets");

    // Click anywhere on map to select destination (like Google Maps)
    state.map.on("click", onMapClick);

    // Initial GPS locate attempt to show user position
    locateUserPosition(false);

    window.addEventListener("resize", () => {
      if (state.map) state.map.invalidateSize();
    });
  } catch (err) {
    console.warn("Map setup error:", err);
  }
}

function setMapLayer(name) {
  if (!state.map || !TILE_LAYERS[name]) return;
  if (state.currentTileLayer) {
    state.map.removeLayer(state.currentTileLayer);
  }
  const config = TILE_LAYERS[name];
  state.currentTileLayer = L.tileLayer(config.url, config.options).addTo(state.map);
  state.currentLayerName = name;

  // Update layer picker buttons active state
  document.querySelectorAll(".layer-option-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.layer === name);
  });
}

// Locate User Position
function locateUserPosition(flyToUser = true) {
  if (!("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.userCoords = { lat: latitude, lng: longitude };
      updateUserMarker(latitude, longitude);

      if (flyToUser && state.map) {
        state.map.flyTo([latitude, longitude], 15, { duration: 1.2 });
      }
    },
    (err) => {
      console.warn("GPS Locate notice:", err.message);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
  );
}

function updateUserMarker(lat, lng) {
  if (!state.map) return;
  if (!state.userMarker) {
    state.userMarker = L.marker([lat, lng], {
      icon: createGoogleUserMarker(),
      zIndexOffset: 1000
    }).addTo(state.map);
  } else {
    state.userMarker.setLatLng([lat, lng]);
  }
}

// Handle clicking on map to choose destination
async function onMapClick(e) {
  if (state.watchId !== null) return; // Don't alter destination while actively tracking a journey
  const { lat, lng } = e.latlng;

  // Temporary optimistic title
  selectDestination({
    name: `Location (${lat.toFixed(3)}, ${lng.toFixed(3)})`,
    district: "Tamil Nadu",
    lat,
    lng
  });

  // Reverse geocode via Nominatim for pretty place name
  try {
    const resp = await fetch(
      `${NOMINATIM_REVERSE}?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await resp.json();
    if (data && data.display_name) {
      const parts = data.display_name.split(",");
      const cleanName = parts[0] + (parts[1] ? ", " + parts[1].trim() : "");
      const district =
        data.address?.state_district || data.address?.county || data.address?.city || "Tamil Nadu";
      selectDestination({ name: cleanName, district, lat, lng });
    }
  } catch (err) {
    /* keep coordinates fallback */
  }
}

// ==========================================================================
// Destination & Alert Setup
// ==========================================================================

function selectDestination(dest) {
  state.selectedDest = dest;

  const destInput = document.getElementById("destInput");
  const clearInputBtn = document.getElementById("clearDestInputBtn");
  const clearSelectionBtn = document.getElementById("clearSelectionBtn");
  const startBtn = document.getElementById("startJourneyBtn");
  const fitBtn = document.getElementById("fitRouteBtn");
  const setupBadge = document.getElementById("setupBadgeTitle");
  const setupTitle = document.getElementById("setupTitle");
  const setupSub = document.getElementById("setupSubtitle");

  if (destInput) destInput.value = dest.name;
  if (clearInputBtn) clearInputBtn.classList.remove("hidden");
  if (clearSelectionBtn) clearSelectionBtn.classList.remove("hidden");
  if (startBtn) startBtn.disabled = false;
  if (fitBtn) fitBtn.classList.remove("hidden");

  if (setupBadge) setupBadge.textContent = dest.district ? `📍 ${dest.district}` : "📍 Destination";
  if (setupTitle) setupTitle.textContent = dest.name;
  if (setupSub) setupSub.textContent = "Wake-up perimeter armed · Ready to start";

  // Hide suggestions
  document.getElementById("destResults").innerHTML = "";

  // Drop / Move Google Destination Pin
  if (!state.destMarker) {
    state.destMarker = L.marker([dest.lat, dest.lng], {
      icon: createGoogleDestPin(),
      zIndexOffset: 900
    })
      .addTo(state.map)
      .bindPopup(`<b>${escapeHtml(dest.name)}</b><br>${escapeHtml(dest.district || "")}`);
  } else {
    state.destMarker.setLatLng([dest.lat, dest.lng]);
    state.destMarker.setPopupContent(`<b>${escapeHtml(dest.name)}</b><br>${escapeHtml(dest.district || "")}`);
  }

  // Draw Wake-up Zone Alert Circle
  updateAlertCircle();

  // If user position is known, calculate initial route and fit bounds
  if (state.userCoords) {
    maybeRefreshRoute(state.userCoords.lat, state.userCoords.lng, dest);
    fitRouteBounds();
  } else {
    state.map.flyTo([dest.lat, dest.lng], 13, { duration: 1.0 });
  }
}

function clearSelectedDestination() {
  state.selectedDest = null;
  const destInput = document.getElementById("destInput");
  const clearInputBtn = document.getElementById("clearDestInputBtn");
  const clearSelectionBtn = document.getElementById("clearSelectionBtn");
  const startBtn = document.getElementById("startJourneyBtn");
  const fitBtn = document.getElementById("fitRouteBtn");
  const setupBadge = document.getElementById("setupBadgeTitle");
  const setupTitle = document.getElementById("setupTitle");
  const setupSub = document.getElementById("setupSubtitle");

  if (destInput) destInput.value = "";
  if (clearInputBtn) clearInputBtn.classList.add("hidden");
  if (clearSelectionBtn) clearSelectionBtn.classList.add("hidden");
  if (startBtn) startBtn.disabled = true;
  if (fitBtn) fitBtn.classList.add("hidden");

  if (setupBadge) setupBadge.textContent = "📍 Destination";
  if (setupTitle) setupTitle.textContent = "Choose your destination";
  if (setupSub) setupSub.textContent = "Search above, tap a quick hub, or tap anywhere on the map";

  if (state.destMarker) {
    state.map.removeLayer(state.destMarker);
    state.destMarker = null;
  }
  if (state.alertCircle) {
    state.map.removeLayer(state.alertCircle);
    state.alertCircle = null;
  }
  if (state.routeLine) {
    state.map.removeLayer(state.routeLine);
    state.routeLine = null;
  }
  if (state.routeLineOutline) {
    state.map.removeLayer(state.routeLineOutline);
    state.routeLineOutline = null;
  }
  document.getElementById("roadStats").textContent = "";
}

// Alert Radius Visual Circle
function updateAlertCircle() {
  if (!state.map || !state.selectedDest) return;
  const alertKm = parseFloat(document.getElementById("alertDistance").value) || 1.5;
  const radiusMeters = alertKm * 1000;

  if (!state.alertCircle) {
    state.alertCircle = L.circle([state.selectedDest.lat, state.selectedDest.lng], {
      radius: radiusMeters,
      color: "#EA4335",
      weight: 2,
      dashArray: "6, 8",
      fillColor: "#EA4335",
      fillOpacity: 0.12
    }).addTo(state.map);
  } else {
    state.alertCircle.setLatLng([state.selectedDest.lat, state.selectedDest.lng]);
    state.alertCircle.setRadius(radiusMeters);
  }

  const hint = document.getElementById("alertRadiusHint");
  if (hint) hint.textContent = `Alerts ${alertKm.toFixed(1)} km before stop`;
  const navAlert = document.getElementById("navAlertZoneText");
  if (navAlert) navAlert.textContent = `Alarm set for ${alertKm.toFixed(1)} km`;
}

// Fit Route Bounds
function fitRouteBounds() {
  if (!state.map) return;
  const points = [];
  if (state.userCoords) points.push([state.userCoords.lat, state.userCoords.lng]);
  if (state.selectedDest) points.push([state.selectedDest.lat, state.selectedDest.lng]);

  if (points.length === 2) {
    const bounds = L.latLngBounds(points);
    state.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
  } else if (points.length === 1) {
    state.map.flyTo(points[0], 14);
  }
}

// ---------- Alert Distance Controls & Presets ----------
function setAlertDistance(val) {
  const num = Math.max(0.2, Math.min(10.0, parseFloat(val) || 1.5));
  const hiddenInput = document.getElementById("alertDistance");
  const displayVal = document.getElementById("alertDistanceVal");
  if (hiddenInput) hiddenInput.value = num.toFixed(1);
  if (displayVal) displayVal.textContent = num.toFixed(1);

  // Update preset chips active state
  document.querySelectorAll(".preset-chip").forEach((chip) => {
    const km = parseFloat(chip.dataset.km);
    chip.classList.toggle("active", Math.abs(km - num) < 0.05);
  });

  updateAlertCircle();
}

document.getElementById("decAlertDist")?.addEventListener("click", () => {
  const current = parseFloat(document.getElementById("alertDistance").value) || 1.5;
  setAlertDistance(current - 0.2);
});

document.getElementById("incAlertDist")?.addEventListener("click", () => {
  const current = parseFloat(document.getElementById("alertDistance").value) || 1.5;
  setAlertDistance(current + 0.2);
});

document.querySelectorAll(".preset-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    setAlertDistance(chip.dataset.km);
  });
});

// ---------- Search & Autocomplete ----------
let searchDebounce = null;
const destInputEl = document.getElementById("destInput");
const clearDestInputBtn = document.getElementById("clearDestInputBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");

destInputEl.addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  if (clearDestInputBtn) clearDestInputBtn.classList.toggle("hidden", !q);

  if (q.length < 2) {
    document.getElementById("destResults").innerHTML = "";
    return;
  }
  searchStopDirectory(q);
  searchDebounce = setTimeout(() => searchNominatim(q), 300);
});

destInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (state.selectedDest) {
      startJourney();
    } else {
      const topStop = latestStopMatches[0] || filterBundledStops(destInputEl.value.trim())[0];
      if (topStop) {
        selectDestination(topStop);
        startJourney();
      }
    }
  }
});

clearDestInputBtn?.addEventListener("click", () => {
  destInputEl.value = "";
  clearDestInputBtn.classList.add("hidden");
  document.getElementById("destResults").innerHTML = "";
});

clearSelectionBtn?.addEventListener("click", () => {
  clearSelectedDestination();
});

// Quick Tamil Nadu Hub Pills
document.querySelectorAll(".hub-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const name = chip.dataset.dest;
    const lat = parseFloat(chip.dataset.lat);
    const lng = parseFloat(chip.dataset.lng);
    selectDestination({ name, district: "Tamil Nadu", lat, lng });
  });
});

let latestStopMatches = [];
let latestGeoMatches = [];

async function searchStopDirectory(q) {
  try {
    const { stops } = await api(`/stops?prefix=${encodeURIComponent(q)}&limit=8`, { auth: false });
    latestStopMatches = stops && stops.length > 0 ? stops : filterBundledStops(q);
    renderDestResults();
  } catch (e) {
    latestStopMatches = filterBundledStops(q);
    renderDestResults();
  }
}

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
    box.innerHTML = '<p class="lead" style="padding:12px 16px; margin:0; font-size:0.85rem;">No matching bus stops. Keep typing...</p>';
    return;
  }

  let html = "";

  if (hasStops) {
    html += '<div class="search-section-header">🚌 Tamil Nadu Bus Stands</div>';
    html += latestStopMatches
      .map(
        (s, i) =>
          `<div class="stop-row" data-kind="stop" data-i="${i}">
            <div class="stop-row-icon">🚏</div>
            <div class="stop-row-info">
              <div class="name">${escapeHtml(s.name)}</div>
              <div class="meta">${escapeHtml(s.district || "Tamil Nadu")}</div>
            </div>
          </div>`
      )
      .join("");
  }

  if (hasGeo) {
    html += '<div class="search-section-header">📍 Places & Landmarks</div>';
    html += latestGeoMatches
      .map(
        (r, i) =>
          `<div class="stop-row" data-kind="geo" data-i="${i}">
            <div class="stop-row-icon">📍</div>
            <div class="stop-row-info">
              <div class="name">${escapeHtml(r.display_name.split(",")[0])}</div>
              <div class="meta">${escapeHtml(r.display_name)}</div>
            </div>
          </div>`
      )
      .join("");
  }

  box.innerHTML = html;

  [...box.querySelectorAll(".stop-row")].forEach((row) => {
    row.onclick = () => {
      const kind = row.dataset.kind;
      const i = Number(row.dataset.i);
      let destObj = null;
      if (kind === "stop") {
        const s = latestStopMatches[i];
        destObj = { name: s.name, district: s.district, lat: s.lat, lng: s.lng };
      } else {
        const r = latestGeoMatches[i];
        destObj = {
          name: r.display_name.split(",")[0],
          district: r.display_name.split(",")[1]?.trim() || "Tamil Nadu",
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon)
        };
      }
      selectDestination(destObj);
    };
  });
}

function escapeHtml(s) {
  return String(s || "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ==========================================================================
// Floating Map Controls Handlers
// ==========================================================================

const layerToggleBtn = document.getElementById("layerToggleBtn");
const layerPickerMenu = document.getElementById("layerPickerMenu");
const recenterBtn = document.getElementById("recenterBtn");
const searchLocateBtn = document.getElementById("searchLocateBtn");
const fitRouteBtn = document.getElementById("fitRouteBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");

layerToggleBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  layerPickerMenu?.classList.toggle("hidden");
});

document.addEventListener("click", () => {
  layerPickerMenu?.classList.add("hidden");
});

document.querySelectorAll(".layer-option-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const layer = btn.dataset.layer;
    setMapLayer(layer);
    layerPickerMenu?.classList.add("hidden");
  });
});

recenterBtn?.addEventListener("click", () => {
  locateUserPosition(true);
});

searchLocateBtn?.addEventListener("click", () => {
  locateUserPosition(true);
});

fitRouteBtn?.addEventListener("click", () => {
  fitRouteBounds();
});

zoomInBtn?.addEventListener("click", () => {
  if (state.map) state.map.zoomIn();
});

zoomOutBtn?.addEventListener("click", () => {
  if (state.map) state.map.zoomOut();
});

// ==========================================================================
// Active Journey Tracking Engine
// ==========================================================================

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

// Screen Wake Lock
async function requestWakeLock() {
  if ("wakeLock" in navigator && !state.wakeLock) {
    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
      console.log("SafeSleep: Screen Wake Lock active.");
    } catch (err) {
      console.warn("Screen Wake Lock notice:", err.message);
    }
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
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

  if (!state.selectedDest) {
    const typed = (document.getElementById("destInput").value || "").trim();
    const match = latestStopMatches[0] || filterBundledStops(typed)[0] || latestGeoMatches[0];
    if (match) {
      selectDestination(match);
    } else {
      if (errEl) errEl.textContent = "Please select your destination bus stand first.";
      return;
    }
  }

  if (!("geolocation" in navigator)) {
    if (errEl) errEl.textContent = "This device does not support GPS location.";
    return;
  }

  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch (e) {}

  try {
    requestWakeLock();
  } catch (e) {}

  state.alarmTriggered = false;
  state.initialJourneyDistance = null;

  // Swap Bottom Cards: Setup -> Journey HUD
  document.getElementById("setupCard").classList.add("hidden");
  document.getElementById("journeyCard").classList.remove("hidden");
  document.getElementById("destName").textContent = state.selectedDest.name;
  document.getElementById("statusPill").textContent = "Acquiring GPS transit fix…";
  document.getElementById("statusPill").classList.remove("alert");

  // Collapse search dropdown
  document.getElementById("destResults").innerHTML = "";

  try {
    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 4000,
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
  document.getElementById("roadStats").textContent = "";
  const progBar = document.getElementById("alertProgressBar");
  if (progBar) progBar.style.width = "0%";
}

function onPositionError(err) {
  console.warn("GPS Tracking notice:", err);
  const pill = document.getElementById("statusPill");
  if (pill) {
    pill.textContent = "GPS waiting: " + (err.message || "Please enable phone Location");
    pill.classList.add("alert");
  }
}

function onPosition(pos) {
  const { latitude, longitude } = pos.coords;
  state.userCoords = { lat: latitude, lng: longitude };
  const dest = state.selectedDest;
  if (!dest) return;

  const distanceKm = haversineKm(latitude, longitude, dest.lat, dest.lng);
  const alertThreshold = parseFloat(document.getElementById("alertDistance").value) || 1.5;

  if (state.initialJourneyDistance === null) {
    state.initialJourneyDistance = distanceKm;
  }

  // Update hero distance readout
  document.getElementById("distanceKm").textContent = distanceKm.toFixed(2);

  // Update visual progress bar towards wake-up perimeter
  const progBar = document.getElementById("alertProgressBar");
  if (progBar && state.initialJourneyDistance > alertThreshold) {
    const totalDist = state.initialJourneyDistance - alertThreshold;
    const remaining = Math.max(0, distanceKm - alertThreshold);
    const pct = Math.min(100, Math.max(0, ((totalDist - remaining) / totalDist) * 100));
    progBar.style.width = `${pct}%`;
  }

  // Status pill
  const pill = document.getElementById("statusPill");
  pill.classList.remove("alert");
  if (distanceKm <= alertThreshold) {
    pill.textContent = "⚠️ Wake-up Zone reached!";
    pill.classList.add("alert");
  } else {
    pill.textContent = `🟢 Tracking · Wake-up in ${(distanceKm - alertThreshold).toFixed(1)} km`;
  }

  // Update user marker
  updateUserMarker(latitude, longitude);

  // Refresh road route
  maybeRefreshRoute(latitude, longitude, dest);

  // Trigger Alarm when within threshold
  if (distanceKm <= alertThreshold && !state.alarmTriggered) {
    triggerAlarm(distanceKm, dest.name);
  }
}

// Draws realistic road-following route via OSRM
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
      drawRoute(null, [lat, lng], [dest.lat, dest.lng]);
    })
    .finally(() => {
      state.routeInFlight = false;
    });
}

async function fetchRoadRoute(lat1, lng1, lat2, lng2) {
  const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("OSRM routing request failed");
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
  if (!state.map) return;
  const path = latlngs || [from, to];
  if (state.routeLineOutline) state.map.removeLayer(state.routeLineOutline);
  if (state.routeLine) state.map.removeLayer(state.routeLine);

  // Google Maps Style Navigation Polyline
  state.routeLineOutline = L.polyline(path, {
    color: "#1557B0",
    weight: 8,
    opacity: 0.65,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(state.map);

  state.routeLine = L.polyline(path, {
    color: latlngs ? "#1A73E8" : "#FBBC04",
    weight: 5,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
    dashArray: latlngs ? null : "6 8"
  }).addTo(state.map);
}

function updateRoadStats(distanceMeters, durationSeconds) {
  const km = (distanceMeters / 1000).toFixed(1);
  const mins = Math.round(durationSeconds / 60);
  const statsEl = document.getElementById("roadStats");
  if (statsEl) {
    statsEl.textContent = `Road distance: ${km} km · ETA ~${mins} min`;
  }
}

// ==========================================================================
// Audio & Alarm Engine (Web Audio API + Dual Sirens + Vibration)
// ==========================================================================

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
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;
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
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    cachedAlarmWavUri = "data:audio/wav;base64," + btoa(binary);
  } catch (err) {
    console.warn("WAV synthesis notice:", err);
  }
  return cachedAlarmWavUri;
}

function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  } catch (e) {}

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
  } catch (e) {}
}

document.addEventListener("click", () => unlockAudio(), { once: true });
document.addEventListener("touchstart", () => unlockAudio(), { once: true });

function playAlarmChirp() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

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
    } catch (err) {}
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
  if (state.alarmInterval) clearInterval(state.alarmInterval);
  playAlarmChirp();
  state.alarmInterval = setInterval(playAlarmChirp, 900);

  try {
    const audioEl = document.getElementById("alarmAudioFallback");
    if (audioEl) {
      if (!audioEl.src) {
        const uri = getAlarmWavDataUri();
        if (uri) audioEl.src = uri;
      }
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
    }
  } catch (e) {}
}

function triggerAlarm(distanceKm, destName) {
  state.alarmTriggered = true;
  const banner = document.getElementById("alarmBanner");
  if (banner) banner.classList.remove("hidden");

  const text = document.getElementById("alarmText");
  if (text) {
    text.textContent = `You are about ${distanceKm.toFixed(2)} km from ${destName}. Prepare to get off!`;
  }

  startVibrationLoop();

  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Wake up! Your stop is near.", {
        body: `About ${distanceKm.toFixed(2)} km from ${destName}.`,
        requireInteraction: true
      });
    }
  } catch (e) {}

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
  if (testBtn) testBtn.textContent = "🔔 Test Alarm";
  const testJourneyBtn = document.getElementById("testAlarmJourneyBtn");
  if (testJourneyBtn) testJourneyBtn.textContent = "🔔 Test Sound";

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
  if (testBtn) testBtn.textContent = "⏹️ Stop Test";
  const testJourneyBtn = document.getElementById("testAlarmJourneyBtn");
  if (testJourneyBtn) testJourneyBtn.textContent = "⏹️ Stop Test";

  startVibrationLoop();
  startAlarmAudioLoop();

  state.testAlarmTimer = setTimeout(() => {
    if (state.isTestingAlarm) {
      silenceAlarm();
    }
  }, 5000);
}

// ==========================================================================
// Bus Stop Directory & Tickets
// ==========================================================================

async function loadStops() {
  const sel = document.getElementById("districtFilter");
  try {
    const { districts } = await api("/stops/districts", { auth: false });
    sel.innerHTML =
      '<option value="">All districts</option>' +
      districts.map((d) => `<option value="${d}">${d}</option>`).join("");
  } catch (e) {
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
    stops = filterBundledStops(q, district);
  }

  if (!stops.length) {
    box.innerHTML = '<p class="lead" style="margin:10px 0;">No stops match yet. Raise a ticket below!</p>';
    return;
  }

  box.innerHTML = stops
    .map(
      (s, i) => `<div class="directory-stop-card">
        <div>
          <div style="font-weight:700; font-size:0.95rem; color:var(--ink-primary);">${escapeHtml(s.name)}</div>
          <div style="font-size:0.8rem; color:var(--ink-secondary); margin-top:2px;">📍 ${escapeHtml(s.district)}</div>
        </div>
        <button type="button" class="dir-navigate-btn" data-index="${i}">
          <span>🗺️ View on Map</span>
        </button>
      </div>`
    )
    .join("");

  box.querySelectorAll(".dir-navigate-btn").forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.index);
      const chosen = stops[idx];
      showView("dashboard");
      selectDestination({
        name: chosen.name,
        district: chosen.district,
        lat: chosen.lat,
        lng: chosen.lng
      });
    };
  });
}

document.getElementById("stopSearch")?.addEventListener("input", debounce(refreshStopsList, 300));
document.getElementById("districtFilter")?.addEventListener("change", refreshStopsList);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Tickets Logic
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
    document.getElementById("ticketUseLocation").textContent = "📍 Use Current Location";
    ticketLocation = null;
    errEl.style.color = "#1E8E3E";
    errEl.textContent = "Ticket submitted successfully! Thanks for improving the directory.";
  } catch (e) {
    errEl.style.color = "";
    errEl.textContent = e.message;
  }
};

async function loadTickets() {
  const subtitle = document.getElementById("ticketsSubtitle");
  if (subtitle) {
    subtitle.textContent =
      state.user?.role === "admin" ? "All tickets raised by users." : "Stops you have asked us to add.";
  }
  try {
    const { tickets } = await api("/tickets");
    const box = document.getElementById("ticketsList");
    if (!tickets.length) {
      box.innerHTML = '<p class="lead">No tickets submitted yet.</p>';
      return;
    }
    box.innerHTML = tickets
      .slice()
      .reverse()
      .map(
        (t) => `<div class="ticket-row">
          <div>
            <div style="font-weight:700;">${escapeHtml(t.stopName)}</div>
            <div style="font-size:0.8rem; color:var(--ink-secondary); margin-top:2px;">
              ${escapeHtml(t.district || "—")} · ${new Date(t.createdAt).toLocaleDateString()}
            </div>
          </div>
          <span class="badge ${t.status}">${t.status}</span>
        </div>`
      )
      .join("");
  } catch (e) {
    document.getElementById("ticketsList").innerHTML = '<p class="error-text">Could not load tickets.</p>';
  }
}

// Profile Logic
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
  } catch (e) {}
}

document.getElementById("saveProfileBtn").onclick = async () => {
  const name = document.getElementById("editName").value.trim();
  const phone = document.getElementById("editPhone").value.trim();
  const msg = document.getElementById("profileMsg");
  try {
    const { user } = await api("/auth/profile", { method: "PUT", body: { name, phone } });
    state.user = user;
    localStorage.setItem("bsa_user", JSON.stringify(user));
    msg.style.color = "#1E8E3E";
    msg.textContent = "Profile updated successfully.";
    loadProfile();
  } catch (e) {
    msg.style.color = "";
    msg.textContent = e.message;
  }
};

// ==========================================================================
// App Boot
// ==========================================================================

window.addEventListener("DOMContentLoaded", () => {
  initMap();
  setLoggedInUI(!!state.token);
});

// Immediate init if DOM ready
if (document.readyState === "complete" || document.readyState === "interactive") {
  initMap();
  setLoggedInUI(!!state.token);
}
