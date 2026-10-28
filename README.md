# AI Manager HR

A multi-tenant HR platform for Philippine (and international) businesses. It covers:

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
| **Access** | **Admin/owner/manager** web app with dashboard, statistics and AI chat. **Employee**: kiosk punch, plus `/me` with own week, lates, approved payslips and card. |

Docs:
- [Market research & SWOT](docs/01-market-research-swot.md)
- [Architecture](docs/02-architecture.md)
- [Fingerprint hardware](docs/03-hardware-fingerprint.md)
- [Payroll rules](docs/04-payroll-rules-ph.md)

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
npm run db:seed              # runs migrations, then seeds "Demo Restaurant PH"

# 4. Develop
npm run dev                  # API on :4000, web on :5173 (proxied)
# or production-style: npm run build && npm start   → everything on :4000
```

Demo logins (from the seed):
| Role | Login |
|---|---|
| Owner/admin | `admin@demo.ph` / `Admin123!` |
| Manager | `manager@demo.ph` / `Manager123!` |
| Employee | `juan@demo.ph` / `Employee123!` |
| Kiosk device token | `demo-kiosk-token-change-me-0000000001` (simulator driver; staff PIN `1234`) |

## Tests
```bash
npm test        # attendance, payroll (PH statutory + premiums + overrides) and penalty engines
npm run typecheck
```

## Project layout
```
server/src/
  attendance/   engine.ts (punches → day records), service.ts
  payroll/      engine.ts (PH payslip lines), statutory-ph.ts (tables), service.ts (runs, edits, audit)
  penalties/    engine.ts (rules), service.ts
  stats/        engine.ts (fighter card), service.ts (efficiency, serial gaps)
  ai/           assistant.ts (Claude tool runner)
  modules/      HTTP routes per area
  db/           schema.ts, migrations (../drizzle), seed.ts
web/src/
  kiosk/        Kiosk.tsx, drivers/ (secugen, android, simulator), queue.ts
  admin/        Dashboard, Attendance, Employees, Payroll, Penalties, Efficiency, Performance, AI, Settings
  me/           employee self-service
```
