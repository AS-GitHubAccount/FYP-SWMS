# Putting SWMS on GitHub + a public database (Aiven)

This is the path that actually lets other people use the app without running anything on their laptop: code lives on GitHub, the API runs on a host with a public URL, and MySQL sits on Aiven.

## 1. Push the project to GitHub

From your machine (already a git repo):

```bash
cd /path/to/FYP-SWMS
git status
```

Make sure **`.env` is not tracked** (it should be ignored under `backend/.env`). Never commit real passwords or `JWT_SECRET`.

Create an empty repo on GitHub (no README if you already have one locally), then:

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git add -A
git commit -m "Initial push"
git push -u origin main
```

If `origin` already exists, use `git remote set-url origin ...` instead.

## 2. Aiven MySQL

1. In [Aiven](https://aiven.io/), create a **MySQL** service.
2. Pick a region close to where you will run the API (same cloud/region as Railway helps latency).
3. Under the service → **Overview**, note **Host**, **Port**, **User**, **Password**, **Database name** (often `defaultdb`).
4. **Networking / IP filter**: Railway (and similar) use changing egress IPs. For a student/demo deployment, people often allow `0.0.0.0/0` and rely on a strong password + TLS. Tighten this later if you move to fixed IPs.
5. **TLS**: Download the CA certificate from the Aiven console. In this project you can put it at `backend/certs/aiven-ca.pem` **only on the server** (do not commit secrets). Alternatively, for a quick test only, you can use `DB_SSL=true` and `DB_SSL_REJECT_UNAUTHORIZED=false` (weaker; not ideal for production).

## 3. Run the API on the internet (Railway example)

You need a process that runs `node backend/server.js` (or `npm start` from `backend/`) and exposes **one HTTPS URL**.

**Railway (typical flow)**

1. Sign in at [railway.app](https://railway.app/), **New project** → **Deploy from GitHub** → select this repo.
2. Add a **service** from the repo. Set **Root directory** to `backend` (important so `npm install` sees `backend/package.json`).
3. **Variables** (same names as `.env.example`):

| Variable | Example / note |
|----------|----------------|
| `DB_HOST` | From Aiven |
| `DB_PORT` | From Aiven |
| `DB_USER` | From Aiven |
| `DB_PASSWORD` | From Aiven |
| `DB_NAME` | From Aiven |
| `DB_SSL` | `true` for Aiven |
| `DB_SSL_CA` | `certs/aiven-ca.pem` if you upload the CA file into the deploy filesystem, or omit and use reject-unauthorized flag below |
| `DB_SSL_REJECT_UNAUTHORIZED` | `false` only if you cannot ship the CA file yet (temporary) |
| `JWT_SECRET` | Long random string |
| `PORT` | Usually **unset**; Railway sets `PORT` automatically |
| `FRONTEND_BASE_URL` | Your **public** site URL, e.g. `https://your-app.up.railway.app` (used in password-reset / invite links) |

4. **Build / Start**: start command `npm start` (default if `package.json` has it).

5. After deploy, open your Railway URL. This server already serves:

   - API: `https://YOUR_HOST/api/...`
   - UI: `https://YOUR_HOST/login.html` or `https://YOUR_HOST/prototypes/login.html`

So **you do not need localhost** and you often **do not need to edit `api-config.js`**: the browser and API share the same origin.

6. **Database schema**: connect with MySQL client using Aiven credentials and run `backend/setup.sql` (and any migrations you rely on), or use `npm run db:import` locally pointed at Aiven if you have a full dump. The app expects tables to exist before users hit the UI.

**Other hosts** (Render, Fly.io, etc.) follow the same idea: run `npm start` from `backend`, set the same env vars, use the platform’s public URL.

## 4. If the UI is on a *different* domain than the API

Example: static site on GitHub Pages, API on Railway.

1. Uncomment and set in `prototypes/js/api-config.js`:

   `window.__SWMS_API_BASE__ = 'https://your-api.up.railway.app/api';`

2. Ensure every HTML page loads `api-config.js` **before** `app.js` (this repo adds that tag on the prototype pages).

3. CORS: the backend currently allows any origin for prototyping. Before a real production launch, restrict `origin` in `server.js` to your GitHub Pages URL.

## 5. Quick checks

- `GET https://YOUR_HOST/health` or `/api/health` (whatever you expose) — should not 502.
- Open `https://YOUR_HOST/login.html` and try logging in.
- If the DB is wrong, the server logs on Railway will show connection errors; fix `DB_*` and redeploy.

That’s the full loop: **GitHub for code**, **Aiven for MySQL**, **Railway (or similar) for the Node process + static UI**, same public URL for friends to try.
