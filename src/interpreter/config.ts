/**
 * Reading the interpreter configuration off the device.
 *
 * Values come from `app.json`'s `extra` block, overridable at build time by
 * `EXPO_PUBLIC_*` environment variables. Kept apart from the factory so the
 * selection logic stays testable outside a React Native runtime.
 *
 * Note: anything in `extra` or an `EXPO_PUBLIC_*` variable is embedded in the
 * app bundle and is therefore not secret. A hosted inference endpoint that needs
 * a real key should be fronted by a proxy rather than shipping the key here.
 */
import Constants from 'expo-constants';

import { DEFAULT_GEMMA_MODEL, type InterpreterSettings } from './factory';

function readExtra(): Record<string, string | undefined> {
  const extra = Constants.expoConfig?.extra;
  return (extra && typeof extra === 'object' ? extra : {}) as Record<string, string | undefined>;
}

export function readInterpreterSettings(): InterpreterSettings {
  const extra = readExtra();

  const kind =
    (process.env.EXPO_PUBLIC_EVENT_INTERPRETER ?? extra.eventInterpreter) === 'gemma'
      ? 'gemma'
      : 'heuristic';

  const baseUrl = process.env.EXPO_PUBLIC_GEMMA_BASE_URL ?? extra.gemmaBaseUrl;
  const model = process.env.EXPO_PUBLIC_GEMMA_MODEL ?? extra.gemmaModel ?? DEFAULT_GEMMA_MODEL;
  const apiKey = process.env.EXPO_PUBLIC_GEMMA_API_KEY ?? extra.gemmaApiKey;

  return {
    kind,
    ...(baseUrl ? { gemma: { baseUrl, model, ...(apiKey ? { apiKey } : {}) } } : {}),
  };
}
