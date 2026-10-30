import { randomUUID } from 'node:crypto';
/**
 * Demo data: one restaurant tenant, staff, schedules, PH holidays, 5 weeks of punches,
 * order slips, notes, penalty rules and a kiosk device. Safe to re-run (wipes the demo tenant).
 */
import { eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, pool, schema } from './index.js';
import { runMigrations } from './migrate.js';
import { encrypt, sha256 } from '../lib/crypto.js';
import { hashSecret } from '../modules/auth.routes.js';
import { DEFAULT_SETTINGS } from '../settings.js';
import { nameLinker, rowsFromPaper } from '../payroll/sheet.js';
import { MDC_DEPARTMENTS, MDC_PAYROLL_OCT_5_11, MDC_STAFF, MDC_TRACKER } from './mdc-data.js';
import { isOnDuty } from '../stats/roster.js';

const TZ = 'Asia/Manila';
export const DEMO_DEVICE_TOKEN = 'demo-kiosk-token-change-me-0000000001';

// Deterministic PRNG so the demo looks the same every time.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);

/** 2026 PH holidays (Proclamation-based; Eid holidays are proclaimed separately — add when announced). */
const PH_HOLIDAYS_2026: { date: string; name: string; type: 'regular' | 'special_non_working' | 'special_working' }[] = [
  { date: '2026-01-01', name: "New Year's Day", type: 'regular' },
  { date: '2026-02-17', name: 'Chinese New Year', type: 'special_non_working' },
  { date: '2026-04-02', name: 'Maundy Thursday', type: 'regular' },
  { date: '2026-04-03', name: 'Good Friday', type: 'regular' },
  { date: '2026-04-04', name: 'Black Saturday', type: 'special_non_working' },
  { date: '2026-04-09', name: 'Araw ng Kagitingan', type: 'regular' },
  { date: '2026-05-01', name: 'Labor Day', type: 'regular' },
  { date: '2026-06-12', name: 'Independence Day', type: 'regular' },
  { date: '2026-08-21', name: 'Ninoy Aquino Day', type: 'special_non_working' },
  { date: '2026-08-31', name: 'National Heroes Day', type: 'regular' },
  { date: '2026-11-01', name: "All Saints' Day", type: 'special_non_working' },
  { date: '2026-11-02', name: "All Souls' Day", type: 'special_non_working' },
  { date: '2026-11-30', name: 'Bonifacio Day', type: 'regular' },
  { date: '2026-12-08', name: 'Feast of the Immaculate Conception', type: 'special_non_working' },
  { date: '2026-12-24', name: 'Christmas Eve', type: 'special_non_working' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'regular' },
  { date: '2026-12-30', name: 'Rizal Day', type: 'regular' },
  { date: '2026-12-31', name: 'Last Day of the Year', type: 'special_non_working' },
];

export const DEMO_TENANT = 'Mega Dance Center';

async function main() {
  await runMigrations();
  const existing = await db.select().from(schema.tenants).where(inArray(schema.tenants.name, [DEMO_TENANT, 'Demo Restaurant PH']));
  for (const t of existing) {
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.tenantId, t.id));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, t.id));
  }

  const settings = { ...DEFAULT_SETTINGS, departments: MDC_DEPARTMENTS, paySheets: MDC_PAYROLL_OCT_5_11.sheets };
  const [tenant] = await db.insert(schema.tenants).values({ name: DEMO_TENANT, timezone: TZ, settings }).returning();
  const tenantId = tenant.id;
  const [branch] = await db.insert(schema.branches).values({ tenantId, name: 'MDC Main', address: 'Mega Dance Center' }).returning();

  const [admin] = await db.insert(schema.users).values({ tenantId, email: 'admin@demo.ph', name: 'Daniel R. (Owner)', passwordHash: await hashSecret('Admin123!'), role: 'owner' }).returning();
  await db.insert(schema.users).values({ tenantId, email: 'manager@demo.ph', name: 'Kaye (Supervisor)', passwordHash: await hashSecret('Manager123!'), role: 'manager' });

  const pinHash = await hashSecret('1234');
  const rateOf = (dep: string) => MDC_DEPARTMENTS.find((d) => d.name === dep)!.dailyRate;
  const emps = await db.insert(schema.employees).values(MDC_STAFF.map((x, i) => ({
    tenantId, branchId: branch.id, employeeNo: `MDC-${String(i + 1).padStart(3, '0')}`, firstName: x.name, lastName: '',
    position: x.position, department: x.department, payType: 'daily' as const, rate: rateOf(x.department), weekPattern: x.week,
    hireDate: DateTime.fromISO('2024-01-15').plus({ days: Math.floor(rand() * 600) }).toISODate()!, pinHash, biometricConsentAt: new Date(),
    phone: `09${String(170000000 + Math.floor(rand() * 9999999)).padStart(9, '0')}`,
  }))).returning();
  const byName = new Map(emps.map((e) => [e.firstName, e]));

  await db.insert(schema.users).values({ tenantId, email: 'jane@demo.ph', name: 'Jane', passwordHash: await hashSecret('Employee123!'), role: 'employee', employeeId: byName.get('Jane')!.id });
  await db.insert(schema.fingerprintTemplates).values(emps.map((e) => ({ tenantId, employeeId: e.id, finger: 'R_INDEX', format: 'SIMULATED', templateEnc: encrypt(`SIM:${e.employeeNo}`), quality: 90, createdBy: admin.id })));
  const [device] = await db.insert(schema.devices).values({ tenantId, branchId: branch.id, name: 'Entrance Time Clock', tokenHash: sha256(DEMO_DEVICE_TOKEN), driver: 'simulator' }).returning();
  await db.insert(schema.holidays).values(PH_HOLIDAYS_2026.map((h) => ({ ...h, tenantId })));
  await db.insert(schema.penaltyRules).values([
    { tenantId, name: 'Late policy', config: { kind: 'late_tiered', tiers: [{ minMinutes: 6, maxMinutes: 15, amount: 25 }, { minMinutes: 16, maxMinutes: 30, amount: 50 }, { minMinutes: 31, maxMinutes: null, amount: 100 }] } },
    { tenantId, name: 'Habitual tardiness (5+ per cutoff)', config: { kind: 'late_frequency', threshold: 5, amount: 200 } },
    { tenantId, name: 'No time-out', config: { kind: 'missing_timeout', amount: 20 } },
  ]);

  // Five weeks of punches following each person's usual week and department hours.
  const now = DateTime.now().setZone(TZ);
  const today = now.startOf('day');
  const punches: (typeof schema.attendancePunches.$inferInsert)[] = [];
  for (let d = today.minus({ days: 35 }); d <= today; d = d.plus({ days: 1 })) {
    for (const e of emps) {
      const code = e.weekPattern[d.weekday - 1] ?? '';
      if (!isOnDuty(code) || rand() < 0.03) continue;
      const dep = MDC_DEPARTMENTS.find((x) => x.name === e.department)!;
      const [sh, sm] = dep.shiftStart.split(':').map(Number);
      const [eh, em] = dep.shiftEnd.split(':').map(Number);
      const late = rand() < 0.1 ? Math.floor(6 + rand() * 30) : -Math.floor(rand() * 15);
      const inAt = d.set({ hour: sh, minute: sm }).plus({ minutes: late });
      let outAt = d.set({ hour: eh, minute: em }).plus({ minutes: Math.floor(rand() * 40) - 5 });
      if (outAt <= inAt) outAt = outAt.plus({ days: 1 });
      if (inAt > now) continue;
      punches.push({ tenantId, employeeId: e.id, deviceId: device.id, type: 'in', punchedAt: inAt.toJSDate(), method: 'fingerprint', matchScore: 120 + Math.floor(rand() * 60) });
      if (outAt < now && rand() > 0.02) punches.push({ tenantId, employeeId: e.id, deviceId: device.id, type: 'out', punchedAt: outAt.toJSDate(), method: 'fingerprint', matchScore: 120 + Math.floor(rand() * 60) });
    }
  }
  for (let i = 0; i < punches.length; i += 500) await db.insert(schema.attendancePunches).values(punches.slice(i, i + 500));

  // October servers tracker, exactly as in the client's file.
  const stats: (typeof schema.serverStats.$inferInsert)[] = [];
  for (const [name, days] of Object.entries(MDC_TRACKER)) {
    const e = byName.get(name);
    if (!e) continue;
    for (const [date, m] of Object.entries(days)) stats.push({ tenantId, employeeId: e.id, date, orders: m.orders ?? 0, salesComms: m.salesComms ?? 0, lds: m.lds ?? 0, po: m.po ?? 0 });
  }
  if (stats.length) await db.insert(schema.serverStats).values(stats);

  // Sample management reviews (5-star) and notes.
  const review = (name: string, r: Record<string, number>, extra: Partial<typeof schema.performanceReviews.$inferInsert>) => ({
    tenantId, employeeId: byName.get(name)!.id, reviewerId: admin.id, periodStart: '2026-07-01', periodEnd: '2026-09-30', ratings: r, managerName: 'Daniel R.', ...extra,
  });
  await db.insert(schema.performanceReviews).values([
    review('Jane', { serviceQuality: 4.5, productKnowledge: 4, problemSolving: 4.5, timeManagement: 4, adaptability: 4.5, workEthic: 5, leadership: 4.5, communication: 4.5, reliability: 5, professionalism: 4.5, customerOrientation: 5, teamwork: 4.5 },
      { strengths: ['Excellent attendance', 'High customer satisfaction', 'Strong teamwork', 'Top LD sales'], weaknesses: ['Occasionally late', 'Product knowledge on new bottles'], opportunities: ['Leadership development', 'Supervisor training'], threats: ['Burnout risk on weekends'], notes: 'Jane is a valuable asset to the floor. Keep developing product knowledge and upselling of packages.', assists: 58, employeeOfMonth: 2, trainingCompleted: 6, crossTrained: 2, skillLevel: 'Advanced', promotionReady: true }),
    review('Kevin', { serviceQuality: 4.5, productKnowledge: 4, problemSolving: 4, timeManagement: 4.5, adaptability: 4, workEthic: 4.5, leadership: 3.5, communication: 4, reliability: 4.5, professionalism: 4, customerOrientation: 4.5, teamwork: 4 },
      { strengths: ['Highest order volume', 'Fast service'], weaknesses: ['Low package sales'], opportunities: ['Sales incentives'], threats: ['High workload during peak hours'], notes: 'Kevin carries the food orders on busy nights.', assists: 31, employeeOfMonth: 1, trainingCompleted: 4, crossTrained: 1, skillLevel: 'Intermediate' }),
    review('Jaysah', { serviceQuality: 4.5, productKnowledge: 5, problemSolving: 4.5, timeManagement: 4, adaptability: 4.5, workEthic: 4.5, leadership: 5, communication: 4.5, reliability: 4.5, professionalism: 5, customerOrientation: 4.5, teamwork: 5 },
      { strengths: ['Leads by example', 'Strong LD and package sales'], weaknesses: ['Delegation'], opportunities: ['Floor manager track'], threats: ['Competition hiring supervisors'], notes: 'Reliable supervisor; ready for more responsibility.', assists: 74, employeeOfMonth: 3, trainingCompleted: 9, crossTrained: 3, skillLevel: 'Expert', promotionReady: true }),
  ]);
  const note = (name: string, category: 'commendation' | 'coaching' | 'warning' | 'incident' | 'general', title: string, body: string, rating: number) =>
    ({ tenantId, employeeId: byName.get(name)!.id, authorId: admin.id, category, title, body, rating, visibleToEmployee: category !== 'warning' });
  await db.insert(schema.managementNotes).values([
    note('Jane', 'commendation', 'Guest compliment', 'VIP table asked for Jane by name.', 2),
    note('Jane', 'warning', 'Late twice this cutoff', 'Verbal reminder given.', -1),
    note('Glaze', 'commendation', 'LD target reached', 'Top LDs for the week of Oct 12–18.', 1),
    note('Mia', 'coaching', 'Low orders', 'Pair with Jane on Friday shifts.', 0),
  ]);

  // The client's Oct. 5-11 weekly payroll, row for row (linked to staff where the name matches).
  const link = nameLinker(emps.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), department: e.department })));
  await db.insert(schema.paySheets).values({
    tenantId, periodStart: MDC_PAYROLL_OCT_5_11.periodStart, periodEnd: MDC_PAYROLL_OCT_5_11.periodEnd, status: 'final',
    cashReceived: MDC_PAYROLL_OCT_5_11.cashReceived, rows: rowsFromPaper(MDC_PAYROLL_OCT_5_11.rows, randomUUID, link),
    createdBy: admin.id, finalizedBy: admin.id, finalizedAt: new Date('2026-10-12T04:00:00Z'), notes: 'Imported from the Oct. 5-11 payroll PDF',
  });

  console.log(`\nSeeded "${DEMO_TENANT}": ${emps.length} staff, ${punches.length} punches, ${stats.length} tracker days, Oct. 5-11 payroll`);
  console.log('  Owner:     admin@demo.ph / Admin123!');
  console.log('  Manager:   manager@demo.ph / Manager123!');
  console.log('  Employee:  jane@demo.ph / Employee123!   (kiosk PIN for all demo staff: 1234)');
  console.log(`  Kiosk device token: ${DEMO_DEVICE_TOKEN}\n`);
}

main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
