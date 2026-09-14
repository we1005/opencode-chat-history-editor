import { createHash, randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';

export type MessagePart = Record<string, unknown> & {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
};

export class EditorError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function revision(part: MessagePart): string {
  return createHash('sha256').update(canonical(part)).digest('hex');
}

export interface PartLocation { sessionID: string; messageID: string; partID: string; directory: string }
export interface PartSnapshot { part: MessagePart; revision: string }
interface Backup { id: string; createdAt: string; before: MessagePart; after: MessagePart }

export class PartEditor {
  private locks = new Set<string>();

  constructor(
    private baseURL = process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4096',
    readonly backupDirectory = process.env.EDITOR_BACKUP_DIR || path.join(
      process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'opencode-message-editor', 'backups'),
    private password = process.env.OPENCODE_SERVER_PASSWORD || '',
    private username = process.env.OPENCODE_SERVER_USERNAME || 'opencode',
  ) {}

  async request<T>(route: string, directory?: string, method = 'GET', body?: unknown): Promise<T> {
    const url = new URL(this.baseURL.replace(/\/$/, '') + route);
    if (directory) url.searchParams.set('directory', directory);
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.password ? { Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new EditorError(503, '无法连接 OpenCode API。请运行 npm run opencode，或检查 OPENCODE_SERVER_URL。请求超时后请先重新加载，确认是否已保存。');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      throw new EditorError(response.status, `OpenCode API (${response.status}): ${detail}`);
    }
    return await response.json() as T;
  }

  async status() {
    const health = await this.request<{ healthy: boolean; version: string }>('/global/health');
    // Credentials stay on the backend, including credentials embedded in a URL.
    const url = new URL(this.baseURL);
    url.username = ''; url.password = ''; url.search = '';
    return { ...health, url: url.toString(), backupDirectory: this.backupDirectory };
  }

  async get(location: PartLocation): Promise<PartSnapshot> {
    const message = await this.request<{ info: { id: string; sessionID: string }; parts: MessagePart[] }>(
      `/session/${encodeURIComponent(location.sessionID)}/message/${encodeURIComponent(location.messageID)}`, location.directory);
    if (message.info.id !== location.messageID || message.info.sessionID !== location.sessionID) {
      throw new EditorError(409, 'OpenCode 返回了不匹配的消息。');
    }
    const part = message.parts.find(p => p.id === location.partID && p.messageID === location.messageID && p.sessionID === location.sessionID);
    if (!part) throw new EditorError(404, '此消息片段已不存在，请刷新会话。');
    return { part, revision: revision(part) };
  }

  private backupPath(location: PartLocation): string {
    // Hash the identity, never use IDs from a request as filesystem paths.
    const key = createHash('sha256').update(JSON.stringify([location.sessionID, location.messageID, location.partID])).digest('hex');
    return path.join(this.backupDirectory, key);
  }

  history(location: PartLocation) {
    let names: string[];
    try { names = readdirSync(this.backupPath(location)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    return names.filter(name => name.endsWith('.json')).sort().reverse().slice(0, 50).map(name => {
      const record = JSON.parse(readFileSync(path.join(this.backupPath(location), name), 'utf8')) as Backup;
      return { id: record.id, createdAt: record.createdAt, part: record.before };
    });
  }

  async update(location: PartLocation, input: { revision?: unknown; part?: unknown }): Promise<PartSnapshot> {
    if (typeof input.revision !== 'string' || !input.part || typeof input.part !== 'object' || Array.isArray(input.part)) {
      throw new EditorError(400, '需要 revision 和完整的 part JSON 对象。');
    }
    const next = input.part as MessagePart;
    if (next.id !== location.partID || next.messageID !== location.messageID || next.sessionID !== location.sessionID) {
      throw new EditorError(400, '不能修改 id、messageID 或 sessionID。');
    }
    const key = this.backupPath(location);
    if (this.locks.has(key)) throw new EditorError(409, '此片段正在保存，请稍后重试。');
    this.locks.add(key);
    try {
      const statuses = await this.request<Record<string, { type: string }>>('/session/status', location.directory);
      if (statuses[location.sessionID] && statuses[location.sessionID].type !== 'idle') {
        throw new EditorError(409, '此会话仍在生成内容，请等待完成后编辑。');
      }
      const current = await this.get(location);
      if (current.revision !== input.revision) {
        throw new EditorError(409, '内容已被其他窗口或 OpenCode 修改。草稿已保留；请重新加载最新版本后合并。');
      }
      if (current.part.type !== next.type) throw new EditorError(400, '不能改变片段类型；请保留原来的 type。');
      if (['text', 'reasoning'].includes(next.type) && typeof next.text !== 'string') {
        throw new EditorError(400, '正文和思考过程的 text 必须是字符串，可以为空。');
      }
      if (revision(next) === current.revision) return current;
      const id = `${Date.now()}-${randomUUID()}`;
      mkdirSync(key, { recursive: true, mode: 0o700 });
      // Persist the original BEFORE writing. A failed PATCH may leave an attempted-edit backup.
      writeFileSync(path.join(key, `${id}.json`), JSON.stringify({
        id, createdAt: new Date().toISOString(), before: current.part, after: next,
      } satisfies Backup, null, 2), { flag: 'wx', mode: 0o600 });
      const result = await this.request<MessagePart>(
        `/session/${encodeURIComponent(location.sessionID)}/message/${encodeURIComponent(location.messageID)}/part/${encodeURIComponent(location.partID)}`,
        location.directory, 'PATCH', next);
      if (revision(result) !== revision(next)) {
        throw new EditorError(502, 'OpenCode 返回内容与草稿不一致；请重新加载核对，原文已备份。');
      }
      const saved = await this.get(location);
      if (saved.revision !== revision(result)) throw new EditorError(409, '保存后内容又发生变化，请重新加载核对。');
      return saved;
    } finally { this.locks.delete(key); }
  }
}

export const partEditor = new PartEditor();
