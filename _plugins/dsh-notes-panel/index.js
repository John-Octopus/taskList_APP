/**
 * Host half of dsh-notes-panel.
 *
 * The notes panel reads the Sessions of this workspace, asks the model to name
 * what is still unresolved in one of them, and serves the result as a
 * `<window name>.md` download. Nothing here starts a model turn on its own: the
 * summary is one direct LLM call made when the user asks for it.
 *
 * Session data comes from the composed query and persistence services rather
 * than from the filesystem: the store layout is a backend detail, and the Host
 * process does not export `DSH_HOME` to plugins.
 *
 * @module dsh-notes-panel
 */

import {
  bodyOf,
  dispositionFor,
  fallbackBody,
  noteDocument,
  noteFilename,
  promptOf,
  textOfChunks,
  transcriptOf,
} from './notes.js';
import { listWorkspaceSessions } from '../dsh-conversation-save/store.js';
import { buildConversation, messageCount } from '../dsh-conversation-save/convert.js';
import { LOG_PATH, logRecord, shapeOf } from './logs.js';
import { registerDebugRoute } from './debug-route.js';

/** Plugin name, also the Client module id. */
export const name = 'notes-panel';

/** Services the Host half needs. */
export const inject = ['connection', 'llm'];

/** Why the last model call produced nothing (surfaced in the response headers). */
let lastAskError;

/** Maximum output tokens one note may spend. */
const MAX_TOKENS = 2000;

/** How long one summary may run before it is abandoned. */
const TIMEOUT_MS = 120000;

/** Fixed instruction that must lead every summary request. */
const SYSTEM_PROMPT = [
  '你是一个待办提炼助手。你会收到一个开发窗口的对话节选。',
  '只输出还没解决的问题清单，不要复述对话原文，不要解释，不要开场白。',
  '格式：先一行「### 待解决的问题」，然后每行一条「- 问题|卡点或下一步」。',
  '没有待解决的问题时只输出 (none)。',
].join('\n');

/**
 * Resolved configuration for the notes-panel bundle row.
 * @param config - the row's `config` object.
 * @returns the resolved settings.
 */
function resolveConfig(config) {
  const route = (value, fallback) => (typeof value === 'string' && value.startsWith('/') ? value : fallback);
  return {
    sessionsPath: route(config?.sessionsPath, '/api/notes-panel/sessions'),
    notePath: route(config?.notePath, '/api/notes-panel/note'),
    debugPath: route(config?.debugPath, '/api/notes-panel/debug'),
    model: typeof config?.model === 'string' && config.model !== '' ? config.model : undefined,
    provider: typeof config?.provider === 'string' && config.provider !== '' ? config.provider : undefined,
    cwd: typeof config?.cwd === 'string' && config.cwd !== '' ? config.cwd : undefined,
  };
}

/**
 * Read one Session's complete event log, preferring the live corpus.
 * @param ctx - the composed Host context.
 * @param sessionId - the Session to read.
 * @param signal - optional cancellation.
 * @returns the header and events, or undefined when the Session cannot be read.
 */
async function readSession(ctx, sessionId, signal) {
  const options = signal === undefined ? {} : { signal };

  const query = ctx.get('sessionQuery');
  if (query !== undefined && typeof query.readSession === 'function') {
    try {
      const loaded = await query.readSession(sessionId, options);
      if (loaded !== undefined && loaded !== null) {
        const events = Array.isArray(loaded.events) ? loaded.events : Array.isArray(loaded) ? loaded : undefined;
        if (events !== undefined) {
          const header = loaded.header ?? loaded.session ?? { id: sessionId };
          return { header, events };
        }
      }
    } catch {
      // Fall through to the persistence handle.
    }
  }

  const persistence = ctx.get('sessionPersistence');
  if (persistence === undefined) return undefined;
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
 * Run one direct LLM call and collect its text.
 * @param ctx - the composed Host context.
 * @param instruction - the prompt text.
 * @param settings - resolved bundle configuration.
 * @param sessionId - the Session the note is about.
 * @param signal - cancellation.
 * @returns the answer text, or undefined when no model is reachable.
 */
async function ask(ctx, instruction, settings, sessionId, signal) {
  const llm = ctx.get('llm');
  if (llm === undefined) {
    lastAskError = 'llm 服务未注册（ctx.get("llm") undefined）';
    return undefined;
  }
  if (typeof llm.stream !== 'function') {
    lastAskError = 'llm.stream 不是函数';
    return undefined;
  }
  const options = {
    // The DeepSeek Messages API answers a request that carries only user turns
    // with a degenerate stop and no content (EMPTY_RESPONSE), so this call
    // always leads with a fixed system instruction.
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: instruction }] }],
    maxTokens: MAX_TOKENS,
    // Extracting a list needs no deliberation. With thinking left on, the model
    // spends the whole budget on reasoning blocks and hits the stop before any
    // answer text exists, which the adapter reports as EMPTY_RESPONSE.
    reasoningEffort: 'off',
    sessionId,
    signal,
    ...(settings.model === undefined ? {} : { model: settings.model }),
    ...(settings.provider === undefined ? {} : { provider: settings.provider }),
  };
  const chunks = [];
  for await (const chunk of llm.stream(options)) chunks.push(chunk);
  logRecord({
    event: 'llm/stream',
    sessionId,
    provider: settings.provider ?? null,
    model: settings.model ?? null,
    promptChars: instruction.length,
    systemChars: SYSTEM_PROMPT.length,
    maxTokens: MAX_TOKENS,
    chunkCount: chunks.length,
    shapes: chunks.slice(0, 40).map(shapeOf),
  });
  return textOfChunks(chunks);
}


/**
 * Read the latest `session/title` event, the same fold the Session list uses.
 * @param events - the Session event log.
 * @returns the recorded title, or undefined when the Session has none.
 */
function sessionTitleOf(events) {
  if (!Array.isArray(events)) return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'session/title') continue;
    const value = event.data?.title;
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

/**
 * Build one note document from a stored Session.
 * @param ctx - the Host context.
 * @param sessionId - the Session to summarize.
 * @param settings - resolved bundle configuration.
 * @param signal - cancellation.
 * @returns the markdown text and the browser filename, or undefined when unreadable.
 */
async function noteFor(ctx, sessionId, settings, signal) {
  const stored = await readSession(ctx, sessionId, signal);
  if (stored === undefined) return undefined;
  const header = stored.header ?? {};
  const conversation = buildConversation({
    id: String(header.id ?? sessionId),
    title: '',
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    cwd: header.cwd,
    model: null,
    events: stored.events,
    includeReasoning: false,
    includeTools: false,
  });
  const title = sessionTitleOf(stored.events) ?? conversation.title;
  const transcript = transcriptOf(conversation);
  let answer;
  lastAskError = undefined;
  if (transcript.turns > 0 && transcript.text !== '') {
    try {
      answer = await ask(ctx, `${promptOf(title)}\n\n对话原文：\n\n${transcript.text}`, settings, sessionId, signal);
    } catch (error) {
      lastAskError = String(error?.message ?? error);
      logRecord({ event: 'ask/failed', sessionId, message: lastAskError });
      answer = undefined;
    }
  } else {
    logRecord({ event: 'ask/skipped', sessionId, turns: transcript.turns, transcriptChars: transcript.text.length });
  }
  const fallback = fallbackBody({ turns: transcript.turns, transcript: transcript.text, reason: lastAskError });
  const body = bodyOf(answer, fallback);
  const last = stored.events.at(-1);
  const text = noteDocument({
    title,
    sessionId: String(header.id ?? sessionId),
    updatedAt: typeof last?.time === 'number' ? last.time : undefined,
    turns: transcript.turns,
    body,
  });
  const out = { text, filename: noteFilename(title), title, messages: messageCount(conversation) };
  if (answer === undefined) out.reason = lastAskError ?? 'model returned no text';
  return out;
}

/**
 * Register the two Fetch routes the notes panel talks to.
 * @param ctx - the Host context carrying connection.
 * @param config - the resolved bundle row configuration.
 * @returns nothing.
 */
export function apply(ctx, config = {}) {
  const settings = resolveConfig(config);
  const connection = Reflect.get(ctx, 'connection');

  registerDebugRoute(connection, settings.debugPath);

  connection?.fetch?.register?.({
    path: settings.sessionsPath,
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
    path: settings.notePath,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url);
      const sessionId = String(url.searchParams.get('sessionId') ?? '').trim();
      if (sessionId === '') return new Response('missing sessionId query parameter', { status: 400 });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const signal = AbortSignal.any?.([request.signal, controller.signal]) ?? controller.signal;
      let note;
      try {
        note = await noteFor(ctx, sessionId, settings, signal);
      } catch (error) {
        if (signal.aborted === true) return new Response(null, { status: 499 });
        return new Response(`note failed: ${String(error?.message ?? error)}`, { status: 500 });
      } finally {
        clearTimeout(timer);
      }
      if (note === undefined) return new Response('session not found', { status: 404 });
      const headers = {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': dispositionFor(note.filename.replace(/\.md$/, '')),
        'cache-control': 'no-store',
      };
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { ...headers, 'x-messages': String(note.messages), 'x-note-reason': encodeURIComponent(note.reason ?? '') },
        });
      }
      return new Response(note.text, {
        headers: { ...headers, 'x-note-reason': encodeURIComponent(note.reason ?? '') },
      });
    },
  });
}
