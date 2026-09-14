const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { PartEditor, revision } = require('../dist/services/partEditor');

async function fixture(t, type = 'text') {
  const directory = mkdtempSync(path.join(tmpdir(), 'part-editor-test-'));
  const location = { sessionID: 'ses_test', messageID: 'msg_test', partID: 'prt_test', directory: '/中文 project' };
  const original = { id: location.partID, messageID: location.messageID, sessionID: location.sessionID,
    type, text: ' original\n原文 ', time: { start: 1, end: 2 }, metadata: { provider: { signature: 'keep-me' } } };
  const state = { current: structuredClone(original), status: 'idle', writes: 0, reject: false };
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Basic ${Buffer.from('opencode:test-password').toString('base64')}`);
    assert.equal(new URL(req.url, 'http://test').searchParams.get('directory'), location.directory);
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/session/status')) return res.end(JSON.stringify({ ses_test: { type: state.status } }));
    if (req.method === 'PATCH') {
      state.writes++;
      if (state.reject) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid part' })); }
      let body = ''; for await (const chunk of req) body += chunk;
      state.current = JSON.parse(body); return res.end(JSON.stringify(state.current));
    }
    res.end(JSON.stringify({ info: { id: location.messageID, sessionID: location.sessionID }, parts: state.current ? [state.current] : [] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(directory, { recursive: true, force: true }); });
  const editor = new PartEditor(`http://127.0.0.1:${server.address().port}`, directory, 'test-password');
  return { editor, location, state, original };
}

test('edits text and reasoning losslessly, backs up original, restores through the same API', async t => {
  for (const type of ['text', 'reasoning']) {
    const { editor, location, state, original } = await fixture(t, type);
    const snapshot = await editor.get(location);
    const next = { ...snapshot.part, text: '  修改\n```ts\nlet n = 1\n```\n' };
    const saved = await editor.update(location, { revision: snapshot.revision, part: next });
    assert.deepEqual(saved.part, next);
    assert.deepEqual(saved.part.metadata, original.metadata);
    const backups = editor.history(location);
    assert.equal(backups.length, 1);
    assert.deepEqual(backups[0].part, original);
    await editor.update(location, { revision: saved.revision, part: backups[0].part });
    assert.deepEqual(state.current, original);
  }
});

test('empty strings are saved; no-op saves do not write', async t => {
  const { editor, location, state } = await fixture(t);
  const current = await editor.get(location);
  await editor.update(location, current);
  assert.equal(state.writes, 0);
  await editor.update(location, { revision: current.revision, part: { ...current.part, text: '' } });
  assert.equal(state.current.text, '');
});

test('stale drafts and active generation are refused without overwriting', async t => {
  const { editor, location, state } = await fixture(t);
  const current = await editor.get(location);
  const draft = { revision: current.revision, part: { ...current.part, text: 'old draft' } };
  state.current.text = 'external edit';
  await assert.rejects(editor.update(location, draft), error => error.status === 409);
  assert.equal(state.current.text, 'external edit');
  state.status = 'busy';
  await assert.rejects(editor.update(location, draft), error => error.status === 409);
  assert.equal(state.writes, 0);
  assert.deepEqual(editor.history(location), []);
});

test('identity, type, malformed JSON object and non-string text cannot corrupt a part', async t => {
  const { editor, location, state } = await fixture(t);
  const current = await editor.get(location);
  for (const part of [null, [], { ...current.part, sessionID: 'ses_other' }, { ...current.part, type: 'tool' }, { ...current.part, text: 1 }]) {
    await assert.rejects(editor.update(location, { revision: current.revision, part }), error => error.status === 400);
  }
  assert.equal(state.writes, 0);
});

test('upstream errors retain the original and its backup', async t => {
  const { editor, location, state, original } = await fixture(t);
  state.reject = true;
  const current = await editor.get(location);
  await assert.rejects(editor.update(location, { revision: current.revision, part: { ...current.part, text: 'draft' } }), error => error.status === 400);
  assert.deepEqual(state.current, original);
  assert.deepEqual(editor.history(location)[0].part, original);
});

test('deleted parts are not silently recreated', async t => {
  const { editor, location, state } = await fixture(t);
  const current = await editor.get(location);
  state.current = null;
  await assert.rejects(editor.update(location, current), error => error.status === 404);
  assert.equal(state.writes, 0);
});

test('JSON key ordering does not create false conflicts', () => {
  assert.equal(revision({ a: 1, b: { c: 2, d: [1, 2] } }), revision({ b: { d: [1, 2], c: 2 }, a: 1 }));
});
