# 💍 Wedding Uploader

> A beautiful, privacy-first, self-hosted web app for guests to upload photos and videos and leave lovely messages on your wedding day.

[![Docker](https://img.shields.io/badge/docker-ready-blue.svg?logo=docker&logoColor=white)](https://www.docker.com/)
[![Python 3.11](https://img.shields.io/badge/python-3.11-brightgreen.svg?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/framework-flask-black.svg?logo=flask&logoColor=white)](https://palletsprojects.com/p/flask/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Features

- **📱 Frictionless for Guests**: No apps to download, no accounts to create, and no social media logins. Guests simply scan a QR code on their table or invitation and upload directly from their phone camera roll.
- **🎨 Romantic, Elegant UI**: Crafted with modern typography (*Playfair Display* & *Inter*), soft organic background animations, celebration confetti on completion, and full mobile optimization.
- **💌 Integrated Digital Guestbook**: Guests can leave personal notes and heartfelt wishes alongside their photos or as a standalone message. Messages are safely recorded in real time with server timestamps in `_Guest Messages.txt`.
- **⚡ Fast Parallel Uploads**: Robust client-side queue uploading batches with live progress percentages, elapsed/ETA indicators, and transfer speeds.
- **🛡️ Collision-Proof & Safe**: Uploaded files are automatically stamped with the guest's name, timestamps, and cryptographic entropy hashes (`[Guest_]Original_YYYYMMDD-HHMMSS_xxxx.ext`) ensuring existing files are never overwritten.
- **🔄 Fault-Tolerant & Mobile-Friendly**: Handles unstable venue mobile connections with granular per-file retry options.
- **📊 Real-Time Activity Logging**: Maintains a dedicated `_activity.log` detailing upload times, client IPs, user agents, and file sizes for simple monitoring.
- **🔒 100% Self-Hosted & Private**: Your memories stay on your own hardware or server—no third-party cloud storage limits or privacy compromises.

---

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/pinkieseb/WeddingUploader.git
cd WeddingUploader
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Open `.env` in your text editor and customize your details:
```env
COUPLE_NAME=Sarah & Alex
EVENT_TITLE=Sarah & Alex's Wedding
EVENT_SUBTITLE=Share your moments from our special day
TZ=UTC
PORT=3000
MEDIA_UPLOAD_PATH=./media
```

### 3. Launch with Docker Compose
```bash
docker compose up -d --build
```
Your Wedding Uploader is now running at `http://localhost:3000`! All uploaded photos, videos, and guestbook messages will be saved into your designated `MEDIA_UPLOAD_PATH`.

---

## ⚙️ Configuration Reference

All settings can be configured in your `.env` file:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `COUPLE_NAME` | `Sarah & Alex` | Names of the couple displayed in headers, placeholders, and buttons. |
| `EVENT_TITLE` | `<COUPLE_NAME>'s Wedding` | Title displayed in browser tab and Open Graph social sharing cards. |
| `EVENT_SUBTITLE` | `Share your moments...` | Subtitle displayed under the couple's names. |
| `APP_URL` | `http://localhost:3000` | Canonical public URL used for Open Graph link previews (SMS / WhatsApp). |
| `TZ` | `UTC` | Timezone for timestamping guest messages and log records (e.g. `America/New_York`, `Europe/London`). |
| `PORT` | `3000` | Port on which the container web server listens. |
| `MEDIA_UPLOAD_PATH` | `./media` | Host directory where uploaded media, messages, and logs are saved. |
| `CONTAINER_NAME` | `wedding-uploader` | Name assigned to the Docker container. |
| `DUCKDNS_SUBDOMAINS` | `yoursubdomain` | Subdomain if using DuckDNS companion service. |
| `DUCKDNS_TOKEN` | *(empty)* | DuckDNS API token if using DuckDNS companion service. |
| `NPM_DATA_PATH` | `./NPM/data` | Path for Nginx Proxy Manager database and configs. |
| `NPM_LETSENCRYPT_PATH` | `./NPM/letsencrypt` | Path for Let's Encrypt SSL certificates. |

---

## 🌐 Deployment Scenarios

### Scenario A: Local Venue Network (Offline / Private Wi-Fi)
If your venue has local Wi-Fi without internet or you wish to keep everything strictly on a local network:
1. Connect your laptop or mini PC (e.g., Raspberry Pi) to the venue Wi-Fi.
2. Find your local IP (e.g., `192.168.1.150`).
3. Start the container with `docker compose up -d --build`.
4. Generate a QR code pointing to `http://192.168.1.150:3000`.
Guests connected to venue Wi-Fi can upload without internet access.

### Scenario B: Public Internet with Nginx Proxy Manager & DuckDNS (Included)
The included `docker-compose.yml` comes pre-configured with **Nginx Proxy Manager** and **DuckDNS**:
1. Sign up for a free account at [DuckDNS](https://www.duckdns.org) and create a subdomain (e.g., `ourwedding`).
2. Add your subdomain and token to `.env`:
   ```env
   DUCKDNS_SUBDOMAINS=ourwedding
   DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   APP_URL=https://ourwedding.duckdns.org
   ```
3. Forward ports `80` and `443` on your router to your host machine.
4. Run `docker compose up -d --build`.
5. Access Nginx Proxy Manager admin panel at `http://<your-host-ip>:81` (default login: `admin@example.com` / `changeme`).
6. Add a Proxy Host:
   - **Domain Names**: `ourwedding.duckdns.org`
   - **Scheme**: `http`
   - **Forward Hostname**: `wedding-uploader`
   - **Forward Port**: `3000`
   - **Block Exploits**: Enabled
   - **SSL Tab**: Request a new SSL certificate with Let's Encrypt, enable *Force SSL* and *HTTP/2 Support*.
7. In the **Advanced** tab of your Proxy Host in NPM, add:
   ```nginx
   client_max_body_size 0;
   proxy_read_timeout 600s;
   proxy_send_timeout 600s;
   ```
   *(This ensures guests can upload large batches of high-resolution 4K videos without HTTP 413 payload errors or timeouts).*

### Scenario C: Cloudflare Tunnel or Custom Reverse Proxy
If you already use Cloudflare Tunnels, Caddy, or Traefik:
- You only need the `wedding-uploader` service. You can comment out or remove the `nginx-proxy-manager` and `duckdns` services in `docker-compose.yml`.
- Make sure to disable client request body size limits (`client_max_body_size 0;` in Nginx or Cloudflare Tunnel max chunk settings) so multi-gigabyte video uploads pass through smoothly.

---

## 🖨️ Generating Table QR Codes

Make it effortless for guests to participate:
1. Take your public URL (e.g. `https://ourwedding.duckdns.org`).
2. Use any QR code generator (or a free online SVG generator).
3. Print tabletop cards or place a card inside the wedding program:
   > **Capture our day!**
   > Scan the QR code to share your photos, videos & wishes with the newlyweds.

---

## 📁 Storage Structure

All files are saved into your configured `MEDIA_UPLOAD_PATH`:

```text
uploads/
├── Aunt_Mary_IMG_3042_20261014-162030_a1b2c3d4.jpg
├── Uncle_Bob_VID_9821_20261014-162215_e5f6g7h8.mov
├── IMG_1042_20261014-162540_9j0k1l2m.heic
├── _Guest Messages.txt
└── _activity.log
```

- **`_Guest Messages.txt`**: Chronological guestbook containing heartfelt messages with timestamps and sender names.
- **`_activity.log`**: Detailed audit log showing transfer timings, file sizes, IP addresses, and user agents for troubleshooting.

---

## 🎨 Customizing Styles & Branding

- **Fonts & Colors**: You can tweak colors, fonts, card dimensions, and animations in [src/static/styles.css](src/static/styles.css) via the CSS variables in `:root`.
- **Favicon & Social Sharing Image**: Replace `og-share.png`, `apple-touch-icon.png`, and `favicon.png` in [src/static/](src/static/) with photos of the couple to personalize WhatsApp/iMessage link previews.

---

## 💻 Local Development (Without Docker)

If you wish to run or develop locally:

```bash
# 1. Create a Python virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create .env from template
cp .env.example .env

# 4. Run Flask development server
python src/app.py
```
Visit `http://localhost:3000` in your browser.

---

## 📄 License

This project is open-source under the [MIT License](LICENSE). Feel free to use, modify, and share it for your own wedding or celebration!
