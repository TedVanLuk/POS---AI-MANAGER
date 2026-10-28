import {
  pgTable, uuid, text, timestamp, integer, boolean, numeric, jsonb, date, pgEnum, uniqueIndex, index, time,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const tenantId = () => uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });

export const roleEnum = pgEnum('role', ['owner', 'admin', 'manager', 'employee']);
export const payTypeEnum = pgEnum('pay_type', ['monthly', 'daily', 'hourly']);
export const punchTypeEnum = pgEnum('punch_type', ['in', 'out']);
export const punchMethodEnum = pgEnum('punch_method', ['fingerprint', 'pin', 'manual']);
export const holidayTypeEnum = pgEnum('holiday_type', ['regular', 'special_non_working', 'special_working']);
export const payFrequencyEnum = pgEnum('pay_frequency', ['semi_monthly', 'monthly', 'weekly']);
export const payrollStatusEnum = pgEnum('payroll_status', ['draft', 'review', 'approved', 'paid', 'void']);
export const lineCategoryEnum = pgEnum('line_category', ['earning', 'deduction', 'employer', 'info']);
export const penaltyStatusEnum = pgEnum('penalty_status', ['pending', 'approved', 'waived']);
export const slipStatusEnum = pgEnum('slip_status', ['open', 'closed', 'void']);
export const noteCategoryEnum = pgEnum('note_category', ['commendation', 'coaching', 'warning', 'incident', 'general']);

/** Tenant-level settings, including which payroll components are active. */
export type TenantSettings = {
  payroll: {
    frequency: 'semi_monthly' | 'monthly' | 'weekly';
    /** Days/year used to derive daily rate from monthly (261 = 5-day week, 313 = 6-day week). */
    workDaysPerYear: number;
    hoursPerDay: number;
    /** Statutory deductions: split evenly across cutoffs, or deduct whole on the 2nd cutoff. */
    statutorySchedule: 'split' | 'second_cutoff';
    components: {
      overtime: boolean;
      nightDifferential: boolean;
      holidayPay: boolean;
      restDayPay: boolean;
      lateDeduction: boolean;
      undertimeDeduction: boolean;
      absenceDeduction: boolean;
      sss: boolean;
      philhealth: boolean;
      pagibig: boolean;
      withholdingTax: boolean;
      thirteenthMonthAccrual: boolean;
      allowances: boolean;
      penalties: boolean;
    };
    nightDiffStart: string; // "22:00"
    nightDiffEnd: string; // "06:00"
    nightDiffRate: number; // 0.10
    minOvertimeMinutes: number; // OT counted only when >= this
  };
};

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Manila'),
  currency: text('currency').notNull().default('PHP'),
  settings: jsonb('settings').$type<TenantSettings>().notNull(),
  createdAt: createdAt(),
});

export const branches = pgTable('branches', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  address: text('address'),
  createdAt: createdAt(),
});

export const workSchedules = pgTable('work_schedules', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  startTime: time('start_time').notNull(), // local time "09:00"
  endTime: time('end_time').notNull(), // may be < start for overnight shifts
  breakMinutes: integer('break_minutes').notNull().default(60),
  graceMinutes: integer('grace_minutes').notNull().default(5),
  /** ISO weekday numbers (1=Mon … 7=Sun) that are rest days. */
  restDays: jsonb('rest_days').$type<number[]>().notNull().default([7]),
  createdAt: createdAt(),
});

export const employees = pgTable('employees', {
  id: id(),
  tenantId: tenantId(),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  scheduleId: uuid('schedule_id').references(() => workSchedules.id, { onDelete: 'set null' }),
  employeeNo: text('employee_no').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  position: text('position'),
  department: text('department'),
  payType: payTypeEnum('pay_type').notNull().default('daily'),
  /** Monthly salary, daily rate or hourly rate depending on pay_type. */
  rate: money('rate').notNull(),
  /** Recurring non-taxable allowances per pay period, e.g. [{code:'RICE', label:'Rice allowance', amount:1000}] */
  allowances: jsonb('allowances').$type<{ code: string; label: string; amount: number; taxable?: boolean }[]>().notNull().default([]),
  /** Per-employee opt-outs of statutory items (e.g. minimum wage earners are tax-exempt). */
  exemptions: jsonb('exemptions').$type<{ withholdingTax?: boolean; sss?: boolean; philhealth?: boolean; pagibig?: boolean }>().notNull().default({}),
  tin: text('tin'),
  sssNo: text('sss_no'),
  philhealthNo: text('philhealth_no'),
  pagibigNo: text('pagibig_no'),
  hireDate: date('hire_date'),
  active: boolean('active').notNull().default(true),
  /** Argon2 hash of a 4–6 digit PIN, fallback when the finger can't be read. */
  pinHash: text('pin_hash'),
  biometricConsentAt: timestamp('biometric_consent_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('employees_tenant_no').on(t.tenantId, t.employeeNo)]);

export const users = pgTable('users', {
  id: id(),
  tenantId: tenantId(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email').on(t.email)]);

export const devices = pgTable('devices', {
  id: id(),
  tenantId: tenantId(),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  /** SHA-256 of the device token; the plain token is shown once at registration. */
  tokenHash: text('token_hash').notNull(),
  driver: text('driver').notNull().default('simulator'),
  active: boolean('active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('devices_token').on(t.tokenHash)]);

export const fingerprintTemplates = pgTable('fingerprint_templates', {
  id: id(),
  tenantId: tenantId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  finger: text('finger').notNull(), // e.g. R_INDEX
  format: text('format').notNull(), // ISO19794-2 | ANSI378 | SIMULATED | ZK
  /** AES-256-GCM: base64(iv|tag|ciphertext). */
  templateEnc: text('template_enc').notNull(),
  quality: integer('quality'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('fp_employee_finger').on(t.employeeId, t.finger)]);

export const attendancePunches = pgTable('attendance_punches', {
  id: id(),
  tenantId: tenantId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  type: punchTypeEnum('type').notNull(),
  punchedAt: timestamp('punched_at', { withTimezone: true }).notNull(),
  method: punchMethodEnum('method').notNull(),
  matchScore: integer('match_score'),
  /** Idempotency key generated on the kiosk (offline queue safe). */
  clientUuid: uuid('client_uuid'),
  /** Soft-delete for corrections — original punches are never physically removed. */
  voided: boolean('voided').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id),
  reason: text('reason'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('punch_client_uuid').on(t.tenantId, t.clientUuid),
  index('punch_emp_time').on(t.tenantId, t.employeeId, t.punchedAt),
]);

export const holidays = pgTable('holidays', {
  id: id(),
  tenantId: tenantId(),
  date: date('date').notNull(),
  name: text('name').notNull(),
  type: holidayTypeEnum('type').notNull(),
}, (t) => [uniqueIndex('holiday_tenant_date').on(t.tenantId, t.date)]);

export const payrollRuns = pgTable('payroll_runs', {
  id: id(),
  tenantId: tenantId(),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  payDate: date('pay_date'),
  frequency: payFrequencyEnum('frequency').notNull(),
  /** 1 or 2 for semi-monthly cutoffs — drives statutory deduction timing. */
  cutoff: integer('cutoff').notNull().default(1),
  status: payrollStatusEnum('status').notNull().default('draft'),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  computedAt: timestamp('computed_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: createdAt(),
});

export const payslips = pgTable('payslips', {
  id: id(),
  tenantId: tenantId(),
  runId: uuid('run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  gross: money('gross').notNull().default(0),
  totalDeductions: money('total_deductions').notNull().default(0),
  net: money('net').notNull().default(0),
  /** Attendance summary snapshot used for the computation (days, lates, OT, ND…). */
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('payslip_run_emp').on(t.runId, t.employeeId)]);

export const payslipLines = pgTable('payslip_lines', {
  id: id(),
  tenantId: tenantId(),
  payslipId: uuid('payslip_id').notNull().references(() => payslips.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  label: text('label').notNull(),
  category: lineCategoryEnum('category').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 4, mode: 'number' }),
  rate: numeric('rate', { precision: 14, scale: 4, mode: 'number' }),
  amount: money('amount').notNull(),
  taxable: boolean('taxable').notNull().default(true),
  /** false = switched off by an admin (kept for audit, excluded from totals). */
  enabled: boolean('enabled').notNull().default(true),
  /** true = added or overridden by a person; survives recompute. */
  isManual: boolean('is_manual').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  editReason: text('edit_reason'),
});

export type PenaltyRuleConfig =
  | { kind: 'late_tiered'; tiers: { minMinutes: number; maxMinutes: number | null; amount: number }[] }
  | { kind: 'late_frequency'; threshold: number; amount: number }
  | { kind: 'absence'; amount: number }
  | { kind: 'missing_timeout'; amount: number };

export const penaltyRules = pgTable('penalty_rules', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  config: jsonb('config').$type<PenaltyRuleConfig>().notNull(),
  active: boolean('active').notNull().default(true),
  /** Auto-approve generated penalties (otherwise they wait for a manager). */
  autoApprove: boolean('auto_approve').notNull().default(false),
  createdAt: createdAt(),
});

export const penalties = pgTable('penalties', {
  id: id(),
  tenantId: tenantId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  ruleId: uuid('rule_id').references(() => penaltyRules.id, { onDelete: 'set null' }),
  date: date('date').notNull(),
  kind: text('kind').notNull(), // late | absence | missing_timeout | disciplinary | …
  minutes: integer('minutes'),
  amount: money('amount').notNull(),
  reason: text('reason').notNull(),
  status: penaltyStatusEnum('status').notNull().default('pending'),
  /** Dedup key for auto-generated penalties, e.g. "late:2026-10-01". */
  sourceKey: text('source_key'),
  issuedBy: uuid('issued_by').references(() => users.id),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionReason: text('decision_reason'),
  payrollRunId: uuid('payroll_run_id').references(() => payrollRuns.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('penalty_source').on(t.tenantId, t.employeeId, t.ruleId, t.sourceKey)]);

export const orderSlips = pgTable('order_slips', {
  id: id(),
  tenantId: tenantId(),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  serverEmployeeId: uuid('server_employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  serialNo: text('serial_no').notNull(),
  tableNo: text('table_no'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  servedAt: timestamp('served_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  amount: money('amount').notNull().default(0),
  itemsCount: integer('items_count').notNull().default(0),
  status: slipStatusEnum('status').notNull().default('closed'),
  voidReason: text('void_reason'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('slip_serial').on(t.tenantId, t.branchId, t.serialNo)]);

export const managementNotes = pgTable('management_notes', {
  id: id(),
  tenantId: tenantId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  category: noteCategoryEnum('category').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** -3 … +3, feeds the "Reputation" stat on the fighter card. */
  rating: integer('rating').notNull().default(0),
  visibleToEmployee: boolean('visible_to_employee').notNull().default(false),
  createdAt: createdAt(),
});

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  tenantId: tenantId(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorDeviceId: uuid('actor_device_id').references(() => devices.id),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  action: text('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason'),
  ip: text('ip'),
  createdAt: createdAt(),
}, (t) => [index('audit_entity').on(t.tenantId, t.entity, t.entityId)]);
