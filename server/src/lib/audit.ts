import { db, schema } from '../db/index.js';
import type { Principal } from '../plugins/auth.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AuditEntry {
  entity: string;
  entityId?: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Append-only audit trail. Pass the transaction so the log commits atomically with the change. */
export async function audit(actor: Principal, entry: AuditEntry, tx: Tx | typeof db = db, ip?: string) {
  await tx.insert(schema.auditLogs).values({
    tenantId: actor.tenantId,
    actorUserId: actor.kind === 'user' ? actor.userId : null,
    actorDeviceId: actor.kind === 'device' ? actor.deviceId : null,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    ip,
  });
}
