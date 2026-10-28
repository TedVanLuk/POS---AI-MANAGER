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
}).parse(process.env);

export const config = {
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  biometricKey: Buffer.from(env.BIOMETRIC_KEY, 'base64'),
  anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: env.NODE_ENV === 'production',
};
