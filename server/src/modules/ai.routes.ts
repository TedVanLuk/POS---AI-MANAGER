import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { parse } from '../lib/validate.js';
import { ADMIN_ROLES, requireUser, userOf } from '../plugins/auth.js';
import { chat } from '../ai/assistant.js';

export default async function aiRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireUser(ADMIN_ROLES), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.get('/api/ai/status', admin, async () => ({ enabled: !!config.anthropicApiKey }));

  app.post('/api/ai/chat', admin, async (req) => {
    const body = parse(z.object({
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8000) })).min(1).max(40)
        .refine((m) => m[0].role === 'user' && m[m.length - 1].role === 'user', 'Conversation must start and end with a user message'),
    }), req.body);
    return chat(userOf(req), body.messages);
  });
}
