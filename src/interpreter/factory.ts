/**
 * Interpreter selection.
 *
 * The rest of the application depends only on `CalendarEventInterpreter` and
 * never learns which implementation is active.
 *
 * This module is deliberately free of any Expo or React Native import so it can
 * be unit tested in a plain Node environment; reading the configuration off the
 * device lives in `./config`.
 */
import { HeuristicCalendarEventInterpreter } from './heuristic';
import { GemmaCalendarEventInterpreter, type GemmaConfig } from './gemma';
import type { CalendarEventInterpreter } from './types';

export type InterpreterKind = 'heuristic' | 'gemma';

export type InterpreterSettings = {
  kind: InterpreterKind;
  gemma?: Partial<GemmaConfig>;
};

export const DEFAULT_GEMMA_MODEL = 'gemma3:4b-it-qat';

/**
 * Build the configured interpreter.
 *
 * Falls back to the deterministic implementation when Gemma is selected but not
 * configured, so a misconfiguration degrades to a working app rather than a
 * broken one.
 */
export function createInterpreter(settings: InterpreterSettings): CalendarEventInterpreter {
  if (settings.kind === 'gemma' && settings.gemma?.baseUrl) {
    return new GemmaCalendarEventInterpreter({
      baseUrl: settings.gemma.baseUrl,
      model: settings.gemma.model ?? DEFAULT_GEMMA_MODEL,
      ...(settings.gemma.apiKey ? { apiKey: settings.gemma.apiKey } : {}),
    });
  }
  return new HeuristicCalendarEventInterpreter();
}
