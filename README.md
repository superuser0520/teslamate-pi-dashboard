# TeslaMate Raspberry Pi Stack

This folder contains a Raspberry Pi-ready TeslaMate setup for viewing Tesla data in TeslaMate and Grafana.

## What You Get

- TeslaMate web app on port `4000`
- Grafana dashboards on port `3001`
- Simple live dashboard on port `8080`
- PostgreSQL storage
- Mosquitto MQTT broker for TeslaMate integrations
- Helper scripts for setup, status, logs, backup, and updates
- Optional systemd unit for starting the stack at boot

## Raspberry Pi Requirements

Use a Raspberry Pi 3 or newer with a 64-bit Raspberry Pi OS. TeslaMate's Docker images support `aarch64` and `amd64`; `armv7` is no longer supported. Use at least 1 GB RAM, with 2 GB or more recommended.

Keep this on your home network or behind a secure remote-access layer such as Tailscale, WireGuard, Cloudflare Tunnel, ZeroTier, or a hardened reverse proxy. Do not expose TeslaMate directly to the public internet.

## Install On The Pi

1. Install Docker and Docker Compose v2 on the Raspberry Pi.
2. Clone this repo to the Pi, for example to `/opt/teslamate`.
3. Run:

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone https://github.com/superuser0520/teslamate-pi-dashboard.git teslamate
sudo chown -R "$USER":"$USER" /opt/teslamate
cd /opt/teslamate
chmod +x scripts/*.sh
./scripts/setup-pi.sh
```

4. Open TeslaMate:

```text
http://<raspberry-pi-ip>:4000
```

5. Sign in with your Tesla account in TeslaMate.
6. Open Grafana dashboards:

```text
http://<raspberry-pi-ip>:3001
```

Grafana starts with `admin` / `admin`; change the password when prompted.

7. Open the simple dashboard:

```text
http://<raspberry-pi-ip>:8080
```

The dashboard shows vehicle status, battery, range, charging, recent charge sessions, recent drives, 30-day statistics, climate, location, odometer, and self-hosted system status from the TeslaMate database.

The dashboard login defaults to:

```text
Username: soolihjing@icloud.com
```

The default password is built into the dashboard as a hash. To change it, generate a new hash locally and set `DASHBOARD_PASSWORD_HASH` in `.env`:

```bash
node -e "const crypto=require('crypto'); const salt=crypto.randomBytes(16).toString('hex'); const hash=crypto.scryptSync('new-password-here', salt, 64).toString('hex'); console.log(salt+':'+hash)"
```

## Tesla Account Setup

TeslaMate needs your Tesla account authorization so it can collect vehicle telemetry. Do not put Tesla credentials in `.env`, GitHub, Docker Compose, or this dashboard.

After the stack starts:

1. Open TeslaMate at `http://<raspberry-pi-ip>:4000`.
2. Follow the TeslaMate login flow in the browser.
3. Complete Tesla multi-factor authentication if prompted.
4. Wait for TeslaMate to discover your vehicle.
5. Open Grafana at `http://<raspberry-pi-ip>:3001` for the full dashboards.
6. Open the simple dashboard at `http://<raspberry-pi-ip>:8080` for a quick live view.

TeslaMate stores Tesla API tokens encrypted in PostgreSQL using `ENCRYPTION_KEY` from `.env`. Keep that `.env` file backed up somewhere private; losing it can make stored tokens unreadable.

## Daily Commands

```bash
./scripts/teslamate.sh status
./scripts/teslamate.sh logs
./scripts/teslamate.sh backup
./scripts/teslamate.sh update
./scripts/teslamate.sh restart
```

## Start At Boot

If you place the project at `/opt/teslamate`, install the systemd unit:

```bash
sudo cp systemd/teslamate.service /etc/systemd/system/teslamate.service
sudo systemctl daemon-reload
sudo systemctl enable teslamate
sudo systemctl start teslamate
```

Check it with:

```bash
sudo systemctl status teslamate
```

## Configure Ports Or Secrets

The setup script creates `.env` with generated secrets. To customize ports or credentials later:

```bash
nano .env
docker compose up -d
```

The dashboard uses a signed login cookie. Set `DASHBOARD_SESSION_SECRET` in `.env` before hosting publicly. `DASHBOARD_TOKEN` is still supported for API clients that send `Authorization: Bearer <token>`.

## Cloudflare Tunnel

The simplest option is to create a Cloudflare Tunnel in the Cloudflare dashboard that points to:

```text
http://dashboard:8080
```

Then set the generated token in `.env`:

```bash
nano .env
```

Start the tunnel container:

```bash
docker compose --profile tunnel up -d cloudflared
```

If you are running `cloudflared` directly on the Pi instead of in Docker, point it at the dashboard port:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /home/pi/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: tesla.example.com
    service: http://localhost:8080
  - service: http_status:404
```

Use Cloudflare Access in front of the hostname if this will be reachable from outside your home network. TeslaMate contains sensitive Tesla account and vehicle information.

Never commit `.env`; it contains the encryption key used to protect Tesla API tokens.
