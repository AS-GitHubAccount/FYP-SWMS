---
marp: true
theme: default
class: lead
paginate: true
footer: 'Smart Warehouse Management System (SWMS) — FYP'
style: |
  section { font-size: 28px; }
  section.lead h1 { font-size: 48px; }
  h2 { color: #1a365d; }
---

<!-- _class: lead -->
# Smart Warehouse Management System (SWMS)
### Final Year Project Presentation
**Duration:** ~20 minutes · **Speaker:** [Your Name] · **[Date]**

---

## Agenda
1. **Context & problem** — why warehouse software matters
2. **Goals & scope** — what this project delivers
3. **System overview** — main actors and workflows
4. **Architecture** — frontend, API, database, security
5. **Core features** — inventory, stock movement, purchasing, governance
6. **Implementation highlights** — APIs, batch logic, deployment
7. **Challenges & lessons learned**
8. **Demo** (if live) · **Conclusion & future work** · **Q&A**

*Approx. 1.5–2 min per major section; adjust pace to your slot.*

---

## Motivation
- Small warehouses and campus labs often rely on **spreadsheets** or ad-hoc tools.
- That leads to **stock-outs**, **expired stock**, **weak traceability**, and **slow approvals**.
- **SWMS** targets a **lightweight but structured** workflow: one place for **receiving**, **issuing**, **reservations**, and **purchasing**, with **role-based access** and **audit-friendly records**.

---

## Project objectives
| Objective | How SWMS addresses it |
|-----------|------------------------|
| **Centralized inventory** | Products, locations, quantities, batches |
| **Controlled movement** | Receiving, issuing (e.g. FEFO), bookings |
| **Procurement support** | Purchase requests, RFQs, purchase orders |
| **Governance** | Approvals, disposal requests, stock adjustments |
| **Usability & ops** | Web UI, REST API, Swagger docs, deployable stack |

---

## Scope (in / out)
**In scope**
- Web client (static HTML/JS) + **Node.js (Express)** REST API
- **MySQL** persistence; JWT authentication; ADMIN vs STAFF roles
- Dashboard, alerts, notifications, settings, multi-warehouse hooks

**Out of scope (typical FYP boundaries)**
- Hardware (barcode scanners, IoT) — optional future extension
- Full ERP/finance — only purchasing/inventory-related flows

---

## High-level architecture
```
[ Browser UI — prototypes/ HTML + JS ]
           |  HTTPS / JSON (CORS)
           v
[ Express API — /api/* , rate limiting, JWT ]
           |
           v
[ MySQL — products, inventory, batches, orders, users, ... ]
```

Optional: **hosted API** (e.g. Railway) + **managed MySQL** (e.g. Aiven); static UI can be served from the same host or separately via `api-config.js`.

---

## Technology stack
| Layer | Choice |
|-------|--------|
| **Frontend** | Static pages, shared CSS/JS, Chart.js, Lucide icons |
| **Backend** | Node 18+, Express, route modules per domain |
| **Data** | MySQL 8.x, relational schema + migrations/setup scripts |
| **Auth** | JWT, password hashing, optional email (SMTP) for reset |
| **Docs** | OpenAPI / **Swagger UI** at `/api-docs-swagger` |
| **Deploy** | Documented path: GitHub + cloud DB + Node host |

---

## Data model (conceptual)
- **Users** — identity, role (ADMIN / STAFF)
- **Products & inventory** — SKU, categories, min stock, **available / reserved**
- **Batches** — traceability, expiry-aware issuing (**FEFO** in issuing flow)
- **Suppliers & purchasing** — RFQs, purchase orders, price history, uploads
- **Operational records** — receiving, issuing, bookings, disposal, adjustments

*Relationships enforce integrity (e.g. batches tied to products).*

---

## Feature map — stock & traceability
- **Receiving** — record inbound stock with **batch** details (wizard-assisted flows in API).
- **Issuing** — outbound to recipients; **batch selection with FEFO** (First-Expired, First-Out).
- **Bookings** — reserve stock for future use with dates and purpose.
- **Stock adjustments** — controlled corrections with audit trail (via API routes).
- **Alerts** — low stock and operational notifications.

---

## Feature map — purchasing & compliance
- **Purchase requests → RFQs → Purchase orders** — structured procurement pipeline.
- **Approvals** — centralized approval views for sensitive actions.
- **Disposal requests** — formal path for write-offs or waste.
- **Price history** — track changes for reporting and accountability.
- **Multi-warehouse** — API routes support scaling beyond a single location.

---

## API design
- **RESTful** resources under `/api/...` (e.g. `products`, `inventory`, `batches`, `receiving`, `issuing`, `bookings`, `purchase-orders`, `approvals`, `dashboard`).
- **Authentication** on protected routes; **rate limiting** on `/api/`.
- **Swagger** for developers and examiners to explore endpoints without reading all source files.

---

## Security & configuration
- **Secrets** in environment (`.env`): DB credentials, `JWT_SECRET`, optional SMTP.
- **CORS** configured for web client origins.
- **Role-based** operations — admins manage users/settings; staff use day-to-day flows.
- **Static uploads** served under controlled paths (e.g. purchasing uploads).

---

## User interface highlights
- **Dashboard** — KPIs and charts for at-a-glance status.
- **Module pages** — inventory, purchasing history, suppliers, warehouses, reports.
- **Notifications** — bell icon and badge for pending items.
- **Responsive patterns** — sidebar navigation, shared layout and styles.

*Demo tip: log in as STAFF vs ADMIN to show permission differences.*

---

## Deployment (as documented in the repo)
1. **Source** on GitHub for version control and collaboration.
2. **Managed MySQL** (e.g. Aiven) — run `setup.sql` or provided Railway full setup.
3. **Node host** (e.g. Railway) — `npm install`, `npm start`, env vars for production.
4. **Frontend** — same origin static serve or separate static host; set `__SWMS_API_BASE__` if API is on another domain.

---

## Challenges & solutions (examples for discussion)
| Challenge | Response |
|-----------|----------|
| **Complex workflows** | Wizards and step-wise APIs for receiving/issuing/booking |
| **Stock correctness** | Batches, reservations, FEFO, adjustments |
| **CORS / API base URL** | Configurable API base for dev vs production |
| **Schema drift** | SQL setup scripts and documented migration path |

---

## Testing & validation
- **Manual E2E** — login, CRUD, receiving/issuing paths, approval flows.
- **API testing** — Swagger, Postman, or scripted calls against `/api`.
- **Seed data** — `seed.js` (if used) for repeatable demos.

*Mention any unit tests if you add them.*

---

## Results & contribution
- A **working prototype** of a **small warehouse / lab inventory** system with **realistic procurement and governance** features.
- **Clear separation** of UI, API, and database — maintainable and extensible.
- **Documentation** (README, DEPLOY, OpenAPI) supports **replication and assessment**.

---

## Limitations
- Static frontend — no SPA framework (trade-off: simplicity vs. component reuse).
- Performance tuning and load testing are **not** the main focus of a typical FYP.
- Integrations (accounting, shipping carriers) are **future work**.

---

## Future work
- Mobile-friendly **PWA** or native app for floor staff.
- **Barcode / QR** scanning for faster receiving and picking.
- **Reporting exports** (CSV/PDF) and richer analytics.
- **Automated tests** (CI) and staging environment.

---

## Conclusion
SWMS demonstrates **end-to-end** design: from **MySQL schema** and **Express APIs** to a **usable web UI** and **deployment story**, centered on **traceable stock** and **controlled processes**.

**Thank you — questions?**

---

<!-- Optional backup slide -->
## Backup: Live demo checklist
1. Show **login** and **role** (ADMIN vs STAFF).
2. Open **dashboard** — charts and summary.
3. Walk through **inventory** and **one** receiving or issuing flow (batch/FEFO).
4. Show **approvals** or **purchasing** screen.
5. Open **Swagger UI** — one GET and one POST.

---

## Backup: Q&A prompts
- Why **MySQL** vs NoSQL?
- How is **FEFO** implemented at batch level?
- How would you **scale** reads (caching, read replicas)?
- How do you **protect** JWT and refresh tokens in production?
