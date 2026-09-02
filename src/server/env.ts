/**
 * Server-side configuration.
 *
 * Read on the server only. Nothing here is prefixed `NEXT_PUBLIC_`, so none of
 * it reaches the browser bundle — which is what keeps the inference endpoint
 * and the database URL out of a page a parent can view source on.
 */
import { z } from 'zod';

import { DEFAULT_GEMMA_MODEL, type InterpreterSettings } from '@/interpreter/factory';

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  EVENT_INTERPRETER: z.enum(['heuristic', 'gemma']).default('heuristic'),
  GEMMA_BASE_URL: z.string().url().optional(),
  GEMMA_MODEL: z.string().default(DEFAULT_GEMMA_MODEL),
  GEMMA_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@classcal.ie'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}

/** Build interpreter settings from the environment. */
export function interpreterSettings(): InterpreterSettings {
  const config = env();
  return {
    kind: config.EVENT_INTERPRETER,
    ...(config.GEMMA_BASE_URL
      ? {
          gemma: {
            baseUrl: config.GEMMA_BASE_URL,
            model: config.GEMMA_MODEL,
            ...(config.GEMMA_API_KEY ? { apiKey: config.GEMMA_API_KEY } : {}),
          },
        }
      : {}),
  };
}
