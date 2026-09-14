import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';

const root = fileURLToPath(new URL('../', import.meta.url));

test('search results open their original context and return without losing the search', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    DocumentFragment: dom.window.DocumentFragment, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  let cleanup;
  t.after(async () => {
    if (cleanup) await act(() => cleanup());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  // jsdom has no layout engine: give actual rendered rows a deterministic
  // geometry. The browser check separately verifies real scroll positioning.
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const scroller = document.querySelector('[data-message-scroll]');
    const index = [...document.querySelectorAll('[data-message-id]')].indexOf(this);
    const top = index >= 0 ? index * 300 - (scroller?.scrollTop || 0) : 0;
    const height = index >= 0 ? 140 : 600;
    return { top, bottom: top + height, left: 0, right: 900, width: 900, height, x: 0, y: top, toJSON() {} };
  };
  dom.window.HTMLElement.prototype.scrollTo = function ({ top }) { this.scrollTop = top; };

  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { SessionDetailPanel } from './src/components/SessionDetail/SessionDetailPanel';
      export function mount(messages) {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } } });
        client.setQueryData(['messages', 'ses_search_fixture'], messages);
        client.setQueryData(['sessionStats', 'ses_search_fixture'], { messageCount: messages.length, partCount: messages.length, childCount: 0 });
        const root = createRoot(document.getElementById('root'));
        root.render(<QueryClientProvider client={client}><SessionDetailPanel session={{ id: 'ses_search_fixture', title: 'Search fixture', time_updated: 1, children: [], message_count: messages.length }} /></QueryClientProvider>);
        return () => { root.unmount(); client.clear(); };
      }
    `, resolveDir: root, loader: 'tsx' },
    bundle: true, platform: 'node', format: 'cjs', write: false, mainFields: ['module', 'main'],
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    alias: { '@mui/icons-material': path.join(root, 'node_modules/@mui/icons-material/esm') },
    jsx: 'automatic', define: { 'import.meta.env': '{}' },
  });
  const fixture = new Module(path.join(root, 'test/search-fixture.cjs'));
  fixture.filename = path.join(root, 'test/search-fixture.cjs');
  fixture.paths = Module._nodeModulePaths(root);
  fixture._compile(bundle.outputFiles[0].text, fixture.filename);
  const messages = ['before', 'needle first', 'between', 'needle second', 'after'].map((text, index) => ({
    id: `msg_${index}`, session_id: 'ses_search_fixture', time_created: index, time_updated: index,
    data: JSON.stringify({ role: index % 2 ? 'assistant' : 'user' }),
    parts: [{ id: `prt_${index}`, message_id: `msg_${index}`, session_id: 'ses_search_fixture', data: JSON.stringify({ type: 'text', text }) }],
  }));
  await act(() => { cleanup = fixture.exports.mount(messages); });
  const scroller = document.querySelector('[data-message-scroll]');
  Object.defineProperty(scroller, 'clientHeight', { value: 600 });
  const input = document.querySelector('input');
  const rows = () => [...document.querySelectorAll('[data-message-id]')].map(node => node.dataset.messageId);
  const findButton = label => [...document.querySelectorAll('button')].find(button => button.textContent.includes(label));
  async function search(value) {
    await act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  }
  async function click(button) {
    assert.ok(button, 'expected navigation control');
    await act(() => button.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  }

  await search('needle');
  assert.deepEqual(rows(), ['msg_1', 'msg_3']);
  await click(document.querySelector('[aria-label="查看第 4 条消息的上下文"]'));
  assert.deepEqual(rows(), messages.map(message => message.id), 'the complete timeline and both neighbors must be restored');
  assert.equal(input.value, 'needle', 'keep the search so returning is possible');
  assert.equal(document.querySelector('[data-context-target]')?.dataset.messageId, 'msg_3');
  assert.equal(document.activeElement.dataset.messageId, 'msg_3');
  assert.ok(scroller.scrollTop >= 600, 'scroll after restoring the full list, not against the filtered-list geometry');

  await click(findButton('返回搜索结果'));
  assert.deepEqual(rows(), ['msg_1', 'msg_3']);
  assert.equal(input.value, 'needle');
  assert.equal(document.querySelector('[data-search-context]'), null);
  assert.equal(document.activeElement.dataset.messageId, 'msg_3');

  await click(document.querySelector('[aria-label="查看第 2 条消息的上下文"]'));
  assert.equal(document.querySelector('[data-context-target]')?.dataset.messageId, 'msg_1', 'another result must target its own stable ID');
  await search('after');
  assert.deepEqual(rows(), ['msg_4'], 'changing the query leaves context mode');
  assert.equal(document.querySelector('[data-context-target]'), null);
  await search('no results');
  assert.deepEqual(rows(), []);
  await search('');
  assert.deepEqual(rows(), messages.map(message => message.id));
  assert.equal(findButton('查看上下文'), undefined, 'ordinary timeline is not cluttered with search-only controls');
});
