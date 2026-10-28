# 01 — Market Research, SWOT & Chosen Structure

> Scope: HR / timekeeping / payroll systems used by Philippine SMEs (restaurants, retail, service businesses) and international comparables.
> Research date: October 2026. Statutory figures and vendor positioning must be re-verified before go-live.

## 1. Systems compared

| System | Origin / focus | Time & attendance | PH payroll compliance | Biometrics | AI | Typical price* | Notes |
|---|---|---|---|---|---|---|---|
| **Sprout Solutions** (Sprout HR + Payroll) | PH-native, SME→enterprise | Strong (web/mobile, geofence, integrations) | Deep (SSS, PhilHealth, Pag-IBIG, BIR forms, 13th month) | Integrates with 3rd-party biometric terminals | Some analytics | ≈ ₱7,900–10,000/mo starter (10 emp) | Market leader in PH; heavy implementation, priced per head |
| **PayrollHero** | PH/SEA, shift-heavy retail & F&B | Very strong (selfie clock-in on tablet, schedules) | Good | Facial/selfie on iPad, not fingerprint | Limited | Per employee/month | Best UX for multi-branch shift work; selfie can be spoofed/buddy-punched |
| **GreatDay HR** | Indonesia → PH | Mobile-first, face + GPS | Good | Face (phone) | Limited | Per employee | Frontline-oriented, mobile-only clock-in |
| **Salarium** | PH | Basic | Good historically | — | — | — | 2026 reports of being scaled back/discontinued — risky choice |
| **Omni HR** | SEA (SG/PH) | Moderate | Good | — | Some | Per employee | Good for multi-country SEA expansion |
| **ZKTeco BioTime / ZKBio** | China, hardware vendor | Strong (device-driven) | Weak (needs export to payroll) | Native (own terminals) | — | Device cost + license | Excellent hardware, poor payroll/HR UX; the de-facto "biometric + Excel" setup in PH |
| **BambooHR** | US, SMB HRIS | Moderate | None for PH | — | Some | USD per employee | Great employee records/UX, no PH payroll |
| **Gusto / Rippling** | US | Good | None for PH (Rippling global via EOR) | — | Rippling has AI | USD per employee | Best-in-class automation/audit, US-centric |
| **Deputy / Connecteam** | AU / IL, shift workforce | Excellent scheduling & kiosk mode | None for PH | Kiosk PIN/face | Some | USD per user | Kiosk-tablet model we want to copy, without payroll |
| **Workday / SAP SuccessFactors** | Enterprise | Excellent | Via partners | Via partners | Strong | Enterprise contract | Over-scaled for SMEs |

\* Indicative ranges from vendor/comparison sites; not quotes.

### Key observations
1. **Nobody in the PH SME segment combines** cheap USB fingerprint on a tablet + native PH payroll + management/performance tooling + AI. Businesses usually run *ZKTeco device → Excel → Sprout/manual payroll*, which is where errors and disputes come from.
2. **Audit trail on payroll edits** is a premium feature (Rippling, Workday). Most PH SME tools let admins edit payslips with weak "who/why" tracking.
3. **Selfie/face clock-in** (PayrollHero, GreatDay) is convenient but is weaker against buddy punching than fingerprint, and phone-based clock-in is hard to enforce on-site.
4. **Penalty/disciplinary automation** is rare as a first-class feature — usually manual adjustments.
5. **Frontline performance** (servers/waiters' order-slip throughput) lives in the POS, never in the HR system. Linking it to HR is a differentiator.

## 2. SWOT — competitive landscape (what we're up against)

| | |
|---|---|
| **Strengths (of incumbents)** | Proven statutory compliance and government-form generation (Sprout); large support teams; mature integrations (banks, accounting); trusted brands; mobile apps. |
| **Weaknesses (of incumbents)** | Per-employee pricing that hurts low-margin F&B/retail; biometrics are bolt-ons or separate vendors; weak audit trail on manual payroll edits; penalties handled manually; no POS/order-slip performance data; dated dashboards; little or no AI. |
| **Opportunities (for us)** | Tablet + ₱3–6k USB scanner instead of ₱10–25k terminals; one system from punch → payslip; transparent, explainable payroll lines; "fighter card" gamified performance; AI manager chat over HR data; later integrate with the AI Manager POS. |
| **Threats (to us)** | Statutory rate/tax changes (must be table-driven and versioned); Data Privacy Act (RA 10173) — biometrics are *sensitive personal information*; Labor Code Art. 113 limits wage deductions (penalties need legal review); hardware SDK lock-in; incumbents adding AI. |

## 3. SWOT — AI Manager HR (our product)

| | |
|---|---|
| **Strengths** | Single data model across attendance, payroll, penalties, performance; every payroll edit is attributed (who/when/old→new/reason); rule-driven PH computation with per-tenant component toggles; low hardware cost; AI chat that answers from live tenant data via tools (no data copying). |
| **Weaknesses** | New product — no government e-filing yet (SSS R3, BIR 1601-C/2316/alphalist planned); tablet kiosk depends on vendor SDK bridge for USB readers; initial single-region deployment. |
| **Opportunities** | Upsell POS integration (order slips already modeled); multi-branch chains; leave management, scheduling, loans, e-payslips via mobile; government report exports. |
| **Threats** | Rate-table drift → mitigated with effective-dated tables and tests; privacy incidents → encryption at rest, device-scoped access, audit logs, consent capture. |

## 4. Chosen structure (what we take from whom)

| Pattern | Borrowed from | How we apply it |
|---|---|---|
| **Kiosk tablet mode** with big clock, instant feedback | Deputy, PayrollHero | `/kiosk` route, registered device token, offline punch queue with idempotent UUIDs |
| **Device-agnostic biometric layer** | ZKTeco BioTime (device-centric), but abstracted | `BiometricDriver` interface: SecuGen WebAPI, DigitalPersona, Android native bridge, simulator |
| **Rule-driven PH payroll** | Sprout | Pure, unit-tested engine; effective-dated statutory tables; components can be switched off per tenant |
| **Payroll lifecycle + audit** | Rippling / Workday | `draft → review → approved → paid` (locks after approval); every manual line edit needs a reason and is written to `audit_logs` with before/after |
| **Penalties as reviewable records** | (gap in market) | Rules engine generates *pending* penalties; managers approve/waive; only approved ones hit payroll |
| **Performance data from operations** | (gap in market) | Order-slip (OS) serials per server → throughput, service time, voids, serial-gap detection → "fighter card" |
| **AI copilot over live data** | Rippling AI, Workday | Claude with read-only, tenant-scoped tools |

**Architecture choice:** multi-tenant SaaS, modular monolith (one API, clear module boundaries), PostgreSQL with `tenant_id` on every row, TypeScript end-to-end. A modular monolith keeps operations cheap for the first customers and lets modules split into services later if load requires — see `02-architecture.md`.

## Sources
- [KAMI Workforce — SSS/PhilHealth/Pag-IBIG tables 2026](https://kamiworkforce.com/ph/blog/sss-philhealth-pagibig-contribution-tables-2026/)
- [Asanify — How to pay SSS, PhilHealth, Pag-IBIG (2026)](https://asanify.com/blog/employer-of-record-philippines/how-to-pay-sss-philhealth-pagibig-philippines/)
- [SweldoPH — Philippine payroll rates 2026](https://sweldoph.com/payroll-rates-2026)
- [Sprout — Top payroll systems for PH SMEs & enterprises (2026)](https://sprout.ph/articles/top-payroll-systems-philippines-smes-enterprises/)
- [Omni HR — Sprout vs other HRIS](https://www.omnihr.co/faqs/compare-sprout-solutions-with-other-top-hris-for-the-philippines)
- [Akrivia HCM — Sprout alternatives 2026](https://akriviahcm.com/blog/sprout-alternatives-philippines-2026)
- [Hono — Best payroll software in PH 2026](https://www.hono.ai/blog/best-payroll-software-philippines)
- [Darwinbox — Payroll software PH](https://darwinbox.com/blog/payroll-software-philippines)
