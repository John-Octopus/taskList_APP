/**
 * Host-side listing of the Sessions stored for this workspace.
 *
 * The picker needs each Session's id, title, times, and workspace. None of that
 * is derivable from the client Session list without extra requests, and the
 * on-disk store layout is a persistence-backend detail, so the rows come from
 * the composed `sessionQuery` service instead: `listSessions()` enumerates the
 * corpus and `readTitleSnapshots()` folds each log's latest `session/title`.
 *
 * @module dsh-conversation-save/store
 */

/** How many stored logs are described at most. */
const MAX_SESSIONS = 400;

/**
 * Normalize one path for comparison, tolerating separator and case differences.
 * @param value - a workspace path, possibly empty or unknown.
 * @returns the comparable form, or undefined when the path is unknown.
 */
export function workspaceKey(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * Read the title out of one `readTitleSnapshots` entry.
 * @param snapshot - the entry returned by the query service.
 * @returns the title, or an empty string when the Session has none.
 */
function titleOfSnapshot(snapshot) {
  const entry = snapshot?.value ?? snapshot;
  const candidate = entry?.title;
  const value = typeof candidate === 'string' ? candidate : candidate?.title;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read one session-query projection result, unwrapping the settled envelope.
 * @param snapshot - one entry returned by `readTitleSnapshots`.
 * @returns the projected value, or undefined when that Session failed.
 */
function unwrapProjection(snapshot) {
  const entry = snapshot?.value ?? snapshot;
  if (entry?.status === 'rejected') return undefined;
  return entry;
}

/**
 * List the Sessions of one workspace, newest first.
 * @param ctx - the Host context carrying `sessionQuery` and `sessions`.
 * @param signal - optional cancellation.
 * @param cwd - the workspace to list; defaults to the Host process directory.
 * @returns the Session rows and a short diagnostic of what was consulted.
 */
export async function listWorkspaceSessions(ctx, signal, cwd) {
  const wanted = workspaceKey(cwd ?? process.cwd());
  const query = ctx.get('sessionQuery');
  let records;
  if (query !== undefined && typeof query.listSessions === 'function') {
    records = await query.listSessions(signal);
  } else {
    records = [];
  }

  const owned = [];
  for (const record of records ?? []) {
    if (signal?.aborted === true) break;
    const header = record?.header ?? {};
    if (typeof header.id !== 'string') continue;
    if (wanted !== undefined) {
      const key = workspaceKey(header.cwd);
      if (key !== undefined && key !== wanted) continue;
    }
    if ((header.delegationDepth ?? 0) > 0) continue;
    owned.push({ header, live: record.live === true, persisted: record.persisted === true });
  }

  let titles = new Map();
  if (owned.length > 0 && query !== undefined && typeof query.readTitleSnapshots === 'function') {
    try {
      const snapshots = await query.readTitleSnapshots(
        owned.map((entry) => entry.header.id),
        signal,
      );
      titles = new Map();
      for (const snapshot of snapshots ?? []) {
        const value = unwrapProjection(snapshot);
        const id = value?.session?.id ?? snapshot?.session?.id;
        if (typeof id === 'string') titles.set(id, titleOfSnapshot(snapshot));
      }
    } catch {
      titles = new Map();
    }
  }

  const rows = owned.map(({ header, live, persisted }) => {
    const id = String(header.id);
    const created = typeof header.createdAt === 'number' ? header.createdAt : 0;
    const title = titles.get(id) ?? '';
    return {
      id,
      title: title === '' ? id : title,
      cwd: typeof header.cwd === 'string' ? header.cwd : '',
      createdAt: header.createdAt ?? null,
      updatedAt: created,
      bytes: 0,
      subagent: false,
      live,
      persisted,
    };
  });

  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const kept = rows.slice(0, MAX_SESSIONS);
  return {
    sessions: kept,
    total: rows.length,
    source: query === undefined ? 'sessionQuery unavailable' : 'sessionQuery',
  };
}
