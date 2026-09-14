// The SH entry point delegates networking/process supervision to Node, already
// required by the app. No dependency on lsof, curl, nc, Python or GNU shell tools.
import { spawn, execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = '127.0.0.1';
const children = [];
let closing = false;
let runDirectory;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const say = message => console.log(`[启动] ${message}`);

function usage() {
  console.log(`OpenCode Message Editor 一键启动（macOS / Linux）

用法：./start.sh [选项]

  --backend-port N   编辑器后端起始端口（默认 9001）
  --frontend-port N  前端起始端口（默认 9000）
  --opencode-port N  本地 OpenCode API 起始端口（默认 4096）
  --no-install      依赖不齐时直接报错，不自动 npm ci
  -h, --help        显示帮助

端口占用时逐个 +1 查找，不结束占用端口的其他进程。
启动成功后输出前端 URL；保持终端运行，Ctrl+C 停止本次启动的服务。

环境变量：BACKEND_PORT、FRONTEND_PORT、OPENCODE_PORT、OPENCODE_BIN、
OPENCODE_SERVER_URL、OPENCODE_SERVER_USERNAME、OPENCODE_SERVER_PASSWORD、
EDITOR_RUN_DIR（日志目录）、STARTUP_TIMEOUT（每个服务就绪等待秒数，默认 60）。
支持 backend/.env 和前端 Vite 的 .env 文件；命令行 / 当前环境优先。
显式配置的 OPENCODE_SERVER_URL 只连接、不自动替换；
如需由脚本管理本地 API，可用 --opencode-port 覆盖该地址。`);
}

function port(value, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} 必须是 1–65535 之间的整数，收到：${value}`);
  }
  return Number(value);
}

function options() {
  const result = { install: true };
  const flags = { '--backend-port': 'backend', '--frontend-port': 'frontend', '--opencode-port': 'opencode' };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '-h' || arg === '--help') { usage(); process.exit(0); }
    if (arg === '--no-install') { result.install = false; continue; }
    if (!(arg in flags)) throw new Error(`未知选项：${arg}。运行 ./start.sh --help 查看用法。`);
    result[flags[arg]] = port(process.argv[++i], arg);
  }
  return result;
}

function executable(name, explicit, fallbacks = []) {
  const candidates = explicit ? [explicit] : [
    ...(process.env.PATH || '').split(path.delimiter).map(directory => path.resolve(directory || '.', name)), ...fallbacks,
  ];
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return path.resolve(candidate); } catch { /* Try next PATH entry. */ }
  }
  throw new Error(`${name === 'opencode' ? '未安装 OpenCode 或无法找到可执行文件' : `找不到 ${name}`}。${explicit ? `请检查指定路径：${explicit}` : '请安装并加入 PATH 后重试。'}`);
}

function alive(record) { return record.child.pid && record.child.exitCode === null && record.child.signalCode === null; }
function signal(record, name) {
  if (!alive(record)) return;
  try { process.kill(-record.child.pid, name); }
  catch { try { record.child.kill(name); } catch { /* Already exited. */ } }
}

async function shutdown(code) {
  if (closing) return;
  closing = true;
  const owned = children.filter(alive);
  if (owned.length) say('正在停止本次启动的服务…');
  owned.forEach(record => signal(record, 'SIGTERM'));
  const deadline = Date.now() + 4000;
  while (owned.some(alive) && Date.now() < deadline) await sleep(100);
  owned.forEach(record => signal(record, 'SIGKILL'));
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

function logExcerpt(record) {
  try { return readFileSync(record.log, 'utf8').slice(-6000); } catch { return record.error?.message || ''; }
}

function launch(name, command, args, env, cwd, attempt = 0, inherit = false) {
  if (closing) throw new Error('启动已取消。');
  const log = inherit ? undefined : path.join(runDirectory, `${name}${attempt ? `-${attempt}` : ''}.log`);
  const fd = log ? openSync(log, 'a', 0o600) : undefined;
  let child;
  try {
    child = spawn(command, args, { cwd, env, detached: true, stdio: inherit ? 'inherit' : ['ignore', fd, fd] });
  } finally { if (fd !== undefined) closeSync(fd); }
  const record = { name, child, log, critical: false, error: undefined };
  children.push(record);
  child.on('error', error => { record.error = error; });
  child.on('exit', (code, sig) => {
    if (!closing && record.critical) {
      console.error(`\n错误：${name} 意外退出（${sig || code}）。日志：${log}\n${logExcerpt(record)}`);
      void shutdown(1);
    }
  });
  return record;
}

async function installDependencies(npm, folder, allow) {
  const require = createRequire(path.join(root, folder, 'package.json'));
  const packageJSON = JSON.parse(readFileSync(path.join(root, folder, 'package.json'), 'utf8'));
  const names = Object.keys({ ...packageJSON.dependencies, ...packageJSON.devDependencies });
  const missing = names.some(name => {
    try { require.resolve(name); return false; }
    catch { return !existsSync(path.join(root, folder, 'node_modules', name, 'package.json')); }
  });
  if (missing) {
    if (!allow) throw new Error(`${folder} 依赖不完整。请先运行 npm run setup，或去掉 --no-install。`);
    say(`${folder} 依赖不完整，正在运行 npm ci…`);
    const record = launch(`安装 ${folder}`, npm, ['ci', '--prefix', folder], process.env, root, 0, true);
    await new Promise((resolve, reject) => {
      record.child.once('error', reject);
      record.child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${folder} 依赖安装失败，请检查上方 npm 输出和网络连接。`)));
    });
  }
}

async function available(start, reserved = new Set()) {
  for (let candidate = start; candidate <= 65535; candidate++) {
    if (reserved.has(candidate)) continue;
    const free = await new Promise((resolve, reject) => {
      const socket = createServer();
      socket.once('error', error => ['EADDRINUSE', 'EACCES'].includes(error.code) ? resolve(false) : reject(error));
      socket.listen({ host, port: candidate, exclusive: true }, () => socket.close(() => resolve(true)));
    });
    if (free) return candidate;
  }
  throw new Error(`从 ${start} 到 65535 没有可用端口。请指定较小的起始端口。`);
}

async function request(url, password = '', username = 'opencode') {
  try {
    const response = await fetch(url, { headers: password ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } : {}, signal: AbortSignal.timeout(2000) });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, ok: response.ok, data };
  } catch { return { status: 0, ok: false, data: undefined }; }
}

async function ready(record, check, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (closing) return false;
    if (record.error || !alive(record)) return false;
    if (await check()) {
      // Give a child that lost a bind race time to report EADDRINUSE, rather than
      // mistaking the process that took its port for this newly started service.
      await sleep(200);
      return !record.error && alive(record);
    }
    await sleep(200);
  }
  return false;
}

async function startService({ name, start, reserved, command, args, env, cwd, check, timeout }) {
  let candidate = start;
  for (let attempt = 0; attempt < 5; attempt++) {
    const chosen = await available(candidate, reserved);
    if (chosen !== start) say(`${name}：起始端口 ${start} 不可用，改用 ${chosen}。`);
    say(`启动 ${name}，端口 ${chosen}…`);
    const record = launch(name, command, args(chosen), env(chosen), cwd, attempt);
    if (await ready(record, () => check(chosen), timeout)) {
      record.critical = true;
      say(`${name} 已就绪（PID ${record.child.pid}）。`);
      return { port: chosen, record };
    }
    signal(record, 'SIGTERM');
    const diagnostic = logExcerpt(record);
    if (/EADDRINUSE|address already in use|port .* in use|Failed to start server on port/i.test(diagnostic)) {
      signal(record, 'SIGKILL');
      candidate = chosen + 1;
      continue;
    }
    throw new Error(`${name} 未能就绪。日志：${record.log}\n${diagnostic}`);
  }
  throw new Error(`${name} 连续发生端口冲突，请稍后重试或指定其他起始端口。`);
}

async function main() {
  const flags = options();
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error(`需要 Node.js 22 或更新版本，当前为 ${process.version}。`);
  const npm = executable('npm');
  const opencode = executable('opencode', process.env.OPENCODE_BIN, [path.join(homedir(), '.opencode', 'bin', 'opencode')]);
  let version;
  try { version = execFileSync(opencode, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(); }
  catch { throw new Error(`OpenCode 已找到但无法运行：${opencode}。请先检查 opencode --version。`); }
  say(`Node.js ${process.version}；OpenCode ${version}（${opencode}）`);
  await installDependencies(npm, 'backend', flags.install);
  await installDependencies(npm, 'frontend', flags.install);
  const require = createRequire(path.join(root, 'backend/package.json'));
  try { const Database = require('better-sqlite3'); new Database(':memory:').close(); }
  catch { throw new Error('better-sqlite3 无法在当前 Node.js 下加载。请运行 npm rebuild --prefix backend better-sqlite3 后重试。'); }
  const dotenv = require('dotenv');
  const readEnv = file => existsSync(file) ? dotenv.parse(readFileSync(file)) : {};
  const backendEnv = { ...readEnv(path.join(root, 'backend/.env')), ...process.env };
  const frontendEnv = Object.assign({}, ...['.env', '.env.local', '.env.development', '.env.development.local'].map(file => readEnv(path.join(root, 'frontend', file))), process.env);
  const initialBackend = port(flags.backend ?? backendEnv.BACKEND_PORT ?? backendEnv.PORT ?? 9001, '后端端口');
  const initialFrontend = port(flags.frontend ?? frontendEnv.FRONTEND_PORT ?? frontendEnv.VITE_PORT ?? 9000, '前端端口');
  const initialOpenCode = port(flags.opencode ?? backendEnv.OPENCODE_PORT ?? 4096, 'OpenCode 端口');
  const seconds = Number(backendEnv.STARTUP_TIMEOUT || 60);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) throw new Error('STARTUP_TIMEOUT 必须在 0–600 秒之间且大于 0。');
  const timeout = seconds * 1000;
  const password = backendEnv.OPENCODE_SERVER_PASSWORD || '';
  const username = backendEnv.OPENCODE_SERVER_USERNAME || 'opencode';
  const explicitURL = flags.opencode === undefined && backendEnv.OPENCODE_PORT === undefined && !!backendEnv.OPENCODE_SERVER_URL;
  let apiURL = explicitURL ? backendEnv.OPENCODE_SERVER_URL.replace(/\/$/, '') : `http://${host}:${initialOpenCode}`;
  const parsedURL = new URL(apiURL);
  if (!['http:', 'https:'].includes(parsedURL.protocol) || parsedURL.username || parsedURL.password || parsedURL.search || parsedURL.hash) {
    throw new Error('OPENCODE_SERVER_URL 必须是 HTTP(S) 地址且不含账号、密码、查询或片段；认证请使用 OPENCODE_SERVER_USERNAME / PASSWORD。');
  }
  process.umask(0o077);
  runDirectory = path.join(path.resolve(root, backendEnv.EDITOR_RUN_DIR || '.run'), `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  say(`启动日志：${runDirectory}`);
  const isOpenCode = result => result.ok && result.data?.healthy === true && typeof result.data.version === 'string';
  const existing = await request(`${apiURL}/global/health`, password, username);
  if (isOpenCode(existing)) {
    say(`复用已运行的 OpenCode API：${apiURL}`);
  } else if (explicitURL || existing.status === 401 || existing.status === 403) {
    throw new Error(`OpenCode API 连接失败：${apiURL}（${existing.status || '无法连接'}）。${[401, 403].includes(existing.status) ? '请检查 OPENCODE_SERVER_USERNAME 和 OPENCODE_SERVER_PASSWORD。' : '请确认服务已启动；如需自动启动本地服务，使用 --opencode-port 指定起始端口。'}`);
  } else {
    const api = await startService({ name: 'opencode', start: initialOpenCode, command: opencode, timeout, cwd: root,
      args: chosen => ['serve', '--hostname', host, '--port', String(chosen)], env: () => backendEnv,
      check: async chosen => isOpenCode(await request(`http://${host}:${chosen}/global/health`, password, username)),
    });
    apiURL = `http://${host}:${api.port}`;
  }

  // Plan both editor ports so equal start values cannot select the same port.
  const plannedBackend = await available(initialBackend);
  const plannedFrontend = await available(initialFrontend, new Set([plannedBackend]));
  const backend = await startService({ name: 'backend', start: initialBackend, reserved: new Set([plannedFrontend]), command: process.execPath, timeout, cwd: path.join(root, 'backend'),
    args: () => [path.join(root, 'backend/node_modules/ts-node/dist/bin.js'), 'src/index.ts'],
    env: chosen => ({ ...backendEnv, HOST: host, PORT: String(chosen), OPENCODE_SERVER_URL: apiURL, CORS_ORIGIN: `http://${host}:${plannedFrontend}` }),
    check: async chosen => {
      const result = await request(`http://${host}:${chosen}/health`);
      return result.ok && result.data?.status === 'ok';
    },
  });
  const backendURL = `http://${host}:${backend.port}`;
  const database = await request(`${backendURL}/api/config/database`);
  if (!database.ok || !database.data?.success || !database.data.data?.connected) {
    throw new Error(`后端已启动，但 OpenCode 数据库未连接。请检查 DB_PATH / XDG_DATA_HOME。日志：${backend.record.log}`);
  }
  const frontend = await startService({ name: 'frontend', start: initialFrontend, reserved: new Set([backend.port]), command: process.execPath, timeout, cwd: path.join(root, 'frontend'),
    args: chosen => [path.join(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', host, '--port', String(chosen), '--strictPort'],
    env: chosen => ({ ...frontendEnv, VITE_PORT: String(chosen), VITE_API_BASE: '/api', EDITOR_API_PROXY: backendURL }),
    check: async chosen => {
      const result = await request(`http://${host}:${chosen}`);
      return result.ok && typeof result.data === 'string' && result.data.includes('/@vite/client');
    },
  });
  const frontendURL = `http://${host}:${frontend.port}`;
  const connection = await request(`${frontendURL}/api/editor/status`);
  if (!connection.ok || !connection.data?.success || connection.data.data?.healthy !== true) {
    throw new Error(`页面已启动，但前端 → 后端 → OpenCode API 的连接检查失败。日志：${runDirectory}`);
  }
  console.log(`\n启动成功！\n\n  前端 URL：${frontendURL}\n  编辑后端：${backendURL}\n  OpenCode API：${apiURL}\n  日志目录：${runDirectory}\n\n请在浏览器打开上面的前端 URL。保持此终端运行，按 Ctrl+C 停止本次启动的服务。\n`);
}

main().catch(error => {
  if (closing) return;
  console.error(`\n错误：${error instanceof Error ? error.message : error}`);
  void shutdown(1);
});
