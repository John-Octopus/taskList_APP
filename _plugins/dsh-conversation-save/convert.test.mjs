/**
 * Offline checks for the conversation-save conversion.
 *
 * Run with: node _plugins/dsh-conversation-save/convert.test.mjs
 */

import { buildConversation, messageCount, textOf, toStamp, titleOf, ROOT_ID } from './convert.js';

let failures = 0;

/**
 * Assert one expected value.
 * @param label - the check name.
 * @param actual - the observed value.
 * @param expected - the expected value.
 * @returns nothing.
 */
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}

/** A stored Session: user turn, assistant reply with reasoning, another turn. */
const EVENTS = [
  { type: 'session', time: '2026-11-01T09:00:00.000Z', data: { cwd: 'C:/work', isSeeded: false } },
  {
    type: 'agent/inbox/spliced',
    time: '2026-11-01T09:00:05.000Z',
    data: { inserted: [{ role: 'user', content: [{ type: 'text', text: '帮我做个清单应用' }] }] },
  },
  {
    type: 'assistant/message',
    time: '2026-11-01T09:00:20.000Z',
    data: {
      message: {
        model: 'deepseek-flash',
        content: [
          { type: 'reasoning', text: '先规划再写。' },
          { type: 'text', text: '好的，先定技术栈。' },
        ],
      },
    },
  },
  {
    type: 'agent/inbox/spliced',
    time: '2026-11-01T09:01:00.000Z',
    data: { inserted: [{ role: 'user', content: [{ type: 'text', text: '用 Flutter' }] }] },
  },
  {
    type: 'assistant/message',
    time: '2026-11-01T09:01:30.000Z',
    data: { message: { model: 'deepseek-flash', content: [{ type: 'text', text: '收到。' }] } },
  },
  { type: 'turn/start', time: '2026-11-01T09:02:00.000Z', data: {} },
];

const conversation = buildConversation({
  id: 'session-abc',
  title: '',
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:02:00.000Z',
  cwd: 'C:/work',
  model: null,
  events: EVENTS,
  includeReasoning: false,
  includeTools: false,
});

eq('message count', messageCount(conversation), 4);
eq('id', conversation.id, 'session-abc');
eq('title from first user text', conversation.title, '帮我做个清单应用');
eq('root children', conversation.mapping[ROOT_ID].children, ['node-0000']);
eq('chain order', Object.keys(conversation.mapping).sort(), ['node-0000', 'node-0001', 'node-0002', 'node-0003', 'root']);
eq('second node parent', conversation.mapping['node-0001'].parent, 'node-0000');
eq('root message is null', conversation.mapping[ROOT_ID].message, null);
eq('first fragment', conversation.mapping['node-0000'].message.fragments[0], {
  type: 'REQUEST',
  content: '帮我做个清单应用',
});
eq('reply fragment', conversation.mapping['node-0001'].message.fragments[0], {
  type: 'RESPONSE',
  content: '好的，先定技术栈。',
});
eq('reply model', conversation.mapping['node-0001'].message.model, 'deepseek-flash');
eq(
  'every node is reachable from root',
  Object.values(conversation.mapping)
    .filter((node) => node.id !== ROOT_ID)
    .every((node) => conversation.mapping[node.parent]?.children.includes(node.id)),
  true,
);

const withReasoning = buildConversation({
  id: 's2',
  title: '',
  createdAt: '2026-11-01T09:00:00.000Z',
  events: EVENTS,
  includeReasoning: true,
  includeTools: false,
});
eq('reasoning included as an extra fragment', withReasoning.mapping['node-0001'].message.fragments.length, 2);

const toolEvents = [
  ...EVENTS,
  {
    type: 'tool/call',
    time: '2026-11-01T09:03:00.000Z',
    data: { name: 'present', arguments: { files: [{ path: 'dist/a.apk', description: 'APK' }] } },
  },
];
const withTools = buildConversation({
  id: 's3',
  title: '',
  createdAt: '2026-11-01T09:00:00.000Z',
  events: toolEvents,
  includeTools: true,
});
eq('tool call fragment type', withTools.mapping['node-0004'].message.fragments[0].type, 'CALL');
eq('tool call file fragment', withTools.mapping['node-0004'].message.fragments[1], {
  type: 'FILE',
  files: [{ path: 'dist/a.apk', description: 'APK' }],
});

eq('tz stamp offset', toStamp('2026-11-01T09:00:00.000Z').slice(-6), '+08:00');
eq('tz stamp local hour', toStamp('2026-11-01T09:00:00.000Z').slice(11, 13), '17');
eq('title truncation', titleOf('x'.repeat(80), 'fallback').length, 61);
eq('title fallback', titleOf('   ', 'fallback'), 'fallback');
eq('textOf joins blocks', textOf([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a\n\nb');
eq('empty session has only root', messageCount(buildConversation({ id: 'e', events: [] })), 0);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
