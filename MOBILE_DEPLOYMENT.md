# SafeSleep Mobile Deployment Guide

SafeSleep can be deployed and used on mobile devices (Android & iOS) through two methods:

1. **Progressive Web App (PWA) [Instant & Recommended]**: Installs directly onto your phone from the browser with home screen icon, fullscreen mode, and offline caching — no APK compilation or app store approval needed.
2. **Native Android APK (Capacitor)**: Packages the application into an `.apk` file that can be installed on Android devices or published to the Google Play Store.

---

## Method 1: Progressive Web App (PWA) — Instant Installation

Once your backend is deployed over HTTPS (see [DEPLOYMENT.md](DEPLOYMENT.md)), users can install SafeSleep directly onto their mobile home screens in seconds.

### On Android (Google Chrome, Brave, Edge):
1. Open your deployed URL (e.g., `https://safesleep.onrender.com`) on your mobile browser.
2. Chrome will automatically display an **"Add SafeSleep to Home screen"** banner at the bottom.
3. If the banner doesn't appear, tap the **three dots menu (⋮)** in the top right corner.
4. Tap **"Install app"** or **"Add to Home screen"**.
5. SafeSleep is now installed in your phone's app drawer with its own launcher icon, splash screen, and fullscreen display without any browser address bars.

### On iPhone / iPad (iOS Safari):
1. Open your deployed URL (e.g., `https://safesleep.onrender.com`) in **Safari**.
2. Tap the **Share** button (the square icon with an upward arrow at the bottom).
3. Scroll down and tap **"Add to Home Screen"**.
4. Tap **Add** in the top right corner.
5. SafeSleep will appear as a standalone app icon on your iOS home screen.

### Mobile Features Included:
- **Screen Wake Lock**: Automatically prevents the phone screen from sleeping while a journey is active, ensuring continuous GPS tracking.
- **Offline Shell**: UI elements load instantly from local cache via the Service Worker (`sw.js`).
- **Web Audio & Vibration**: Triggers multi-pulse vibration and audio alarms when approaching your destination.

---

## Method 2: Automated Android APK Build via GitHub Actions (Zero Local Setup)

You don't need Android Studio or complex build tools installed on your local computer to generate an Android `.apk`. An automated cloud build workflow is included in `.github/workflows/build-apk.yml`.

### How to get your `.apk`:
1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "Configure mobile PWA and Capacitor APK build"
   git push origin main
   ```
2. **Open your repository on GitHub**:
   - Click on the **Actions** tab at the top.
   - You will see the workflow **Build Android APK** running.
3. **Download the APK**:
   - Click on the workflow run once it completes (takes ~2 minutes).
   - Under the **Artifacts** section at the bottom of the page, click **safesleep-debug-apk** to download the zip file.
   - Extract the zip file to get `app-debug.apk`.
4. **Install on Android Phone**:
   - Send `app-debug.apk` to your phone (via WhatsApp, Google Drive, USB, or email).
   - Tap the APK on your phone and tap **Install** (if prompted, enable "Allow installation from unknown sources" for your file manager/browser).

---

## Method 3: Build Android APK Locally with Android Studio

If you have Android Studio installed and want to build or modify the native project locally:

### 1. Install Capacitor dependencies:
```bash
npm install --save-dev @capacitor/core @capacitor/cli @capacitor/android
```

### 2. Initialize and sync the Android project:
```bash
npx cap add android
npx cap sync android
```

### 3. Open in Android Studio:
```bash
npx cap open android
```

### 4. Build the APK:
Inside Android Studio:
- Select **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**.
- Once finished, click **locate** to find your compiled `app-debug.apk`.

---

## Connecting the Standalone Mobile App to your Production Backend

When SafeSleep is run as a standalone native APK, `public/app.js` is pre-configured to dynamically look for your backend server.

You can set the backend API URL in either of two ways:

1. **Option A: Pre-configure in `public/app.js`**:
   In `public/app.js` (around line 3), set your deployed production URL:
   ```javascript
   const API = window.SAFE_SLEEP_API_URL || "https://safesleep.onrender.com/api";
   ```

2. **Option B: Set via Browser / Webview Console or LocalStorage**:
   The app checks `localStorage.getItem("bsa_api_url")`. You can configure it dynamically by running:
   ```javascript
   localStorage.setItem("bsa_api_url", "https://safesleep.onrender.com/api");
   ```

---

## Best Practices for Mobile Transit Alarms

1. **Location Permission**: When prompted on your phone, choose **"Allow while using app"** or **"Allow all the time"**.
2. **Battery Optimization**: On Android (Samsung, Xiaomi, OnePlus, etc.), long-press the SafeSleep app icon → App info → Battery → select **"Unrestricted"** or turn off battery optimization so the operating system doesn't suspend location updates in the background.
3. **Volume**: Make sure media volume is turned up so the alarm tone is audible when you wake up.
