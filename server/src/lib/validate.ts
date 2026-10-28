import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Validation failed', z.flattenError(r.error));
  return r.data;
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const uuid = z.uuid();
/** Required human reason for any manual change that affects pay. */
export const reason = z.string().trim().min(3, 'Please give a reason (min 3 characters)').max(500);
