/**
 * Pure helpers behind the notes panel.
 *
 * Everything here is a function of its arguments: no filesystem, no network, no
 * Context. The Host half feeds it Session events and the model's answer; this
 * module decides which messages make it into the summary input, how the
 * `.md` note is laid out, and which filename the download uses.
 *
 * @module dsh-notes-panel/notes
 */

/** Canonical root node id of the exported conversation shape. */
export const ROOT_ID = 'root';

/** How many characters of one message reach the model. */
const MESSAGE_LIMIT = 600;

/** How many messages one summary may read. */
const MESSAGE_COUNT = 20;

/** How many characters the whole transcript may occupy. */
const TRANSCRIPT_LIMIT = 6000;

/** Markers the model is told to use; anything else is dropped. */
const NO_ITEM = '(none)';

/**
 * Collapse untrusted text into a safe filename component.
 * @param value - untrusted text such as a Session title.
 * @returns one safe filename component.
 */
export function safeName(value) {
  const trimmed = String(value ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clip(trimmed);
}

/**
 * Clip a name to what a download filename can carry.
 * @param text - already collapsed text.
 * @returns the clipped text, or `session` when nothing is left.
 */
function clip(text) {
  const cut = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return cut === '' ? 'session' : cut;
}

/**
 * Encode one filename for a `content-disposition` header.
 *
 * HTTP header values are byte strings, so a CJK window name cannot ride in
 * `filename=` alone; the ASCII fallback keeps old clients honest and
 * `filename*` carries the real name.
 * @param title - the Session title (its window name).
 * @returns the header value for the attachment disposition.
 */
export function dispositionFor(title) {
  const name = noteFilename(title);
  const ascii = clip(
    name
      .replace(/[^\x20-\x7e]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Name one note download: `<window name>.md`, as the panel promises.
 * @param title - the Session title (its window name).
 * @returns the browser filename.
 */
export function noteFilename(title) {
  return `${safeName(title)}.md`;
}

/**
 * Trim one message down to what the summarizer needs.
 * @param text - the message text.
 * @returns a single-line excerpt.
 */
function excerpt(text) {
  const flat = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return flat.length > MESSAGE_LIMIT ? `${flat.slice(0, MESSAGE_LIMIT)}…` : flat;
}

/**
 * Collect the request/response turns worth summarizing for one Session.
 *
 * Tool calls, reasoning, file cards, and the plugin's own boilerplate are left
 * out: the model only needs what the user and the assistant said.
 * @param conversation - one record from the conversation converter.
 * @returns the transcript text and how many turns it holds.
 */
export function transcriptOf(conversation) {
  const lines = [];
  let turns = 0;
  for (const node of Object.values(conversation?.mapping ?? {})) {
    if (node === null || typeof node !== 'object' || node.message === null) continue;
    const fragments = Array.isArray(node.message.fragments) ? node.message.fragments : [];
    const parts = [];
    for (const fragment of fragments) {
      if (fragment?.type === 'REQUEST' || fragment?.type === 'RESPONSE') {
        const text = excerpt(fragment.content);
        if (text !== '') parts.push(text);
      }
    }
    if (parts.length === 0) continue;
    const body = parts.join('\n\n');
    lines.push(body);
    turns += 1;
  }
  const kept = lines.slice(-MESSAGE_COUNT);
  let text = kept.join('\n\n---\n\n');
  if (text.length > TRANSCRIPT_LIMIT) text = text.slice(-TRANSCRIPT_LIMIT);
  return { text, turns: kept.length };
}

/**
 * The instruction handed to the model.
 * @param title - the Session title, so the model can name the work.
 * @returns the prompt text.
 */
export function promptOf(title) {
  return [
    `你在读一个开发窗口的对话，窗口名是「${title ?? '未命名'}」。`,
    '请只提炼**还没解决的问题**（待办、悬而未决的决策、用户尚未确认的诉求、报错未修、验证未做）。',
    '已经做好的事不要列为问题；闲聊不要列；重复合并成一条。',
    '格式严格要求如下，不要输出别的内容：',
    '',
    '### 待解决的问题',
    '',
    '- 一句话说清问题|一句说明现在卡在哪或下一步该做什么',
    '- ...',
    '',
    `如果确实没有待解决的问题，只输出一个 ${NO_ITEM}。`,
  ].join('\n');
}

/**
 * Shape the model's answer into the note body.
 * @param answer - the model's raw text.
 * @param fallback - the text used when the answer carries no list.
 * @returns the markdown body, without the file header.
 */
export function bodyOf(answer, fallback) {
  const text = String(answer ?? '').trim();
  if (text === '') return fallback;
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') continue;
    if (raw.trim().startsWith('#')) {
      lines.push(`## ${raw.trim().replace(/^#+\s*/, '')}`);
      continue;
    }
    if (/^\s*[-*•]\s+/.test(raw)) {
      const item = raw.replace(/^\s*[-*•]\s+/, '').trim();
      if (item === '' || item.startsWith(NO_ITEM)) continue;
      const [claim, ...rest] = item.split('|');
      const detail = rest.join('|').trim();
      lines.push(detail === '' ? `- ${claim.trim()}` : `- **${claim.trim()}** ${detail}`);
      continue;
    }
    lines.push(`- ${line.trim()}`);
  }
  const kept = lines.filter((line) => !line.startsWith('## 待解决的问题') || lines.length > 1);
  const empty = kept.every((line) => line === '' || line === `- ${NO_ITEM}` || line === NO_ITEM);
  if (kept.length === 0 || empty) return fallback;
  return kept.join('\n');
}

/**
 * Assemble the whole `.md` document.
 * @param input - the Session facts and the already-shaped body.
 * @returns the markdown text.
 */
export function noteDocument(input) {
  const lines = [`# ${input.title || '未命名对话'}`, ''];
  lines.push(`> 窗口：${input.sessionId}`);
  if (typeof input.updatedAt === 'number') lines.push(`> 最后活动：${new Date(input.updatedAt).toISOString()}`);
  if (typeof input.turns === 'number') lines.push(`> 读过 ${input.turns} 条消息`);
  lines.push('', input.body.trim(), '');
  return lines.join('\n');
}

/**
 * Build the deterministic body used when no model answer is available.
 * @param input - the Session facts and the transcript.
 * @returns the markdown body.
 */
export function fallbackBody(input) {
  if (input.turns === 0) return '### 待解决的问题\n\n- 这个窗口还没有可读的对话内容';
  return [
    '### 待解决的问题',
    '',
    `- **未生成摘要**（模型不可用）${input.reason ? '｜' + input.reason : ''}`,
    '',
    '### 对话原文（节选）',
    '',
    input.transcript,
  ].join('\n');
}

/**
 * Read the model's answer text out of its streamed chunks.
 *
 * The `llm` service reports adapter failures in-band as a terminal
 * `{ type: 'finish', reason: { kind: 'error' | 'aborted', failure } }` chunk
 * instead of throwing. Turning that into a throw is what surfaces the real
 * provider error in the note body.
 * @param chunks - the chunk list emitted by the LLM stream.
 * @returns the concatenated text.
 * @throws when the stream ended in error, was aborted, or carried no text.
 */
export function textOfChunks(chunks) {
  const parts = [];
  for (const chunk of chunks ?? []) {
    if (chunk === null || typeof chunk !== 'object') continue;
    if (chunk.type === 'finish') {
      const kind = chunk.reason?.kind;
      if (kind === 'error' || kind === 'aborted') {
        const failure = chunk.reason?.failure ?? {};
        const detail = [failure.code, failure.message]
          .filter((value) => typeof value === 'string' && value !== '')
          .join(': ');
        throw new Error(`模型调用失败：${detail === '' ? kind : detail}`);
      }
      continue;
    }
    if (chunk.type === 'text' && typeof chunk.text === 'string') parts.push(chunk.text);
    else if (typeof chunk.text === 'string' && chunk.type === undefined) parts.push(chunk.text);
    // The DeepSeek adapter streams the answer as `text-delta` chunks that carry
    // their fragment in `text`; older shapes used `delta`, so both are read.
    else if (chunk.type === 'text-delta' && typeof chunk.text === 'string') parts.push(chunk.text);
    else if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') parts.push(chunk.delta);
  }
  const text = parts.join('');
  if (text.trim() === '') throw new Error('模型返回空内容（EMPTY_RESPONSE）');
  return text;
}
