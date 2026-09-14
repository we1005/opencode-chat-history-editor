import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = ['backend', 'frontend'].map(folder => spawn(
  process.execPath,
  folder === 'backend'
    ? [path.join(root, 'backend/node_modules/ts-node/dist/bin.js'), 'src/index.ts']
    : [path.join(root, 'frontend/node_modules/vite/bin/vite.js')],
  { cwd: path.join(root, folder), stdio: 'inherit' },
));
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach(child => child.kill('SIGTERM'));
  process.exitCode = code;
}
children.forEach(child => {
  child.on('error', error => { console.error(error); close(1); });
  child.on('exit', code => close(code || 0));
});
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
