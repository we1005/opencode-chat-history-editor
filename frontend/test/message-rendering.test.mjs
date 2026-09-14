import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  entryPoints: [path.join(root, 'src/components/SessionDetail/SessionDetailPanel.tsx')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  mainFields: ['module', 'main'], external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  alias: { '@mui/icons-material': path.join(root, 'node_modules/@mui/icons-material/esm') },
  jsx: 'automatic', define: { 'import.meta.env': '{}' },
});
const renderer = new Module(path.join(root, 'test/rendered-component.cjs'));
renderer.filename = path.join(root, 'test/rendered-component.cjs');
renderer.paths = Module._nodeModulePaths(root);
renderer._compile(result.outputFiles[0].text, renderer.filename);
const { MessageItem } = renderer.exports;

function render(info = {}, parts = []) {
  const message = {
    id: 'msg_fixture', session_id: 'ses_fixture', time_created: 1, time_updated: 1,
    data: JSON.stringify({ role: 'assistant', ...info }),
    parts: parts.map((data, index) => ({ id: `prt_${index}`, message_id: 'msg_fixture', session_id: 'ses_fixture', time_created: index, time_updated: index, data: JSON.stringify(data) })),
  };
  return renderToStaticMarkup(React.createElement(MessageItem, { message, index: 0, registerRef() {}, highlightedIndex: null, expandTools: true }));
}

test('provider failures show their actual error, not an invented interruption message', () => {
  const html = render({ error: { name: 'APIError', data: { message: "The response was blocked by the provider's content filter", statusCode: 400, isRetryable: false } } });
  assert.ok(html.includes('The response was blocked by the provider'), 'the recorded provider error must be visible');
  assert.ok(!html.includes('模型无响应或被用户终止'), 'do not guess that the user stopped it');
});

test('tool-only assistant messages retain the tool input and full output', () => {
  const html = render({}, [{ type: 'tool', tool: 'read', callID: 'call_fixture', state: { status: 'completed', input: { filePath: 'fixture.ts', offset: 210 }, output: 'BEGIN_TOOL_OUTPUT\nEND_TOOL_OUTPUT', title: 'Read fixture' } }]);
  for (const value of ['read', 'fixture.ts', '210', 'BEGIN_TOOL_OUTPUT', 'END_TOOL_OUTPUT']) assert.ok(html.includes(value), `${value} must remain readable`);
  assert.ok(!html.includes('模型无响应或被用户终止'));
});

test('reasoning, tools and text retain original interleaved part order', () => {
  const html = render({}, [
    { type: 'text', text: 'FIRST_TEXT_PAYLOAD' },
    { type: 'tool', tool: 'read', state: { status: 'completed', input: {}, output: 'TOOL_OUTPUT_PAYLOAD' } },
    { type: 'reasoning', text: 'LATER_REASONING_PAYLOAD' },
    { type: 'text', text: 'FINAL_TEXT_PAYLOAD' },
  ]);
  const offsets = ['FIRST_TEXT_PAYLOAD', 'TOOL_OUTPUT_PAYLOAD', 'LATER_REASONING_PAYLOAD', 'FINAL_TEXT_PAYLOAD'].map(value => html.indexOf(value));
  assert.ok(offsets.every((value, index) => value >= 0 && (!index || value > offsets[index - 1])), 'parts must not be regrouped by type');
});

test('pasted content and long code are not truncated to a tooltip preview', () => {
  const code = Array.from({ length: 80 }, (_, index) => `const fixture${index} = "${'x'.repeat(50)}";`).join('\n');
  const html = render({ role: 'user' }, [{ type: 'text', text: `[Pasted ~80 lines]\n\`\`\`ts\n${code}\nLONG_CONTENT_END\n\`\`\`` }]);
  assert.ok(html.includes('LONG_CONTENT_END'), 'the end of a long paste must be reachable');
});

test('empty reasoning, attachments and unknown parts are still represented', () => {
  const html = render({}, [
    { type: 'reasoning', text: '', time: { start: 1, end: 5701 } },
    { type: 'file', filename: 'attached-fixture.txt', mime: 'text/plain', url: 'file:///fixture.txt' },
    { type: 'future-part', extra: 'UNKNOWN_PAYLOAD_MARKER' },
  ]);
  for (const value of ['思考', '5.7', 'attached-fixture.txt', 'future-part', 'UNKNOWN_PAYLOAD_MARKER']) assert.ok(html.includes(value), `${value} must remain inspectable`);
});

test('message errors remain visible alongside partial content and model metadata', () => {
  const html = render({ providerID: 'fixture-provider', modelID: 'fixture-model', finish: 'error', error: { name: 'APIError', data: { message: 'ERROR_AFTER_PARTIAL_TEXT' } } }, [{ type: 'text', text: 'PARTIAL_TEXT' }]);
  for (const value of ['PARTIAL_TEXT', 'ERROR_AFTER_PARTIAL_TEXT', 'fixture-provider', 'fixture-model']) assert.ok(html.includes(value));
});
