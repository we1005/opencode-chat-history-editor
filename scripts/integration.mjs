// Real OpenCode API integration against a fresh, isolated database. No model calls.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const Database = require('better-sqlite3');
const root = fileURLToPath(new URL('../', import.meta.url));
const sandbox = mkdtempSync(path.join(tmpdir(), 'opencode-editor-integration-'));
const keep = process.argv.includes('--keep');
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const apiPort = Number(process.env.TEST_OPENCODE_PORT || await freePort());
const editorPort = Number(process.env.TEST_EDITOR_PORT || await freePort());
const apiURL = `http://127.0.0.1:${apiPort}`;
const editorURL = `http://127.0.0.1:${editorPort}`;
const children = [];
const env = {
  PATH: process.env.PATH, HOME: sandbox, XDG_DATA_HOME: path.join(sandbox, 'data'),
  XDG_CONFIG_HOME: path.join(sandbox, 'config'), XDG_CACHE_HOME: path.join(sandbox, 'cache'),
  XDG_STATE_HOME: path.join(sandbox, 'state'), OPENCODE_TEST_HOME: sandbox,
  OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
  OPENCODE_CONFIG_CONTENT: '{"plugin":[]}', NO_PROXY: '127.0.0.1,localhost',
};
for (const directory of [env.XDG_DATA_HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_STATE_HOME]) mkdirSync(directory, { recursive: true });
function start(command, args, variables, name, cwd = sandbox) {
  const fd = openSync(path.join(sandbox, `${name}.log`), 'a');
  const child = spawn(command, args, { cwd, env: variables, detached: keep, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.on('error', error => console.error(`${name}:`, error));
  children.push(child);
  return child;
}
async function wait(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Process exited (${child.exitCode}). Logs: ${sandbox}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Server did not start: ${url}. Logs: ${sandbox}`);
}
async function call(base, route, method = 'GET', body) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.ok, true, JSON.stringify(result));
  return result;
}
let db;
let passed = false;
try {
  // Resolve OPENCODE_BIN in the caller environment, before changing HOME.
  const opencode = start(process.env.OPENCODE_BIN || 'opencode', ['serve', '--pure', '--hostname', '127.0.0.1', '--port', String(apiPort)], env, 'opencode');
  await wait(`${apiURL}/global/health`, opencode);
  const session = await call(apiURL, '/session', 'POST', { title: '编辑器验证 · 用户 / Agent / 思考过程' });
  const dbPath = path.join(env.XDG_DATA_HOME, 'opencode', 'opencode.db');
  db = new Database(dbPath, { fileMustExist: true });
  const stamp = Date.now();
  const userID = `msg_${stamp.toString(16)}00001`;
  const assistantID = `msg_${stamp.toString(16)}00002`;
  const laterID = `msg_${stamp.toString(16)}00003`;
  const ids = [`prt_${stamp.toString(16)}00001`, `prt_${stamp.toString(16)}00002`, `prt_${stamp.toString(16)}00003`, `prt_${stamp.toString(16)}00004`, `prt_${stamp.toString(16)}00005`];
  const model = { providerID: 'test', modelID: 'fixture' };
  const insertMessage = db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)');
  const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)');
  // Fixture-only SQL seeds completed assistant messages without consuming model tokens.
  insertMessage.run(userID, session.id, stamp, stamp, JSON.stringify({ role: 'user', time: { created: stamp }, agent: 'build', model }));
  insertMessage.run(assistantID, session.id, stamp + 1, stamp + 1, JSON.stringify({ role: 'assistant', time: { created: stamp + 1, completed: stamp + 2 }, parentID: userID,
    modelID: model.modelID, providerID: model.providerID, mode: 'build', agent: 'build', path: { cwd: sandbox, root: sandbox }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, finish: 'stop' }));
  insertMessage.run(laterID, session.id, stamp + 3, stamp + 3, JSON.stringify({ role: 'user', time: { created: stamp + 3 }, agent: 'build', model }));
  const entries = [
    [ids[0], userID, { type: 'text', text: '请把标题改成蓝色。\n保留其他内容。' }],
    [ids[1], assistantID, { type: 'reasoning', text: '先确认主题配置，再调整标题颜色。', time: { start: stamp, end: stamp + 1 }, metadata: { test: { marker: 'preserve' } } }],
    [ids[2], assistantID, { type: 'text', text: '已将标题设置为 **蓝色**。' }],
    [ids[3], laterID, { type: 'text', text: '这是后续消息，编辑前面的消息时必须保留。' }],
    [ids[4], assistantID, { type: 'tool', tool: 'read', callID: 'call_fixture', state: { status: 'completed', input: { filePath: 'theme.ts' }, output: 'color: blue', title: 'Read theme', metadata: {}, time: { start: stamp, end: stamp + 1 } } }],
  ];
  entries.forEach(([id, messageID, part], index) => insertPart.run(id, messageID, session.id, stamp + index, stamp + index, JSON.stringify(part)));
  const editor = start(process.execPath, [path.join(root, 'backend/dist/index.js')], {
    ...env, PORT: String(editorPort), HOST: '127.0.0.1', DB_PATH: dbPath,
    OPENCODE_SERVER_URL: apiURL, EDITOR_BACKUP_DIR: path.join(sandbox, 'backups'),
  }, 'editor', path.join(root, 'backend'));
  await wait(`${editorURL}/health`, editor);
  const api = route => `/api${route}`;
  const messageRows = db.prepare('SELECT * FROM message ORDER BY id').all();
  const untouched = db.prepare('SELECT * FROM part WHERE id = ?').get(ids[3]);
  const eventCountBefore = db.prepare('SELECT count(*) AS count FROM event').get().count;
  const targets = [entries[0], entries[1], entries[2], entries[4]];
  for (const [id, messageID, part] of targets) {
    const route = api(`/editor/sessions/${session.id}/messages/${messageID}/parts/${id}`);
    const { data: current } = await call(editorURL, route);
    const next = part.type === 'tool' ? { ...current.part, state: { ...current.part.state, output: 'color: green' } } : { ...current.part, text: `${part.text}\n\n已通过真实 API 修改 ✓` };
    const { data: saved } = await call(editorURL, route, 'PATCH', { revision: current.revision, part: next });
    const stored = JSON.parse(db.prepare('SELECT data FROM part WHERE id = ?').get(id).data);
    assert.equal(stored.type, part.type);
    if (part.type === 'tool') assert.equal(stored.state.output, 'color: green');
    else assert.equal(stored.text, next.text);
    if (part.metadata) assert.deepEqual(stored.metadata, part.metadata);
    const conflict = await fetch(editorURL + route, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: current.revision, part: next }) });
    assert.equal(conflict.status, 409);
    const { data: history } = await call(editorURL, `${route}/history`);
    assert.equal(history.length, 1);
    await call(editorURL, route, 'PATCH', { revision: saved.revision, part: history[0].part });
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM part WHERE id = ?').get(id).data), part);
    console.log(`PASS: ${part.type} / ${messageID === userID ? 'user' : 'assistant'} edit, persistence, conflict, backup, restore`);
  }
  assert.deepEqual(db.prepare('SELECT * FROM message ORDER BY id').all(), messageRows);
  assert.deepEqual(db.prepare('SELECT * FROM part WHERE id = ?').get(ids[3]), untouched);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%event%' OR name LIKE '%sync%')").all().map(row => row.name);
  const eventCountAfter = db.prepare('SELECT count(*) AS count FROM event').get().count;
  assert.ok(eventCountAfter >= eventCountBefore + targets.length * 2, 'OpenCode must persist update events for edits and restores');
  console.log('PASS: all message rows and later part unchanged; update events persisted; event tables:', tables.join(', '));
  const info = { sandbox, dbPath, apiURL, editorURL, sessionID: session.id, url: `${editorURL}/sessions/${session.id}`,
    pids: children.map(child => child.pid), checked: ['user text', 'assistant text', 'reasoning', 'tool JSON', 'metadata', 'backup restore', '409 conflicts', 'retained later history'] };
  mkdirSync(path.join(root, '.editor-test'), { recursive: true });
  writeFileSync(path.join(root, '.editor-test/connection.json'), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  passed = true;
} finally {
  db?.close();
  if (!keep || !passed) children.forEach(child => child.kill('SIGTERM'));
  else children.forEach(child => child.unref());
}
