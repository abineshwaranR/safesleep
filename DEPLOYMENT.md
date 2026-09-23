# SafeSleep Deployment Guide

This guide covers everything you need to deploy the **SafeSleep** application to production.

---

## ⚠️ Critical Prerequisite: HTTPS / SSL is Mandatory

SafeSleep relies on the browser's **Geolocation API** (`navigator.geolocation.watchPosition`) to track your bus journey and trigger alarms when you approach your destination.

> Modern browsers (Android Chrome, iOS Safari, desktop browsers) **strictly disable Geolocation on non-secure (`http://`) connections**, with the only exception being `localhost`.
> 
> **Any public deployment must have HTTPS enabled.**
> All managed platforms listed below (Render, Railway, Fly.io) provide free, automatic HTTPS certificates out of the box. If deploying to your own VPS, you must use Let's Encrypt / Certbot.

---

## Environment Variables

| Variable | Required | Description | Example |
|---|---|---|---|
| `PORT` | Optional (default: `3000`) | The port the Express HTTP server listens on (managed platforms set this automatically) | `3000` |
| `NODE_ENV` | Recommended | Environment mode | `production` |
| `JWT_SECRET` | **Required in Prod** | Strong secret string used to sign user authentication tokens | `a8f3b...99e` |
| `DB_PATH` | Optional | Custom path to the `db.json` database file (useful when mounting persistent volumes) | `/app/data/db.json` |

---

## Deployment Options

Choose the deployment method that best fits your infrastructure:

- [Option 1: Render.com (Easiest & Free)](#option-1-rendercom-easiest--free)
- [Option 2: Railway.app (Fast with Persistent Volumes)](#option-2-railwayapp)
- [Option 3: Docker & Docker Compose (Any Cloud / VPS)](#option-3-docker--docker-compose)
- [Option 4: Linux VPS with PM2 + Nginx + Let's Encrypt SSL](#option-4-linux-vps-with-pm2--nginx--lets-encrypt)

---

### Option 1: Render.com (Easiest & Free)

Render provides free hosting with automatic HTTPS and seamless Git deployment.

#### Steps:
1. **Push your repository to GitHub or GitLab**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for SafeSleep"
   git branch -M main
   git remote add origin https://github.com/<your-username>/safesleep.git
   git push -u origin main
   ```

2. **Log into Render**:
   - Go to [render.com](https://render.com) and create an account.
   - Click **New +** → **Web Service**.
   - Select **Build and deploy from a Git repository** and connect your GitHub repo.

3. **Configure the Web Service**:
   - **Name**: `safesleep`
   - **Region**: Choose the closest region (e.g., Singapore or Frankfurt for users in India)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

4. **Add Environment Variables**:
   Under the **Environment Variables** section, add:
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: *(Click 'Generate' or enter a long random string)*

5. **Deploy**:
   - Click **Create Web Service**.
   - Render will build and deploy your app. Once deployed, you will get a secure URL like `https://safesleep.onrender.com`.

*(Note: On Render's Free tier, the server spins down after 15 minutes of inactivity and restarts on the next request. For permanent data persistence across restarts, you can attach a Render Disk on their Starter tier or use Option 2 / Option 3).*

---

### Option 2: Railway.app

Railway offers instant deployment from GitHub and allows attaching persistent storage volumes so your `db.json` file is never lost.

#### Steps:
1. Go to [railway.app](https://railway.app) and log in with GitHub.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select your `safesleep` repository.
4. Go to **Variables** and add:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = `(a random secure string)`
5. *(Optional for persistence)*: In the service settings, click **Add Volume** and set the mount path to `/app/data`. Set `DB_PATH=/app/data/db.json`.
6. Go to **Settings** → **Networking** → Click **Generate Domain** (gives you a free `https://...up.railway.app` with SSL).

---

### Option 3: Docker & Docker Compose

SafeSleep comes pre-configured with a production-ready `Dockerfile` and `docker-compose.yml`. This works on any Linux server, AWS EC2, DigitalOcean droplet, Linode, or Hetzner VPS.

#### 1. Quick Start with Docker Compose:
On your server or local machine:
```bash
# Clone the repository
git clone <your-repo-url>
cd safesleep

# Copy example env and configure your secret
cp .env.example .env
# Edit .env to set a strong JWT_SECRET

# Start container with volume persistence
docker compose up -d --build
```

#### 2. Checking Status & Logs:
```bash
docker compose ps
docker compose logs -f safesleep
```

The database (`db.json`) is stored in the Docker volume `safesleep_data`, persisting all user accounts and stops across container updates.

---

### Option 4: Linux VPS with PM2 + Nginx + Let's Encrypt

If you have an Ubuntu/Debian VPS (e.g. AWS EC2, DigitalOcean, Hetzner, Linode) and a custom domain (e.g. `safesleep.yourdomain.com`):

#### 1. Install Node.js (v20 LTS):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git certbot python3-certbot-nginx
sudo npm install -g pm2
```

#### 2. Clone and Setup App:
```bash
sudo mkdir -p /var/www/safesleep
sudo chown -R $USER:$USER /var/www/safesleep
cd /var/www/safesleep
git clone <your-repo-url> .
npm install --omit=dev

# Create environment file
cat <<EOF > .env
PORT=3000
NODE_ENV=production
JWT_SECRET=$(openssl rand -hex 32)
EOF
```

#### 3. Start with PM2 (Auto-restart on reboot):
```bash
pm2 start server.js --name safesleep
pm2 save
pm2 startup
# (Run the sudo env command output by pm2 startup)
```

#### 4. Configure Nginx Reverse Proxy:
Create `/etc/nginx/sites-available/safesleep`:
```nginx
server {
    listen 80;
    server_name safesleep.yourdomain.com; # Replace with your domain

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/safesleep /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 5. Obtain Free SSL with Let's Encrypt:
```bash
sudo certbot --nginx -d safesleep.yourdomain.com
```
Certbot will automatically obtain and install the SSL certificate and configure HTTPS redirection.

---

## Post-Deployment Verification

1. **Verify Healthcheck**:
   Visit `https://<your-domain>/health` in your browser. It should return:
   ```json
   { "ok": true }
   ```

2. **Register the Admin Account**:
   - The **first account registered** on a fresh database automatically becomes an **admin**.
   - Open your deployed URL, click **Register**, and create your account right away.
   - As an admin, you can approve/reject missing-stop tickets and add stops directly.

3. **Test Geolocation on Mobile**:
   - Open the deployed `https://...` link on your phone (Chrome or Safari).
   - Tap **Start journey** or click to view location.
   - Accept the browser's location permission prompt to confirm that GPS tracking starts properly.

4. **Backing up Database**:
   - The database file is located at `data/db.json` (or the custom `DB_PATH`).
   - You can back it up anytime simply by copying this file:
     ```bash
     cp data/db.json data/db_backup_$(date +%Y%m%d).json
     ```
