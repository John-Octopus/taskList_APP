import { bodyOf, fallbackBody, noteDocument, noteFilename, promptOf, safeName, textOfChunks, transcriptOf } from './notes.js';

let failed = 0;

/**
 * Assert one expectation.
 * @param label - what is being checked.
 * @param condition - the expectation.
 * @returns nothing.
 */
function check(label, condition) {
  if (condition) {
    console.log(`ok   ${label}`);
    return;
  }
  failed += 1;
  console.log(`FAIL ${label}`);
}

check('safeName strips illegal characters', safeName('a/b:c*?"<>|d') === 'a b c d');
check('safeName keeps Chinese', safeName('导出对话') === '导出对话');
check('safeName falls back for empty input', safeName('   ') === 'session');
check('safeName truncates', safeName('词'.repeat(80)).endsWith('…'));
check('noteFilename ends with .md', noteFilename('安卓双端') === '安卓双端.md');

const conversation = {
  id: 'session-1',
  title: '示例',
  mapping: {
    root: { id: 'root', parent: null, children: ['n0'], message: null },
    n0: { id: 'n0', parent: 'root', children: ['n1'], message: { fragments: [{ type: 'REQUEST', content: '帮我修一下构建' }] } },
    n1: { id: 'n1', parent: 'n0', children: [], message: { fragments: [{ type: 'RESPONSE', content: '好的' }] } },
    n2: { id: 'n2', parent: 'n1', children: [], message: { fragments: [{ type: 'CALL', name: 'x', arguments: {} }] } },
  },
};

const transcript = transcriptOf(conversation);
check('transcript keeps the two spoken turns', transcript.turns === 2);
check('transcript joins request and response', transcript.text.includes('帮我修一下构建') && transcript.text.includes('好的'));
check('transcript skips tool calls', !transcript.text.includes('CALL'));

const prompt = promptOf('示例');
check('prompt names the window', prompt.includes('示例'));
check('prompt asks for open questions only', prompt.includes('待解决的问题'));

const body = bodyOf('### 待解决的问题\n\n- 构建失败|先看 gradle 日志\n- 未验证|重启 DSH\n', fallbackBody({ turns: 0 }));
check('body keeps the heading', body.includes('## 待解决的问题'));
check('body bolds the claim', body.includes('- **构建失败** 先看 gradle 日志'));
check('body keeps both items', body.split('\n').filter((line) => line.startsWith('- ')).length === 2);

const empty = bodyOf('(none)', fallbackBody({ turns: 0 }));
check('body falls back when the answer is empty', empty.includes('还没有可读的对话内容'));

const prose = bodyOf('没有待办，一切正常。', 'fallback');
check('body turns prose into a bullet', prose === '- 没有待办，一切正常。');

const document = noteDocument({ title: '示例', sessionId: 'session-1', updatedAt: 1793456023582, turns: 2, body });
check('document starts with the window name', document.startsWith('# 示例'));
check('document carries the session id', document.includes('session-1'));
check('document ends with one newline', document.endsWith('\n') && !document.endsWith('\n\n'));

check('chunks concatenate text parts', textOfChunks([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]) === 'ab');
check('chunks ignore non-text parts', textOfChunks([{ type: 'reasoning', text: 'x' }, { type: 'text', text: 'y' }]) === 'y');
check('chunks tolerate a normal finish', textOfChunks([{ type: 'text', text: 'z' }, { type: 'finish', reason: { kind: 'stop' } }]) === 'z');

let finishError = '';
try {
  textOfChunks([{ type: 'finish', reason: { kind: 'error', failure: { code: 'NO_ADAPTER', message: 'boom' } } }]);
} catch (error) {
  finishError = String(error?.message ?? error);
}
check('chunks throw the provider failure', finishError.includes('NO_ADAPTER') && finishError.includes('boom'));

let emptyError = '';
try {
  textOfChunks(null);
} catch (error) {
  emptyError = String(error?.message ?? error);
}
check('chunks throw on an empty answer', emptyError.includes('EMPTY_RESPONSE'));

const trailer = transcriptOf({ mapping: { root: { message: null }, a: { message: { fragments: [{ type: 'RESPONSE', content: 'x'.repeat(5000) }] } } } });
check('transcript clips long messages', trailer.text.length <= 1201);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
