/**
 * The interpreter boundary.
 *
 * Everything above this line is deterministic application code. Everything
 * behind it is language understanding, and is therefore treated as untrusted:
 * output is always re-validated and re-canonicalised before it is persisted.
 */
import type { InterpretedCalendarEvent, RawCalendarEvent } from '@/domain/types';

export interface CalendarEventInterpreter {
  /** A stable identifier recorded against each processed event, for auditing. */
  readonly id: string;
  interpret(event: RawCalendarEvent): Promise<InterpretedCalendarEvent>;
}

/** Thrown when an interpreter cannot produce output. The raw event is retained. */
export class InterpreterError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'InterpreterError';
  }
}
