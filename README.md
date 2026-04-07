# SWMS

Express API (`backend/`) and static HTML UI (`prototypes/`).

**Requirements:** Node 18+, MySQL 8 (or compatible).

### API

```bash
cd backend
cp .env.example .env
```

Set database credentials, `JWT_SECRET`, and optional email (SMTP or `RESEND_API_KEY` in `.env`).

```bash
npm install
```

Create the DB and apply schema from `backend/setup.sql` (or your dump). Then:

```bash
npm start
```

Default port: **3000**. API base: `http://localhost:3000/api`. Swagger: `http://localhost:3000/api-docs-swagger`.

### UI

Static pages; API URL is configured in `prototypes/js/api-config.js` (used with `app.js`).

From repo root:

```bash
./start_frontend.sh
```

Open `http://localhost:8080/prototypes/login.html`, or use `./START_BOTH_SERVERS.sh` for API + static server together.

### Layout

- `backend/` — routes, DB, jobs, migrations
- `prototypes/` — pages, shared CSS/JS

Production: run the API on your host with env vars set; point the UI at that API via `api-config.js` if the origin differs from localhost.
