# 04 — Payroll Computation Rules (Philippines)

The engine lives in `server/src/payroll/engine.ts` (pure, unit-tested in `engine.test.ts`). Statutory tables are effective-dated in `server/src/payroll/statutory-ph.ts`. **Verify the tables against the latest SSS, PhilHealth, HDMF and BIR circulars before each payroll year.**

## Rates
| Pay type | Daily rate | Hourly rate | Monthly basis (for contributions) |
|---|---|---|---|
| Monthly | monthly × 12 ÷ factor | daily ÷ 8 | monthly salary |
| Daily | rate | rate ÷ 8 | daily × factor ÷ 12 |
| Hourly | rate × 8 | rate | daily × factor ÷ 12 |

The factor is set per tenant: 261 for a 5-day week, 313 for a 6-day week.

## Attendance → pay (computed per day, in the tenant timezone)
- **Late** = minutes after schedule start. Only counts if the employee arrives after the grace period, and is then counted from the schedule start.
- **Undertime** = minutes before schedule end.
- **Overtime** = minutes after schedule end. Only counts if ≥ the minimum (default 30). Hours beyond 8 also count.
- **Break**: deducted automatically when there is a single long session (the employee didn't punch out for break).
- **Absent** = scheduled workday with no punches. Holidays, rest days, future days, and days before hire are never absent.
- **Missing time-out** = IN without OUT after 16 hours. It is flagged, not counted as worked.

## Premiums (Labor Code / DOLE Handbook on Workers' Statutory Monetary Benefits)
| Day type | Work (first 8h) | Overtime | Unworked |
|---|---|---|---|
| Ordinary day | 100% | 125% | — |
| Rest day | 130% | 130% × 130% | — |
| Special non-working day | 130% | 130% × 130% | No pay (no work, no pay) |
| Special day on rest day | 150% | 150% × 130% | — |
| Regular holiday | 200% | 200% × 130% | 100%, if present on the previous workday |
| Regular holiday on rest day | 260% | 260% × 130% | — |
| Night differential (22:00–06:00) | +10% of the applicable hourly rate | +10% of the OT rate | — |

For monthly-paid employees, holidays are already included in the salary. So only the premium portion is added (e.g. +100% for regular holiday work), and absences are deducted at the daily rate.

## Statutory deductions
| | Rate | Base | Notes |
|---|---|---|---|
| SSS (2025 schedule) | EE 5% · ER 10% | MSC ₱5,000–₱35,000, in ₱500 steps | Employer also pays EC: ₱10 if MSC < ₱15,000, else ₱30 |
| PhilHealth | 5%, split 50/50 | Basic salary, floor ₱10,000, ceiling ₱100,000 | |
| Pag-IBIG | EE 1% (if salary ≤ ₱1,500) or 2% · ER 2% | Capped at ₱10,000 | Max ₱200 each |
| Withholding tax | BIR TRAIN table (2023+), per pay frequency | Taxable pay − EE contributions − pre-tax deductions | Minimum-wage earners can be marked exempt |

Semi-monthly runs either split contributions 50/50 across both cutoffs, or deduct them in full on the 2nd cutoff (tenant setting).

## Order of computation
1. Earnings (basic, premiums, OT, ND, allowances)
2. Attendance deductions (absence, late, undertime)
3. Manual lines
4. SSS / PhilHealth / Pag-IBIG
5. Withholding tax on the resulting taxable income
6. Approved penalties (post-tax)
7. 13th-month accrual (info only)

## Manual edits & audit
- Any line can be **changed** (amount), **switched off** (kept on the payslip, crossed out, and excluded), or **reset** to its computed value. Manual lines (bonus, cash advance, loan) can also be **added** or removed.
- Every edit requires a **reason**. It is stored on the line (editor, time, reason) and in `audit_logs` with before/after values.
- Edits survive recompute: overrides are re-applied before tax and totals, so disabling SSS correctly raises taxable income.
- After **approval** the run is locked. Reopening requires an admin and a reason.

## Penalties
Rules (late tiers, habitual tardiness per cutoff, AWOL, missing time-out) generate **pending** penalties. A manager approves or waives each one (waiving needs a reason). Only approved penalties are deducted.

> ⚠️ Labor Code Art. 113 limits deductions from wages. Penalty deductions should come from a written policy that employees have acknowledged, and should be reviewed by counsel.
