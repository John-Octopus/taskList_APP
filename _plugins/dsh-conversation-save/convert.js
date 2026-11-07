/**
 * Pure conversion from stored Session events to the conversations.json shape.
 *
 * The output is a JSON array; every element describes one conversation:
 *
 *   { id, title, inserted_at, updated_at, mapping }
 *
 * `mapping` is a flat object keyed by node id, each node being
 * `{ id, parent, children, message }`. `message` is either `null` (the root) or
 * `{ model, inserted_at, fragments }`, where a fragment is one of
 * `{ type: 'REQUEST', content }`, `{ type: 'RESPONSE', content }`,
 * `{ type: 'FILE', files }`, or `{ type: 'SEARCH', results }`.
 *
 * Nothing here touches the filesystem, the network, or a Context: it is a pure
 * function of the event list, so it can be unit-tested and reused by a tool.
 */

/** Canonical root node id, matching the reference export. */
export const ROOT_ID = 'root';

const TIME_ZONE = 'Asia/Shanghai';

/**
 * Render one instant in the reference export's timestamp format.
 *
 * Stored Session times are epoch milliseconds; a ISO string is accepted too.
 * The wall clock is the `Asia/Shanghai` clock the reference export used, reached
 * through the platform zone database so the same log renders the same text on
 * any machine.
 * @param value - epoch milliseconds, ISO string, or nothing.
 * @returns an ISO 8601 string with a `+08:00` offset.
 */
export function toStamp(value) {
  const date = new Date(typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? value : Date.now());
  if (Number.isNaN(date.getTime())) return toStamp(undefined);
  const parts = zoneParts(date);
  const stamp = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  return `${stamp}+08:00`;
}

/**
 * Read the wall-clock parts of an instant in {@link STAMP_TIME_ZONE}.
 * @param date - the instant to render.
 * @returns the zero-padded local parts.
 */
function zoneParts(date) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: STAMP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map = {};
  for (const part of format.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === '24' ? '00' : map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/** The IANA zone every stamp in the reference export was rendered in. */
export const STAMP_TIME_ZONE = TIME_ZONE;

/**
 * Concatenate the text blocks of a content array.
 * @param content - a message or block content array.
 * @returns the joined text, ignoring non-text blocks.
 */
export function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n\n');
}

/**
 * Read the tool name and arguments out of one `tool/call` event payload.
 * @param data - the event's data payload.
 * @returns the call name, its raw arguments, and any attached files.
 */
export function toolCallOf(data) {
  const name = typeof data?.name === 'string' ? data.name : typeof data?.tool === 'string' ? data.tool : 'tool';
  let args = data?.arguments ?? data?.args ?? data?.input ?? null;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      // A non-JSON argument string is kept verbatim.
    }
  }
  const files = Array.isArray(args?.files)
    ? args.files
        .filter((file) => file && typeof file.path === 'string')
        .map((file) => ({
          path: file.path,
          ...(typeof file.description === 'string' ? { description: file.description } : {}),
        }))
    : [];
  return { name, args, files };
}

/**
 * Derive a conversation title from the first user text.
 * @param text - the first user message text.
 * @param fallback - the title used when no user text exists.
 * @returns one single-line title.
 */
export function titleOf(text, fallback) {
  const firstLine = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (firstLine === '') return fallback;
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}

/**
 * Build one conversation record from a session's stored events.
 * @param input - the session header fields and the validated event list.
 * @returns the conversation record in the reference `conversations.json` shape.
 */
export function buildConversation(input) {
  const { id, events, title, createdAt, updatedAt, cwd, model, includeReasoning, includeTools } = input;
  const mapping = { [ROOT_ID]: { id: ROOT_ID, parent: null, children: [], message: null } };
  const children = mapping[ROOT_ID].children;
  let parent = ROOT_ID;
  let firstUserText = '';
  let latestTitle = '';
  let lastTime;
  let pos = 0;

  /**
   * Append one node under the current parent and advance the chain.
   * @param message - the node's message payload.
   * @returns nothing.
   */
  const append = (message) => {
    const nodeId = `node-${String(pos).padStart(4, '0')}`;
    pos += 1;
    mapping[nodeId] = { id: nodeId, parent, children: [], message };
    if (mapping[parent] !== undefined) mapping[parent].children.push(nodeId);
    parent = nodeId;
  };

  for (const event of events) {
    const data = event?.data ?? event;
    const stamp = toStamp(event?.time ?? event?.inserted_at ?? data?.inserted_at);
    const instant = event?.time ?? event?.inserted_at ?? data?.inserted_at;
    if (instant !== undefined) lastTime = instant;
    if (event?.type === 'session/title' && typeof data?.title === 'string' && data.title.trim() !== '') {
      latestTitle = data.title.trim();
      continue;
    }
    if (event?.type === 'agent/inbox/spliced') {
      const inserted = Array.isArray(data?.inserted) ? data.inserted : [];
      for (const item of inserted) {
        if (item?.role !== 'user') continue;
        const text = textOf(item.content);
        if (text.trim() === '') continue;
        if (firstUserText === '') firstUserText = text;
        append({ model: null, inserted_at: stamp, fragments: [{ type: 'REQUEST', content: text }] });
      }
      continue;
    }
    if (event?.type === 'assistant/message') {
      const message = data?.message ?? data;
      const blocks = Array.isArray(message?.content) ? message.content : [];
      const fragments = [];
      for (const block of blocks) {
        if (block?.type === 'text' && includeReasoning !== false) {
          const text = block.text ?? '';
          if (text !== '') fragments.push({ type: 'RESPONSE', content: text });
        } else if (block?.type === 'text') {
          fragments.push({ type: 'RESPONSE', content: block.text ?? '' });
        } else if (block?.type === 'reasoning' && includeReasoning === true) {
          const text = block.text ?? block.reasoning ?? '';
          if (text !== '') fragments.push({ type: 'THOUGHT', content: text });
        }
      }
      if (fragments.length === 0) continue;
      append({
        model: message?.model ?? data?.model ?? model ?? null,
        inserted_at: stamp,
        fragments,
      });
      continue;
    }
    if ((event?.type === 'tool/call' || event?.type === 'tool-call') && includeTools === true) {
      const call = toolCallOf(data);
      const fragments = [{ type: 'CALL', name: call.name, arguments: call.args ?? {} }];
      if (call.files.length > 0) fragments.push({ type: 'FILE', files: call.files });
      append({ model: null, inserted_at: stamp, fragments });
      continue;
    }
    if (event?.type === 'deliverables/presented' && Array.isArray(data?.files)) {
      const files = data.files
        .filter((file) => file && typeof file.path === 'string')
        .map((file) => ({
          path: file.path,
          ...(typeof file.description === 'string' ? { description: file.description } : {}),
        }));
      if (files.length === 0) continue;
      append({ model: null, inserted_at: stamp, fragments: [{ type: 'FILE', files }] });
    }
  }

  return {
    id,
    title: titleOf(latestTitle !== '' ? latestTitle : (title ?? ''), titleOf(firstUserText, 'Untitled conversation')),
    inserted_at: toStamp(createdAt),
    updated_at: toStamp(lastTime ?? updatedAt ?? createdAt),
    ...(typeof cwd === 'string' && cwd !== '' ? { cwd } : {}),
    mapping,
  };
}

/**
 * Count the messages a conversation record carries.
 * @param conversation - one record from {@link buildConversation}.
 * @returns the number of non-root mapping nodes.
 */
export function messageCount(conversation) {
  return Object.keys(conversation.mapping).filter((key) => key !== ROOT_ID).length;
}
