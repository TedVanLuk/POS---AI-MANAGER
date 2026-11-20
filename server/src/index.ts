import { buildApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { startAutomationLoop } from './crm/service.js';

await runMigrations();
const app = await buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });
if (config.crmAutomations) startAutomationLoop(app.log);
