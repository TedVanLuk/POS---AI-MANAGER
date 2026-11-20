# AI Manager

A multi-tenant management platform for Philippine (and international) hospitality businesses, with two main layers:

- **AI Manager HR**: people, time, pay and performance
- **AI Marketing CRM**: a separate app at `/crm` with its own gold-on-black design, built around the venue's customers: customer database, spending performance, loyalty, VIP tables, campaigns, automations and measured retention

The HR layer covers:

- Fingerprint time-in/out on a tablet kiosk
- Automated PH payroll with an audited review/edit workflow
- Penalty rules
- Server (waiter) efficiency from order-slip serials
- Management notes and "fighter card" performance stats
- An AI manager chat over live data

| Area | What's built |
|---|---|
| **1. Time in / out (fingerprint)** | `/kiosk` tablet PWA: big clock, 1:N fingerprint identification, auto IN/OUT, PIN fallback, offline queue with idempotent sync, "My week" view (days worked and lates). Reader drivers: SecuGen WebAPI, Android native bridge, simulator. |
| **2. Automated payroll** | Payroll is computed from punches: OT, night diff, rest day and holiday premiums, late/undertime/absence, SSS/PhilHealth/Pag-IBIG, BIR withholding tax, 13th-month accrual. Each component can be switched off per tenant or per payslip line. Every manual edit records **who, when, old → new, and why**. The run follows draft → review → approved (locked) → paid. |
| **3. Penalties** | Rules (late tiers, habitual tardiness, AWOL, missing time-out) and manual disciplinary deductions go through pending → approved / waived. Approved penalties are deducted automatically. |
| **4. Efficiency, notes & stats** | Order slips (OS) per server: throughput, service time, voids, sales/hour, and **missing serial detection**. Management notes (commendation, coaching, warning, incident). **Fighter cards** (OVR + PUN/ATT/SPD/HUS/SAL/DIS/REP radar). |
| **5. AI Marketing CRM** (`/crm`, separate app) | **Command center** (revenue by tier, daily revenue, night × hour heat map, segments, health gauges, top and slipping customers). **Customer database** with filters, sortable columns and CSV copy. **Spending performance**: concentration (Pareto), spend bands, tiers, segments, categories, frequency × ticket, growers/decliners, leaderboard. Guest profiles with spend, visit rhythm, preferences, **auto-tags** and **tiers** (SevenRooms-style). **Counter check-in** by mobile number with points and rewards (Square-style). **Tonight & tables**: VIP reservations vs minimum consumable, arrival recognition, promoter/VIP-host attribution. **Campaigns** with a **holdout group** and proven lift / incremental ₱ / ROI. **Automations** and one-click **playbooks** (nightclub VIP, café loyalty, shisha lounge; GoHighLevel-style). Data Privacy Act tooling: recorded opt-in, STOP handling, export and erasure. See [docs/05](docs/05-ai-marketing-crm.md). |
| **Access** | **Admin/owner/manager** web app with dashboard, statistics and AI chat. **Employee**: kiosk punch, plus `/me` with own week, lates, approved payslips and card. |

Docs:
- [Market research & SWOT](docs/01-market-research-swot.md)
- [Architecture](docs/02-architecture.md)
- [Fingerprint hardware](docs/03-hardware-fingerprint.md)
- [Payroll rules](docs/04-payroll-rules-ph.md)
- [AI Marketing / CRM: research, design and pilot plan](docs/05-ai-marketing-crm.md)

## Stack
TypeScript end-to-end:

- **Server:** Node 22 + Fastify + Drizzle ORM + PostgreSQL 16 (`server/`)
- **Web:** React 18 + Vite (`web/`), one app with three areas: `/admin`, `/kiosk`, `/me`
- **AI:** Claude (`@anthropic-ai/sdk`) with read-only, tenant-scoped tools

## Run locally
```bash
# 1. PostgreSQL
createuser -P aim            # password: aim
createdb -O aim aim_hr

# 2. Install & configure
npm install
cp server/.env.example server/.env
#   set JWT_SECRET and BIOMETRIC_KEY (openssl rand -base64 32); optionally ANTHROPIC_API_KEY for AI chat

# 3. Migrate + demo data
npm run db:seed              # runs migrations, then seeds "Mega Dance Center" (128 staff from the MDC schedule, October servers tracker, ~270 sample CRM guests)

# 4. Develop
npm run dev                  # API on :4000, web on :5173 (proxied)
# or production-style: npm run build && npm start   → everything on :4000
# HR at /admin, AI Marketing CRM at /crm

# Self-contained demos (no server): web/dist-demo/ai-manager-hr.html and web/dist-demo-crm/ai-marketing-crm.html
npm run build:demo -w web && npm run build:demo-crm -w web
```

Demo logins (from the seed):
| Role | Login |
|---|---|
| Owner/admin | `admin@demo.ph` / `Admin123!` |
| Manager | `manager@demo.ph` / `Manager123!` |
| Employee | `jane@demo.ph` / `Employee123!` |
| Kiosk device token | `demo-kiosk-token-change-me-0000000001` (simulator driver; staff PIN `1234`) |

## Tests
```bash
npm test        # attendance, payroll (PH statutory + premiums + overrides), penalty and CRM engines
npm run typecheck
```

## Project layout
```
server/src/
  attendance/   engine.ts (punches → day records), service.ts
  payroll/      engine.ts (PH payslip lines), statutory-ph.ts (tables), service.ts (runs, edits, audit)
  penalties/    engine.ts (rules), service.ts
  stats/        engine.ts (fighter card), service.ts (efficiency, serial gaps)
  crm/          engine.ts (tags, tiers, RFM, loyalty, consent, lift), core.ts, playbooks.ts, service.ts, messaging.ts (Semaphore SMS)
  ai/           assistant.ts (Claude tool runner)
  modules/      HTTP routes per area
  db/           schema.ts, migrations (../drizzle), seed.ts
web/src/
  kiosk/        Kiosk.tsx, drivers/ (secugen, android, simulator), queue.ts
  admin/        Dashboard, Attendance, Employees, Payroll, Penalties, Efficiency, Performance, AI, Settings
  crm/          AI Marketing CRM app: CrmApp (shell, login), Overview, Customers, Spending, charts, crm.css (own theme)
  marketing/    CRM screens reused by crm/: guest profile, counter, tonight & tables, campaigns, automations, settings
  me/           employee self-service
```
