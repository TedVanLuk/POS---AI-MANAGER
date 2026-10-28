import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fstatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { registerAuth } from './plugins/auth.js';
import aiRoutes from './modules/ai.routes.js';
import attendanceRoutes from './modules/attendance.routes.js';
import authRoutes from './modules/auth.routes.js';
import efficiencyRoutes from './modules/efficiency.routes.js';
import employeeRoutes from './modules/employees.routes.js';
import kioskRoutes from './modules/kiosk.routes.js';
import meRoutes from './modules/me.routes.js';
import notesRoutes from './modules/notes.routes.js';
import payrollRoutes from './modules/payroll.routes.js';
import penaltyRoutes from './modules/penalties.routes.js';
import settingsRoutes from './modules/settings.routes.js';
import statsRoutes from './modules/stats.routes.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true, bodyLimit: 5 * 1024 * 1024 });

  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await registerAuth(app);

  app.setErrorHandler((err: Error & { statusCode?: number; details?: unknown }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  for (const routes of [authRoutes, employeeRoutes, settingsRoutes, kioskRoutes, attendanceRoutes, payrollRoutes, penaltyRoutes, efficiencyRoutes, notesRoutes, statsRoutes, meRoutes, aiRoutes]) {
    await app.register(routes);
  }

  // Serve the built web app (single-page app) when present.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fstatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
