/**
 * Drain the notes-panel debug log over HTTP.
 *
 * Reading the log through the Host means no filesystem access is needed from
 * outside the app: `GET /api/notes-panel/debug` returns the raw text and
 * `DELETE` clears it.
 *
 * @module dsh-notes-panel/debug-route
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { LOG_PATH } from './logs.js';

/** Route that serves the debug log. */
export const DEBUG_PATH = '/api/notes-panel/debug';

/**
 * Register the debug-log route.
 * @param connection - the Host `connection` service.
 * @param path - the route path to serve.
 * @returns nothing.
 */
export function registerDebugRoute(connection, path = DEBUG_PATH) {
  connection?.fetch?.register?.({
    path,
    methods: ['GET', 'DELETE'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'DELETE') {
        try {
          writeFileSync(LOG_PATH, '', 'utf8');
        } catch {
          // Nothing to clear.
        }
        return new Response(null, { status: 204 });
      }
      let text;
      try {
        text = readFileSync(LOG_PATH, 'utf8');
      } catch {
        text = '';
      }
      return new Response(text, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-log-path': encodeURIComponent(LOG_PATH),
        },
      });
    },
  });
}
