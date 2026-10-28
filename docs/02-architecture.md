# 02 — Architecture

## Overview

```
┌────────────────────────────┐        ┌──────────────────────────────────────────────┐
│ Kiosk tablet (/kiosk)      │  TLS   │ API  (Node 22 · Fastify · TypeScript)        │
│ React PWA + BiometricDriver│───────►│  modules/                                    │
│  · SecuGen WebAPI / Android│ device │   auth · tenants · employees · devices       │
│  · offline punch queue     │ token  │   attendance · payroll · penalties           │
└────────────────────────────┘        │   efficiency (order slips) · notes · stats   │
┌────────────────────────────┐  JWT   │   ai (Claude tool-use, read-only tools)      │
│ Admin web (/admin)         │───────►│   audit (append-only)                        │
│ dashboard · payroll · AI   │        └──────────────┬───────────────────────────────┘
└────────────────────────────┘                       │ Drizzle ORM
┌────────────────────────────┐  JWT                 ▼
│ Employee web (/me)         │───────►  PostgreSQL 16 (tenant_id on every row)
└────────────────────────────┘
```

* **Modular monolith.** One deployable API with strict module folders. Modules talk only through service functions, never through each other's tables. If needed, a module can later be split out (e.g. payroll workers).
* **Multi-tenancy.** Every table has `tenant_id`. The tenant always comes from the authenticated principal (JWT or device token), never from request input. Every query filters by `tenant_id`. Postgres Row-Level Security is planned as defense in depth.
* **Pure computation core.** `server/src/payroll/engine/*` and `server/src/penalties/engine.ts` are pure functions with no DB access, fully unit-tested. Services load the data and call the engine.

## Roles

| Role | Access |
|---|---|
| `owner` / `admin` | Everything: statistics, payroll create/edit/approve, penalties, devices, AI chat |
| `manager` | Attendance, notes, penalties (approve), payroll view and edit (not approve) |
| `employee` | `/me`: own week, lates, payslips (read-only) |
| kiosk device | `/api/kiosk/*` only: download templates, post punches, week summary |

## Security
- Passwords and PINs are hashed with Argon2id. JWTs are short-lived (12h).
- Kiosk device tokens are 256-bit random values, stored only as SHA-256 hashes. Admins can revoke them.
- Biometric templates are encrypted with AES-256-GCM. The key comes from the environment.
- Audit log is append-only. It records payroll line edits, attendance corrections, penalty decisions, and fingerprint enroll/delete, each with actor, before/after, reason, and IP.
- All input is validated with Zod. Rate limiting is applied to auth and kiosk endpoints.
- The AI assistant gets **read-only, tenant-scoped tools**. It cannot change data, and it only sees what the admin could see.

## Data model (core tables)
`tenants, branches, users, employees, work_schedules, devices, fingerprint_templates, attendance_punches, holidays, payroll_runs, payslips, payslip_lines, penalty_rules, penalties, order_slips, management_notes, audit_logs` — see `server/src/db/schema.ts`.

## Payroll lifecycle
```
draft ──(compute/re-compute)──► review ──(approve, admin)──► approved ──(mark paid)──► paid
   ▲                               │
   └─────────── reopen (admin, reason required, audited) ◄───┘
```
- In `draft` or `review`, any line can be edited, disabled, or added manually. Each change requires a reason and writes an audit entry (`who · when · field · old → new · reason`).
- Recompute keeps manual lines and disabled flags. Only auto-generated lines are regenerated.
- After `approved`, the run is locked.

## Roadmap after MVP
1. Leave management and schedules (rostering per branch)
2. Government reports: SSS R3/R5, PhilHealth RF-1, Pag-IBIG MCRF, BIR 1601-C, 2316, alphalist
3. Bank payroll file export (BDO, BPI, Metrobank formats), e-payslips via email/SMS
4. Loans and cash advances with amortization
5. POS integration (order slips pushed live from AI Manager POS)
6. Postgres RLS, SSO, 2FA for admins
