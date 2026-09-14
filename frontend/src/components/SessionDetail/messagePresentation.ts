import type { Message, Part } from '../../types/session';

export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

export function parseRecord(raw: string): JsonObject {
  try { return object(JSON.parse(raw)); } catch { return {}; }
}

export function printable(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

export function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return printable(value);
}

export function duration(time: unknown): string | undefined {
  const { start, end, created, completed } = object(time);
  const from = typeof start === 'number' ? start : created;
  const to = typeof end === 'number' ? end : completed;
  if (typeof from !== 'number' || typeof to !== 'number' || to < from) return;
  const ms = to - from;
  return ms < 1000 ? `${ms}ms` : `${Number((ms / 1000).toFixed(2))}s`;
}

export interface DisplayPart { record: Part; data: JsonObject; invalid: boolean }
export function messageParts(message: Message): DisplayPart[] {
  return (message.parts || []).map(record => {
    try {
      const data = JSON.parse(record.data);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Not an object');
      return { record, data, invalid: false };
    } catch { return { record, data: {}, invalid: true }; }
  });
}

export function tokenSummary(value: unknown): string {
  const tokens = object(value);
  const cache = object(tokens.cache);
  const values = [
    ['总量', tokens.total], ['输入', tokens.input], ['输出', tokens.output], ['推理', tokens.reasoning],
    ['缓存读取', cache.read], ['缓存写入', cache.write],
  ];
  return values.filter(([, n]) => typeof n === 'number').map(([name, n]) => `${name} ${(n as number).toLocaleString()}`).join(' · ');
}

export function childSession(part: JsonObject): string | undefined {
  const state = object(part.state);
  const candidates = [object(state.metadata), object(part.metadata), state, part];
  for (const candidate of candidates) {
    for (const key of ['sessionID', 'sessionId', 'session_id', 'task_id']) {
      const value = candidate[key];
      if (typeof value === 'string' && /^ses_[\w-]+$/.test(value)) return value;
    }
  }
  const output = printable(state.output);
  return output.match(/<task\s+id=["'](ses_[\w-]+)["']/)?.[1]
    || output.match(/<task_id>\s*(ses_[\w-]+)\s*<\/task_id>/)?.[1];
}
