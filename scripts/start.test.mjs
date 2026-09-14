import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { accessSync, constants, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = path.join(root, 'start.sh');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const opencode = [process.env.OPENCODE_BIN, ...(process.env.PATH || '').split(path.delimiter).map(directory => path.join(directory, 'opencode')), path.join(homedir(), '.opencode/bin/opencode')]
  .filter(Boolean).find(file => { try { accessSync(file, constants.X_OK); return true; } catch { return false; } });

test('missing Node.js, missing OpenCode and invalid ports produce actionable errors', () => {
  const missingNode = spawnSync('/bin/sh', [entry], { encoding: 'utf8', env: { PATH: '/nonexistent' } });
  assert.equal(missingNode.status, 1);
  assert.match(missingNode.stderr, /未安装 Node.js/);
  const missingOpenCode = spawnSync('/bin/sh', [entry], { encoding: 'utf8', env: { ...process.env, OPENCODE_BIN: '/nonexistent/opencode' } });
  assert.equal(missingOpenCode.status, 1);
  assert.match(missingOpenCode.stderr, /OpenCode/);
  const invalid = spawnSync('/bin/sh', [entry, '--backend-port', '65536'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /1–65535/);
});

async function bind(port) {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"fixture":"unrelated occupied port"}'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

function close(server) {
  server.closeAllConnections();
  return new Promise(resolve => server.close(resolve));
}

async function reserveRange() {
  for (let base = 28000; base < 30000; base += 10) {
    const servers = [];
    try {
      for (let i = 0; i < 7; i++) servers.push(await bind(base + i));
      return { base, servers };
    } catch { await Promise.all(servers.map(close)); }
  }
  throw new Error('Could not reserve a port range for startup tests');
}

function run(env, args = []) {
  const child = spawn('/bin/sh', [entry, '--no-install', ...args], { cwd: env.HOME, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = { child, output: '' };
  child.stdout.on('data', chunk => { record.output += chunk; });
  child.stderr.on('data', chunk => { record.output += chunk; });
  return record;
}

async function started(record) {
  const deadline = Date.now() + 50000;
  while (Date.now() < deadline) {
    const frontend = record.output.match(/前端 URL：(http:\/\/[^\s]+)/)?.[1];
    const backend = record.output.match(/编辑后端：(http:\/\/[^\s]+)/)?.[1];
    const api = record.output.match(/OpenCode API：(http:\/\/[^\s]+)/)?.[1];
    if (frontend && backend && api) return { frontend, backend, api };
    if (record.child.exitCode !== null || record.child.signalCode !== null) throw new Error(record.output);
    await sleep(100);
  }
  throw new Error(`Startup timed out:\n${record.output}`);
}

async function stopped(record, signal = 'SIGTERM') {
  if (record.child.exitCode !== null || record.child.signalCode !== null) return;
  record.child.kill(signal);
  for (let i = 0; i < 70; i++) {
    if (record.child.exitCode !== null || record.child.signalCode !== null) return;
    await sleep(100);
  }
  record.child.kill('SIGKILL');
  throw new Error(`Startup supervisor did not shut down:\n${record.output}`);
}

async function portIsFree(url) {
  try { const server = await bind(Number(new URL(url).port)); await close(server); return true; }
  catch { return false; }
}

test('real startup handles occupied ports, credentials, reuse, proxy routing and owned-process cleanup', { timeout: 120000 }, async t => {
  assert.ok(opencode, 'OpenCode must be installed for the real startup integration test');
  const home = mkdtempSync(path.join(tmpdir(), 'editor startup test '));
  const { base, servers } = await reserveRange();
  const held = [servers[0], servers[2], servers[4], servers[6]];
  const processes = [];
  t.after(async () => {
    for (const record of processes.reverse()) await stopped(record);
    await Promise.all(held.map(close));
    rmSync(home, { recursive: true, force: true });
  });
  await Promise.all([servers[1], servers[3], servers[5]].map(close));
  const secret = 'startup-fixture-password:with spaces';
  const env = {
    PATH: process.env.PATH, HOME: home, OPENCODE_BIN: opencode,
    XDG_DATA_HOME: path.join(home, 'data'), XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'), XDG_STATE_HOME: path.join(home, 'state'), OPENCODE_TEST_HOME: home,
    DB_PATH: path.join(home, 'data/opencode/opencode.db'), EDITOR_RUN_DIR: path.join(home, 'logs'),
    OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_CONFIG_CONTENT: '{"plugin":[]}',
    OPENCODE_SERVER_PASSWORD: secret, OPENCODE_SERVER_USERNAME: 'opencode', STARTUP_TIMEOUT: '15',
  };
  for (const directory of [env.XDG_DATA_HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_STATE_HOME]) mkdirSync(directory, { recursive: true });
  const first = run(env, ['--opencode-port', String(base), '--backend-port', String(base + 2), '--frontend-port', String(base + 4)]);
  processes.push(first);
  const a = await started(first);
  assert.equal(Number(new URL(a.api).port), base + 1);
  assert.equal(Number(new URL(a.backend).port), base + 3);
  assert.equal(Number(new URL(a.frontend).port), base + 5);
  assert.equal((await (await fetch(`${a.frontend}/api/editor/status`)).json()).data.healthy, true);
  assert.ok(!first.output.includes(secret), 'credentials must not be printed');

  // A second launch intentionally starts backend/frontend at the SAME occupied
  // port, and must allocate distinct available ports while reusing the API.
  const second = run(env, ['--opencode-port', String(base + 1), '--backend-port', String(base + 3), '--frontend-port', String(base + 3)]);
  processes.push(second);
  const b = await started(second);
  assert.match(second.output, /复用已运行的 OpenCode API/);
  assert.equal(b.api, a.api);
  assert.notEqual(b.backend, a.backend);
  assert.notEqual(b.frontend, a.frontend);
  assert.notEqual(b.backend, b.frontend);
  assert.equal((await (await fetch(`${b.frontend}/api/editor/status`)).json()).data.healthy, true);

  const denied = run({ ...env, OPENCODE_SERVER_PASSWORD: 'wrong-password', OPENCODE_SERVER_URL: a.api });
  processes.push(denied);
  await assert.rejects(started(denied), /401.*检查 OPENCODE_SERVER_USERNAME/s);
  assert.equal(denied.child.exitCode, 1);

  // A configuration failure after starting our backend must clean it up too.
  const badDatabase = run({ ...env, DB_PATH: path.join(home, 'missing.db'), OPENCODE_SERVER_URL: a.api }, ['--backend-port', String(base + 20), '--frontend-port', String(base + 21)]);
  processes.push(badDatabase);
  await assert.rejects(started(badDatabase), /数据库未连接/);
  const attemptedBackend = badDatabase.output.match(/启动 backend，端口 (\d+)/)?.[1];
  assert.ok(attemptedBackend);
  assert.equal(await portIsFree(`http://127.0.0.1:${attemptedBackend}`), true);

  await stopped(second, 'SIGINT');
  assert.equal(await portIsFree(b.backend), true);
  assert.equal(await portIsFree(b.frontend), true);
  const auth = { Authorization: `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}` };
  assert.equal((await (await fetch(`${a.api}/global/health`, { headers: auth })).json()).healthy, true, 'reused API stays alive');

  const crashed = run(env, ['--opencode-port', String(base + 1), '--backend-port', String(base + 20), '--frontend-port', String(base + 21)]);
  processes.push(crashed);
  const c = await started(crashed);
  const backendPID = Number(crashed.output.match(/backend 已就绪（PID (\d+)）/)?.[1]);
  assert.ok(backendPID > 0);
  process.kill(backendPID, 'SIGKILL');
  for (let i = 0; i < 70 && crashed.child.exitCode === null; i++) await sleep(100);
  assert.equal(crashed.child.exitCode, 1, 'an unexpected service exit must stop the supervisor with an error');
  assert.match(crashed.output, /backend 意外退出/);
  for (const url of [c.backend, c.frontend]) assert.equal(await portIsFree(url), true, 'other owned services are cleaned up');
  assert.equal((await (await fetch(`${a.api}/global/health`, { headers: auth })).json()).healthy, true, 'crash cleanup does not stop reused API');

  await stopped(first);
  for (const url of [a.frontend, a.backend, a.api]) assert.equal(await portIsFree(url), true, `${url} must be released`);
  for (const server of held) assert.equal(server.listening, true, 'unrelated port owners must not be stopped');
});
