/**
 * Verify the conversion against real stored Session logs.
 *
 * Reads the JSONL files produced by peeking a Session, runs the conversion,
 * and prints structural facts about the result.
 *
 * Run with: node _plugins/dsh-conversation-save/verify-real.mjs <session.jsonl>
 */

import fs from 'node:fs';
import { buildConversation, messageCount, ROOT_ID } from './convert.js';

const file = process.argv[2];
if (file === undefined) {
  console.error('usage: node verify-real.mjs <session.jsonl>');
  process.exit(2);
}

const lines = fs
  .readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');
const parsed = lines.map((line) => JSON.parse(line));

// The peeked artifact is the canonical JSONL: a header line, then events.
const header = parsed[0]?.id !== undefined && parsed[0]?.events === undefined ? parsed[0] : {};
const events = parsed.filter((entry) => typeof entry?.type === 'string');

console.log(`file: ${file}`);
console.log(`lines: ${lines.length}  header keys: ${Object.keys(header).slice(0, 8).join(', ')}`);
console.log(`events: ${events.length}`);

const counts = {};
for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
const top = Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);
console.log('event types:', top.map(([type, n]) => `${type}=${n}`).join(' '));

const conversation = buildConversation({
  id: String(header.id ?? 'unknown'),
  title: header.title ?? '',
  createdAt: header.createdAt,
  updatedAt: header.updatedAt,
  cwd: header.cwd,
  model: null,
  events,
  includeReasoning: false,
  includeTools: false,
});

const nodes = Object.values(conversation.mapping).filter((node) => node.id !== ROOT_ID);
const kinds = {};
for (const node of nodes) {
  for (const fragment of node.message.fragments) kinds[fragment.type] = (kinds[fragment.type] ?? 0) + 1;
}

const reachable = new Set([ROOT_ID]);
for (const node of nodes) {
  if (reachable.has(node.parent)) reachable.add(node.id);
}

const requests = nodes.filter((node) => node.message.fragments[0].type === 'REQUEST');
const responses = nodes.filter((node) => node.message.fragments[0].type === 'RESPONSE');

console.log(`\nconversation: ${conversation.id}`);
console.log(`title: ${conversation.title}`);
console.log(`inserted_at: ${conversation.inserted_at}  updated_at: ${conversation.updated_at}`);
console.log(`nodes: ${messageCount(conversation)}  fragments: ${JSON.stringify(kinds)}`);
console.log(`requests: ${requests.length}  responses: ${responses.length}`);
console.log(`reachable from root: ${reachable.size}/${nodes.length + 1}`);
console.log(`every node has children array: ${nodes.every((n) => Array.isArray(n.children))}`);
console.log(`first request: ${(requests[0]?.message.fragments[0].content ?? '').slice(0, 70)}`);
console.log(`last response: ${(responses.at(-1)?.message.fragments[0].content ?? '').slice(0, 70)}`);

const problems = [];
if (reachable.size !== nodes.length + 1) problems.push('unreachable node');
if (nodes.some((node) => !node.children.length && !Object.values(conversation.mapping).some((other) => other.parent === node.id))) {
  // leaf nodes legitimately have no children; nothing to flag here
}
if (requests.length === 0) problems.push('no REQUEST fragment');
if (conversation.title === 'Untitled conversation') problems.push('no title derived');

console.log(problems.length === 0 ? '\nOK: structure is sound' : `\nPROBLEMS: ${problems.join('; ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
