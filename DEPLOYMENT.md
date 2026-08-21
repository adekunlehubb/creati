# 🚀 CreatiHub — Deployment Guide

CreatiHub is a **full-stack Node.js / Express** application (not a static site). It has:

- A backend API (`server.js`) serving `/api/*` endpoints
- A JSON file database (`data/db.json`) — needs a **persistent writable disk**
- An AI assistant (Nova) that runs locally (no external API keys needed)
- Optional Paystack payments (runs in DEMO mode without keys)

Because it needs a running Node process + persistent storage, deploy it to a host that supports Node.js apps. Below are three recommended platforms — all have free tiers and all let you **connect your own custom domain**.

---

## Default Login Credentials

| Role  | Email                  | Password   |
|-------|------------------------|------------|
| Admin | `admin@creatihub.com`  | `admin123` |
| Demo  | `demo@creatihub.com`   | `demo123`  |

> ⚠️ **Change these immediately after first deploy** — register a new admin or edit `data/db.json` on the server.

---

## ⭐ Option A — Render.com (Recommended, easiest)

Render has a free tier and built-in custom domains with automatic HTTPS.

### Steps
1. Push this project to a GitHub/GitLab repo (all files included: `server.js`, `db.js`, `ai.js`, `paystack.js`, `public/`, `data/`, `package.json`, `render.yaml`).
2. Go to **https://dashboard.render.com** → **New** → **Blueprint**.
3. Select your repo. Render reads `render.yaml` and creates the web service + a 1 GB persistent disk automatically.
4. Click **Apply**. The app builds (`npm install`) and starts (`node server.js`).
5. Once live, go to the service → **Settings** → **Custom Domain** → add `yourdomain.com`.
6. Render shows you a CNAME. In your domain registrar's DNS, add:
   ```
   CNAME  yourdomain.com  →  creatihub.onrender.com
   ```
   (or for an apex/root domain, use Render's ALIAS/redirect instructions)
7. Render provisions a free Let's Encrypt SSL cert automatically. Done — visit `https://yourdomain.com`.

### Set Paystack keys (optional, for real payments)
Service → **Environment** → add:
- `PAYSTACK_SECRET_KEY` = `sk_live_...`
- `PAYSTACK_PUBLIC_KEY` = `pk_live_...`
- `PAYSTACK_CALLBACK_URL` = `https://yourdomain.com/payment/callback`

> The persistent disk (`render.yaml` already configures it) keeps `data/db.json` across redeploys. **Free tier disks are not supported** — if you stay on free, the DB resets on each deploy. Use the **Starter** plan ($7/mo) for a persistent disk + no sleep.

---

## Option B — Railway.app

Railway is simple and fast, with a $5/mo trial credit and easy custom domains.

### Steps
1. Push the project to a GitHub repo.
2. Go to **https://railway.app** → **New Project** → **Deploy from GitHub repo**.
3. Railway auto-detects Node.js and uses `railway.json` / `Procfile` (`web: node server.js`).
4. Go to **Settings** → **Networking** → **Generate Domain** (gives you a `.up.railway.app` URL).
5. To add your custom domain: **Settings** → **Networking** → **Custom Domain** → enter `yourdomain.com`.
6. Railway shows a CNAME target. Add it in your DNS:
   ```
   CNAME  yourdomain.com  →  creatihub-production.up.railway.app
   ```
7. Railway provisions SSL automatically.

### Persistent DB on Railway
Railway has no built-in persistent disk for filesystem writes, so for production use a Railway **Volume** (available on paid plans) mounted at `/app/data`, **or** swap the JSON DB for a managed Postgres add-on. For a quick start the app self-seeds from `data/db-seed.json` on every boot, so it always works — but user registrations/orders won't persist across redeploys unless you attach a volume.

---

## Option C — Fly.io

Fly.io gives you a real persistent volume and global edge, great for custom domains.

### Steps
1. Install the Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. In the project folder:
   ```bash
   fly launch --no-deploy     # uses Dockerfile + fly.toml
   fly volumes create creatihub_data --size 1
   fly deploy
   ```
3. Add your custom domain + SSL:
   ```bash
   fly certs add yourdomain.com
   ```
   Fly shows the DNS records to add (A/AAAA/CNAME). Add them at your registrar.
4. Set Paystack env vars:
   ```bash
   fly secrets set PAYSTACK_SECRET_KEY=sk_live_... PAYSTACK_PUBLIC_KEY=pk_live_... PAYSTACK_CALLBACK_URL=https://yourdomain.com/payment/callback
   ```
5. Visit `https://yourdomain.com`. The 1 GB volume (`fly.toml` mounts it at `/data`) keeps `db.json` persistent across deploys.

---

## Connecting Your Custom Domain (General)

Regardless of platform, the flow is always:

1. **Buy/register a domain** (Namecheap, Cloudflare, GoDaddy, Google Domains, etc.).
2. **In your hosting platform**, add the custom domain and copy the CNAME/A record it gives you.
3. **In your domain registrar's DNS panel**, create the record pointing to the host.
4. Wait for DNS propagation (minutes to a few hours).
5. The platform auto-issues an SSL certificate (Let's Encrypt).
6. Set `PAYSTACK_CALLBACK_URL` to your final `https://yourdomain.com/payment/callback` so payment redirects work.

### If using Cloudflare for DNS
- Set the record to **DNS only (grey cloud)** first while the host validates, then enable proxy (orange cloud) if desired.
- Use a **CNAME** for `www` and a CNAME/ALIAS for the apex per your host's instructions.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No (defaults 3000) | Server port. Hosts set this automatically. |
| `NODE_ENV` | No | Set to `production`. |
| `DATABASE_URL` | **Recommended** | PostgreSQL connection string. When set, CreatiHub uses PostgreSQL for bulletproof persistence. When empty, it falls back to the JSON file (`data/db.json`). **Set this in production so user data is never lost.** |
| `PGSSL` | No | Set to `false` only for local Postgres without SSL. Production hosted Postgres (Render, Railway, Supabase, Neon) requires SSL and this should be left unset. |
| `PAYSTACK_SECRET_KEY` | No | Paystack secret key. Empty = DEMO mode (simulated payments). |
| `PAYSTACK_PUBLIC_KEY` | No | Paystack public key for the inline popup. |
| `PAYSTACK_CALLBACK_URL` | No | Full URL for payment redirect. Defaults to `http://localhost:3000/payment/callback`. Set to `https://yourdomain.com/payment/callback` in production. |

---

## 🛡️ Database Persistence — Choose Your Backend

CreatiHub supports **two database backends** and auto-selects based on the `DATABASE_URL` environment variable:

### Backend 1: JSON File (default, local/dev)
- Data stored in `data/db.json`
- **Works locally with zero setup**
- ⚠️ On ephemeral hosting (free tiers), the filesystem resets on every redeploy — **data will be lost**. Use this only for local development, or pair it with a persistent disk (Render's paid disk, Fly volumes).

### Backend 2: PostgreSQL (recommended for production) ⭐
- Set `DATABASE_URL` to a Postgres connection string
- **Bulletproof persistence**: survives redeploys, restarts, crashes, and scaling events
- The entire database state is stored as a JSONB document in a `creatihub_state` table
- Auto-creates the table and seeds default data on first boot
- No code changes needed — the server detects `DATABASE_URL` and switches automatically

### How to get a PostgreSQL database

**On Render.com** (easiest — same platform as your app):
1. In your Render dashboard, click **New → PostgreSQL**
2. Pick the Free tier (90 days) or Starter ($7/mo)
3. Copy the **Internal Database URL** (starts with `postgresql://`)
4. Add it as `DATABASE_URL` in your web service's Environment tab

**On Railway.app:**
1. Click **New → Database → Add PostgreSQL**
2. Railway auto-injects `DATABASE_URL` into your app — no manual config needed

**On Supabase** (free 500MB, generous):
1. Create a project at supabase.com
2. Go to Settings → Database → Connection string → URI
3. Copy the `postgresql://` URL and set it as `DATABASE_URL`

**On Neon** (free, serverless Postgres):
1. Create a project at neon.tech
2. Copy the connection string from the dashboard
3. Set it as `DATABASE_URL`

> ✅ **With PostgreSQL enabled, your users' accounts, orders, and subscriptions are permanently safe.** This is the single most important setting for a live website.

### Automatic daily backups (extra safety net)
Regardless of backend, CreatiHub takes a daily snapshot of the database. With the JSON backend these go to `data/backups/`. With PostgreSQL, the database itself is durable, but you can also use the admin **"Export all data"** button (Admin → Data & Backups) to download a full snapshot anytime.

---

## Local Development

```bash
npm install
npm start          # or: node server.js
# open http://localhost:3000
```

Copy `.env.example` to `.env` and fill in Paystack keys for real payments. Without keys the app runs fully in DEMO mode.

---

## Project Structure

```
creatihub/
├── server.js          # Express API + static serving
├── db.js              # JSON file database layer (self-seeds)
├── ai.js              # Nova AI assistant (local, no API keys)
├── paystack.js        # Paystack payment integration
├── public/            # Frontend (HTML/CSS/JS)
│   ├── index.html, services.html, order.html, dashboard.html
│   ├── admin.html, auth.html, guide.html, payment-callback.html
│   ├── css/style.css, css/guide.css
│   └── js/app.js
├── data/
│   ├── db-seed.json   # Seed data (admin, demo user, services, orders)
│   └── db.json        # Runtime DB (auto-created, git-ignored)
├── render.yaml        # Render.com blueprint
├── railway.json       # Railway config
├── Procfile           # Heroku/Railway start command
├── Dockerfile         # Fly.io / container deploys
├── fly.toml           # Fly.io app config (volume + custom domain)
├── .env.example       # Environment template
└── package.json
```

---

## Quick Recommendation

For the fastest path to a live site with your own domain:

**Render.com (Option A)** — push to GitHub → import as Blueprint → add custom domain in the dashboard. The `render.yaml` is pre-configured with a persistent disk so your data survives redeploys. Total setup time: ~10 minutes.
