import 'dotenv/config';
import { z } from 'zod';

const env = z.object({
  DATABASE_URL: z.string().default('postgres://aim:aim@localhost:5432/aim_hr'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  BIOMETRIC_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'BIOMETRIC_KEY must be 32 bytes, base64'),
  ANTHROPIC_API_KEY: z.string().optional(),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default(''),
  NODE_ENV: z.string().default('development'),
  /** CRM messaging: "log" records messages as simulated (no SMS leaves the server); "semaphore" sends real SMS. */
  SMS_PROVIDER: z.enum(['log', 'semaphore']).default('log'),
  SEMAPHORE_API_KEY: z.string().optional(),
  /** Shared secret for the inbound SMS webhook (STOP replies): /api/crm/inbound/sms?key=… */
  CRM_INBOUND_SECRET: z.string().optional(),
  /** Run CRM automations every hour in the API process ("off" when a separate worker does it). */
  CRM_AUTOMATIONS: z.enum(['on', 'off']).default('on'),
}).parse(process.env);

export const config = {
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  biometricKey: Buffer.from(env.BIOMETRIC_KEY, 'base64'),
  anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: env.NODE_ENV === 'production',
  smsProvider: env.SMS_PROVIDER,
  semaphoreApiKey: env.SEMAPHORE_API_KEY || undefined,
  crmInboundSecret: env.CRM_INBOUND_SECRET || undefined,
  crmAutomations: env.CRM_AUTOMATIONS === 'on',
};
