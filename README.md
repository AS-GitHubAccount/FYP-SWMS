# SWMS

Small warehouse management setup: an Express API in `backend/` and a bunch of static HTML screens in `prototypes/` (login, dashboard, inventory, purchasing, approvals, settings — whatever we wired up).

**What you need:** Node 18+ and MySQL (8.x is fine; older usually works if the SQL runs).

### Running the API

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your DB credentials and a real `JWT_SECRET`. If you want email (password reset, alerts, etc.), add the SMTP fields too.

```bash
npm install
```

Create the database and load schema — `backend/setup.sql` is the starting point, or use a dump if you already have one. Then:

```bash
npm start
```

The server listens on port 3000 by default. Handy links once it’s up:

- REST base: `http://localhost:3000/api`
- Swagger UI: `http://localhost:3000/api-docs-swagger`
- Older HTML API page: `http://localhost:3000/api-docs`

### Running the UI

The pages are plain HTML/JS. They talk to the API on port 3000; the logic for that is in `prototypes/js/app.js` (`API_BASE` / dev ports).

From the repo root, either:

```bash
./start_frontend.sh
```

…then open `http://localhost:8080/prototypes/login.html`, **or** run `./START_BOTH_SERVERS.sh` if you want the API and a static server in one go.

Live Server in VS Code (or anything similar) on `prototypes/login.html` also works. If the UI isn’t on the same port as the API, that’s fine — the JS still targets `localhost:3000` for API calls in the usual dev setup.

### Folders

- **`backend/`** — Express routes, DB pool, cron jobs, migrations/scripts as needed.
- **`prototypes/`** — Shared CSS/JS plus the actual pages.

### Putting it online (GitHub + Aiven + a host like Railway)

See **[DEPLOY.md](./DEPLOY.md)** for pushing to GitHub, wiring Aiven MySQL, and running the API on a public URL so others can use `https://…/login.html` without localhost.

Optional: if the UI and API are on **different** domains, set `window.__SWMS_API_BASE__` in `prototypes/js/api-config.js` (loaded before `app.js` on each page).

That’s it. If something 500s, check the terminal running `npm start` first; it’s almost always DB config or a missing table.
