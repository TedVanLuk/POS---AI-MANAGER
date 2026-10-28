/**
 * Demo data: one restaurant tenant, staff, schedules, PH holidays, 5 weeks of punches,
 * order slips, notes, penalty rules and a kiosk device. Safe to re-run (wipes the demo tenant).
 */
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, pool, schema } from './index.js';
import { runMigrations } from './migrate.js';
import { encrypt, sha256 } from '../lib/crypto.js';
import { hashSecret } from '../modules/auth.routes.js';
import { DEFAULT_SETTINGS } from '../settings.js';

const TZ = 'Asia/Manila';
export const DEMO_DEVICE_TOKEN = 'demo-kiosk-token-change-me-0000000001';

// Deterministic PRNG so the demo looks the same every time.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

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

async function main() {
  await runMigrations();
  const existing = await db.select().from(schema.tenants).where(eq(schema.tenants.name, 'Demo Restaurant PH'));
  for (const t of existing) {
    // users/devices reference each other via audit logs; delete the tenant tree explicitly
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.tenantId, t.id));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, t.id));
  }

  const [tenant] = await db.insert(schema.tenants).values({ name: 'Demo Restaurant PH', timezone: TZ, settings: DEFAULT_SETTINGS }).returning();
  const tenantId = tenant.id;
  const [branch] = await db.insert(schema.branches).values({ tenantId, name: 'BGC Main', address: 'Bonifacio Global City, Taguig' }).returning();
  const [daySched] = await db.insert(schema.workSchedules).values({ tenantId, name: 'Day 09:00–18:00', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 5, restDays: [7] }).returning();
  const [midSched] = await db.insert(schema.workSchedules).values({ tenantId, name: 'Mid 14:00–23:00', startTime: '14:00', endTime: '23:00', breakMinutes: 60, graceMinutes: 5, restDays: [1] }).returning();

  const adminHash = await hashSecret('Admin123!');
  const [admin] = await db.insert(schema.users).values({ tenantId, email: 'admin@demo.ph', name: 'Maria Santos (Owner)', passwordHash: adminHash, role: 'owner' }).returning();
  await db.insert(schema.users).values({ tenantId, email: 'manager@demo.ph', name: 'Paolo Reyes (Manager)', passwordHash: await hashSecret('Manager123!'), role: 'manager' });

  const staff = [
    { no: 'E-001', first: 'Juan', last: 'Dela Cruz', position: 'Server', dept: 'Service', pay: 'daily' as const, rate: 695, sched: daySched.id, lateBias: 0.1, speed: 1.0 },
    { no: 'E-002', first: 'Ana', last: 'Lim', position: 'Server', dept: 'Service', pay: 'daily' as const, rate: 695, sched: daySched.id, lateBias: 0.02, speed: 0.8 },
    { no: 'E-003', first: 'Mark', last: 'Villanueva', position: 'Server', dept: 'Service', pay: 'daily' as const, rate: 695, sched: midSched.id, lateBias: 0.35, speed: 1.3 },
    { no: 'E-004', first: 'Liza', last: 'Garcia', position: 'Head Server', dept: 'Service', pay: 'daily' as const, rate: 800, sched: midSched.id, lateBias: 0.05, speed: 0.9 },
    { no: 'E-005', first: 'Carlo', last: 'Mendoza', position: 'Line Cook', dept: 'Kitchen', pay: 'daily' as const, rate: 750, sched: daySched.id, lateBias: 0.15, speed: 1 },
    { no: 'E-006', first: 'Grace', last: 'Torres', position: 'Cashier', dept: 'Front', pay: 'daily' as const, rate: 695, sched: daySched.id, lateBias: 0.08, speed: 1 },
    { no: 'E-007', first: 'Ramon', last: 'Aquino', position: 'Kitchen Supervisor', dept: 'Kitchen', pay: 'monthly' as const, rate: 28000, sched: daySched.id, lateBias: 0.05, speed: 1 },
    { no: 'E-008', first: 'Bea', last: 'Navarro', position: 'Restaurant Manager', dept: 'Management', pay: 'monthly' as const, rate: 45000, sched: daySched.id, lateBias: 0.0, speed: 1 },
  ];
  const pinHash = await hashSecret('1234');
  const emps = await db.insert(schema.employees).values(staff.map((s) => ({
    tenantId, branchId: branch.id, scheduleId: s.sched, employeeNo: s.no, firstName: s.first, lastName: s.last, position: s.position,
    department: s.dept, payType: s.pay, rate: s.rate, hireDate: '2025-06-01', pinHash, biometricConsentAt: new Date(),
    allowances: s.pay === 'monthly' ? [{ code: 'rice', label: 'Rice subsidy (de minimis)', amount: 1000 }] : [],
    sssNo: `34-${Math.floor(rand() * 1e7)}-${Math.floor(rand() * 9)}`, tin: `${Math.floor(rand() * 1e9)}`,
  }))).returning();

  await db.insert(schema.users).values({ tenantId, email: 'juan@demo.ph', name: 'Juan Dela Cruz', passwordHash: await hashSecret('Employee123!'), role: 'employee', employeeId: emps[0].id });

  // Simulated fingerprint templates (simulator driver matches these strings).
  await db.insert(schema.fingerprintTemplates).values(emps.map((e) => ({
    tenantId, employeeId: e.id, finger: 'R_INDEX', format: 'SIMULATED', templateEnc: encrypt(`SIM:${e.employeeNo}`), quality: 90, createdBy: admin.id,
  })));

  const [device] = await db.insert(schema.devices).values({ tenantId, branchId: branch.id, name: 'Front Counter Tablet', tokenHash: sha256(DEMO_DEVICE_TOKEN), driver: 'simulator' }).returning();

  await db.insert(schema.holidays).values(PH_HOLIDAYS_2026.map((h) => ({ ...h, tenantId })));

  await db.insert(schema.penaltyRules).values([
    { tenantId, name: 'Late policy', config: { kind: 'late_tiered', tiers: [{ minMinutes: 6, maxMinutes: 15, amount: 25 }, { minMinutes: 16, maxMinutes: 30, amount: 50 }, { minMinutes: 31, maxMinutes: null, amount: 100 }] } },
    { tenantId, name: 'Habitual tardiness (5+ per cutoff)', config: { kind: 'late_frequency', threshold: 5, amount: 200 } },
    { tenantId, name: 'No time-out', config: { kind: 'missing_timeout', amount: 20 } },
  ]);

  // ---- 5 weeks of punches + order slips up to yesterday ----
  const today = DateTime.now().setZone(TZ).startOf('day');
  const punches: (typeof schema.attendancePunches.$inferInsert)[] = [];
  const slips: (typeof schema.orderSlips.$inferInsert)[] = [];
  let serial = 1000;
  for (let d = today.minus({ days: 35 }); d < today; d = d.plus({ days: 1 })) {
    for (const [i, e] of emps.entries()) {
      const s = staff[i];
      const sch = s.sched === daySched.id ? daySched : midSched;
      if (sch.restDays.includes(d.weekday)) continue;
      if (rand() < 0.04) continue; // occasional absence
      const [sh, sm] = sch.startTime.split(':').map(Number);
      const [eh, em] = sch.endTime.split(':').map(Number);
      const late = rand() < s.lateBias ? Math.floor(6 + rand() * 35) : -Math.floor(rand() * 15);
      const inAt = d.set({ hour: sh, minute: sm }).plus({ minutes: late });
      const outAt = d.set({ hour: eh, minute: em }).plus({ minutes: Math.floor(rand() * 75) - 5 });
      punches.push({ tenantId, employeeId: e.id, deviceId: device.id, type: 'in', punchedAt: inAt.toJSDate(), method: 'fingerprint', matchScore: 120 + Math.floor(rand() * 60) });
      if (rand() > 0.03) punches.push({ tenantId, employeeId: e.id, deviceId: device.id, type: 'out', punchedAt: outAt.toJSDate(), method: 'fingerprint', matchScore: 120 + Math.floor(rand() * 60) });

      if (s.position.includes('Server')) {
        const n = Math.floor(10 + rand() * 10 / s.speed);
        for (let k = 0; k < n; k++) {
          const opened = inAt.plus({ minutes: 20 + Math.floor(rand() * 420) });
          const serve = Math.max(4, Math.round((8 + rand() * 12) * s.speed));
          const isVoid = rand() < 0.02 * s.speed;
          serial += rand() < 0.01 ? 2 : 1; // rare gap in serials
          slips.push({
            tenantId, branchId: branch.id, serverEmployeeId: e.id, serialNo: `OS-${String(serial).padStart(6, '0')}`, tableNo: String(1 + Math.floor(rand() * 20)),
            openedAt: opened.toJSDate(), servedAt: opened.plus({ minutes: serve }).toJSDate(), closedAt: opened.plus({ minutes: serve + 25 + Math.floor(rand() * 30) }).toJSDate(),
            amount: Math.round((350 + rand() * 2500) / 10) * 10, itemsCount: 1 + Math.floor(rand() * 8), status: isVoid ? 'void' : 'closed', voidReason: isVoid ? pick(['Customer cancelled', 'Wrong order', 'Duplicate']) : null,
          });
        }
      }
    }
  }
  for (let i = 0; i < punches.length; i += 500) await db.insert(schema.attendancePunches).values(punches.slice(i, i + 500));
  for (let i = 0; i < slips.length; i += 500) await db.insert(schema.orderSlips).values(slips.slice(i, i + 500));

  await db.insert(schema.managementNotes).values([
    { tenantId, employeeId: emps[1].id, authorId: admin.id, category: 'commendation', title: 'Great guest feedback', body: 'Two 5-star reviews mention Ana by name this week.', rating: 2, visibleToEmployee: true },
    { tenantId, employeeId: emps[2].id, authorId: admin.id, category: 'warning', title: 'Repeated tardiness', body: 'Late 4 times in 2 weeks. Verbal warning given; next is written.', rating: -2 },
    { tenantId, employeeId: emps[3].id, authorId: admin.id, category: 'coaching', title: 'Training new servers', body: 'Liza is mentoring two new hires — keep her on mid shift.', rating: 1 },
    { tenantId, employeeId: emps[0].id, authorId: admin.id, category: 'general', title: 'Upsell target', body: 'Juan reached the dessert upsell target.', rating: 1, visibleToEmployee: true },
  ]);

  console.log('\nSeeded "Demo Restaurant PH"');
  console.log('  Admin:     admin@demo.ph / Admin123!');
  console.log('  Manager:   manager@demo.ph / Manager123!');
  console.log('  Employee:  juan@demo.ph / Employee123!   (kiosk PIN for all demo staff: 1234)');
  console.log(`  Kiosk device token: ${DEMO_DEVICE_TOKEN}`);
  console.log(`  ${punches.length} punches, ${slips.length} order slips\n`);
}

main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
