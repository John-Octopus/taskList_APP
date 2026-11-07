/**
 * Durable debug log for the notes panel.
 *
 * The Host half writes one JSON line per summary attempt so a failed model call
 * can be inspected after the fact instead of guessed at. The log lives beside
 * the plugin (inside the workspace) and is rewritten, never appended forever.
 *
 * @module dsh-notes-panel/logs
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the log file lives: `<plugin>/notes-debug.log`. */
export const LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'notes-debug.log');

/** Rotate once the log passes this size. */
const MAX_BYTES = 1024 * 1024;

/**
 * Append one record to the debug log.
 *
 * Logging must never break a note, so every failure here is swallowed.
 * @param record - the object to record; it is JSON-serialized on one line.
 * @returns nothing.
 */
export function logRecord(record) {
  try {
    try {
      if (statSync(LOG_PATH).size > MAX_BYTES) renameSync(LOG_PATH, `${LOG_PATH}.1`);
    } catch {
      // No log yet, or it cannot be rotated: appending is still fine.
    }
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`;
    appendFileSync(LOG_PATH, line, 'utf8');
  } catch {
    // Debug logging never fails a request.
  }
}

/**
 * Describe one streamed chunk in a short, log-safe shape.
 *
 * Only the discriminant and a short sample of any text survive: the point is to
 * learn which chunk shapes the adapter emits, not to store the transcript.
 * @param chunk - one chunk from the LLM stream.
 * @returns a compact description.
 */
export function shapeOf(chunk) {
  if (chunk === null || typeof chunk !== 'object') return { value: typeof chunk };
  const out = { type: chunk.type };
  if (typeof chunk.text === 'string') out.textLength = chunk.text.length;
  if (typeof chunk.delta === 'string') {
    out.deltaLength = chunk.delta.length;
    out.deltaSample = chunk.delta.slice(0, 40);
  }
  if (chunk.blockType !== undefined) out.blockType = chunk.blockType;
  if (chunk.index !== undefined) out.index = chunk.index;
  if (chunk.reason !== undefined) out.reason = chunk.reason;
  return out;
}
