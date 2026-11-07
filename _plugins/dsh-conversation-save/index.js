/**
 * Host half of dsh-conversation-save.
 *
 * Registers the `/save` slash command, the `/export` listing command, and two
 * authenticated Fetch routes: one lists the Sessions of this workspace for the
 * picker, the other serves the `conversations.json` document for one Session or
 * for a selected set of them. Neither command starts a model turn.
 *
 * @module dsh-conversation-save
 */

import { buildConversation, messageCount } from './convert.js';
import { listWorkspaceSessions } from './store.js';

/** Plugin name, also the Client module id. */
export const name = 'conversation-save';

/** Services the Host half needs to read a Session and serve its download. */
export const inject = ['commands', 'connection'];

/**
 * Resolved configuration for the conversation-save bundle row.
 * @param ctx - the composed Host context.
 * @param config - the row's `config` object.
 * @returns the resolved settings.
 */
function resolveConfig(config) {
  return {
    routePath: typeof config?.routePath === 'string' && config.routePath.startsWith('/') ? config.routePath : '/api/conversation-save',
    listingPath: typeof config?.listingPath === 'string' && config.listingPath.startsWith('/') ? config.listingPath : '/api/conversation-save/sessions',
    includeReasoning: config?.includeReasoning === true,
    includeTools: config?.includeTools === true,
    cwd: typeof config?.cwd === 'string' && config.cwd !== '' ? config.cwd : undefined,
  };
}

/**
 * Read one Session's stored events through the persistence read handle.
 * @param ctx - the composed Host context.
 * @param sessionId - the Session to read.
 * @param signal - optional cancellation forwarded to open and read.
 * @returns the header and events, or undefined when the Session does not exist.
 */
async function readSession(ctx, sessionId, signal) {
  const persistence = ctx.get('sessionPersistence');
  if (persistence === undefined) return undefined;
  const options = signal === undefined ? {} : { signal };
  let handle;
  try {
    handle = await persistence.open(sessionId, 'read', options);
  } catch {
    return undefined;
  }
  try {
    const { events } = await handle.read(0, undefined, options);
    return { header: handle.header, events: Array.isArray(events) ? events : [] };
  } finally {
    await handle.close();
  }
}

/**
 * Resolve a Session's stored model id, falling back to its header.
 * @param events - the Session's stored events.
 * @param header - the Session header.
 * @returns the model id or null.
 */
function modelOf(events, header) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'model/selection') continue;
    const data = event.data ?? {};
    const model = data.model ?? data.selected ?? data.id;
    if (typeof model === 'string' && model !== '') return model;
  }
  return typeof header?.model === 'string' ? header.model : null;
}

/**
 * Build one conversation object for a Session.
 * @param ctx - the composed Host context.
 * @param sessionId - the Session to export.
 * @param settings - resolved bundle configuration.
 * @param signal - optional cancellation.
 * @returns the conversation, or undefined when the Session does not exist.
 */
async function conversationOf(ctx, sessionId, settings, signal) {
  const stored = await readSession(ctx, sessionId, signal);
  if (stored === undefined) return undefined;
  const header = stored.header ?? {};
  return buildConversation({
    id: String(header.id ?? sessionId),
    title: header.title ?? '',
    createdAt: header.createdAt ?? header.inserted_at,
    updatedAt: header.updatedAt ?? header.updated_at,
    cwd: header.cwd,
    model: modelOf(stored.events, header),
    events: stored.events,
    includeReasoning: settings.includeReasoning,
    includeTools: settings.includeTools,
  });
}

/**
 * Build the downloadable document for one Session or a set of Sessions.
 * @param ctx - the composed Host context.
 * @param sessionIds - the Sessions to export, in document order.
 * @param settings - resolved bundle configuration.
 * @param signal - optional cancellation.
 * @returns the JSON text and total message count, or undefined when nothing was read.
 */
async function documentForSessions(ctx, sessionIds, settings, signal) {
  const conversations = [];
  let total = 0;
  for (const sessionId of sessionIds) {
    if (signal?.aborted === true) break;
    const conversation = await conversationOf(ctx, sessionId, settings, signal);
    if (conversation === undefined) continue;
    conversations.push(conversation);
    total += messageCount(conversation);
  }
  if (conversations.length === 0) return undefined;
  return { text: `${JSON.stringify(conversations, null, 2)}\n`, count: total, sessions: conversations.length };
}

/**
 * Collapse untrusted text into a safe download filename component.
 * @param value - untrusted text such as a title or Session id.
 * @returns one safe filename component.
 */
function safeName(value) {
  const trimmed = String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  const cut = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
  return cut === '' ? 'session' : cut;
}

/**
 * Name one download.
 * @param count - how many Sessions the document holds.
 * @param title - the single Session's title, when there is exactly one.
 * @returns the browser download filename.
 */
function filenameOf(count, title) {
  return count === 1 ? `${safeName(title ?? 'session')}.json` : `conversations-${count}.json`;
}

/**
 * Parse the requested Session ids from a query string or POST body.
 * @param source - the parsed URL search parameters.
 * @returns the ids in request order, without duplicates.
 */
function idsFrom(source) {
  const ids = [];
  for (const value of source.getAll('sessionId')) {
    const text = String(value).trim();
    if (text !== '' && !ids.includes(text)) ids.push(text);
  }
  return ids;
}

/**
 * Serve a JSON document that may come from a selection of Sessions.
 * @param ctx - the Host context.
 * @param settings - resolved bundle configuration.
 * @param ids - Sessions to export.
 * @param method - the HTTP method to answer.
 * @param signal - the request signal.
 * @returns the Fetch response.
 */
async function serveDocument(ctx, settings, ids, method, signal) {
  let document;
  try {
    document = await documentForSessions(ctx, ids, settings, signal);
  } catch (error) {
    if (signal?.aborted === true) return new Response(null, { status: 499 });
    return new Response(`conversation export failed: ${String(error?.message ?? error)}`, { status: 500 });
  }
  if (document === undefined) return new Response('session not found', { status: 404 });
  const filename = filenameOf(document.sessions, document.sessions === 1 ? ids[0] : undefined);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
  };
  if (method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...headers, 'content-length': String(Buffer.byteLength(document.text, 'utf8')) },
    });
  }
  return new Response(document.text, { headers });
}

/**
 * Register the commands and the two Fetch routes.
 * @param ctx - the Host context carrying commands and connection.
 * @param config - the resolved bundle row configuration.
 * @returns nothing.
 */
export function apply(ctx, config = {}) {
  const settings = resolveConfig(config);

  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'save',
        description: 'Export this conversation as conversations.json',
        handler: async ({ agent, rawInput }) => {
          if (String(rawInput ?? '').trim() !== '') {
            return { kind: 'error', text: 'The /save command takes no arguments.' };
          }
          const sessionId = agent?.session?.id ?? agent?.sessionId;
          if (sessionId === undefined) return { kind: 'error', text: 'No Session to export.' };
          const signal = new AbortController().signal;
          let document;
          try {
            document = await documentForSessions(ctx, [sessionId], settings, signal);
          } catch (error) {
            return { kind: 'error', text: `Conversation export failed: ${String(error?.message ?? error)}` };
          }
          if (document === undefined) return { kind: 'error', text: 'The Session log could not be read.' };
          return { kind: 'success', text: `Conversation export requested (${document.count} messages).` };
        },
      }),
    'conversation-save: command',
  );

  const connection = Reflect.get(ctx, 'connection');

  connection?.fetch?.register?.({
    path: settings.listingPath,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let listing = { sessions: [], total: 0, source: 'unavailable' };
      let failure;
      try {
        listing = await listWorkspaceSessions(ctx, request.signal, settings.cwd);
      } catch (error) {
        failure = String(error?.message ?? error);
      }
      const body = {
        sessions: listing.sessions ?? [],
        total: listing.total ?? 0,
        source: listing.source ?? 'unavailable',
        cwd: settings.cwd ?? '(unset)',
      };
      if (failure !== undefined) body.failure = failure;
      const text = `${JSON.stringify(body, null, 2)}\n`;
      return new Response(request.method === 'HEAD' ? null : text, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': String(Buffer.byteLength(text, 'utf8')),
        },
      });
    },
  });

  connection?.fetch?.register?.({
    path: settings.routePath,
    methods: ['GET', 'HEAD', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url);
      let ids = idsFrom(url.searchParams);
      if (request.method === 'POST') {
        let body = '';
        try {
          body = await request.text();
        } catch {
          body = '';
        }
        if (body.trim() !== '') {
          try {
            const parsed = JSON.parse(body);
            const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sessionIds) ? parsed.sessionIds : [];
            ids = [...new Set([...ids, ...list.map((value) => String(value ?? '').trim()).filter((value) => value !== '')])];
          } catch {
            return new Response('request body must be a JSON array of Session ids', { status: 400 });
          }
        }
      }
      if (ids.length === 0) {
        return new Response('missing sessionId query parameter', { status: 400 });
      }
      return serveDocument(ctx, settings, ids, request.method === 'HEAD' ? 'HEAD' : 'GET', request.signal);
    },
  });
}
