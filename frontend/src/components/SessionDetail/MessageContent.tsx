import { useState, type ReactNode } from 'react';
import { Alert, AlertTitle, Box, Button, Link, Typography } from '@mui/material';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import PsychologyOutlinedIcon from '@mui/icons-material/PsychologyOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../../types/session';
import { childSession, duration, messageParts, object, pretty, printable, tokenSummary, type DisplayPart, type JsonObject } from './messagePresentation';

export function RawContent({ value }: { value: unknown }) {
  return <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1,
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13, lineHeight: 1.65,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 520, overflow: 'auto', tabSize: 2 }}>
    {pretty(value)}
  </Box>;
}

// Expensive raw JSON is mounted on demand, but its complete contents are never sliced.
export function RawDetails({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return <Box component="details" onToggle={event => setOpen(event.currentTarget.open)} sx={{ width: '100%', minWidth: 0, mt: 1 }}>
    <Box component="summary" sx={{ cursor: 'pointer', py: 0.75, color: 'text.secondary', fontSize: 12 }}>{label}</Box>
    {open && <RawContent value={value} />}
  </Box>;
}

function MarkdownBody({ text, user = false }: { text: string; user?: boolean }) {
  const [raw, setRaw] = useState(false);
  // Literal XML/file dumps should remain literal; Markdown would hide tag contents.
  const literal = /<(?:path|type|content|system-reminder|file|tool_result)(?:\s|>)/.test(text);
  return <Box sx={{ width: '100%', minWidth: 0 }}>
    {raw || literal ? <RawContent value={text} /> : <Box sx={{ fontSize: 14, lineHeight: 1.75, overflowWrap: 'anywhere',
      '& > :first-of-type': { mt: 0 }, '& > :last-child': { mb: 0 },
      '& p': { whiteSpace: 'pre-wrap' }, '& pre': { overflow: 'auto', p: 1.5, bgcolor: user ? 'rgba(0,0,0,.2)' : 'action.hover', borderRadius: 1, maxHeight: 520 },
      '& pre code': { whiteSpace: 'pre', padding: 0 }, '& code': { fontFamily: 'ui-monospace, monospace', fontSize: 13 },
      '& a': { color: user ? '#fff' : 'primary.main', textDecoration: 'underline' },
      '& table': { display: 'block', overflow: 'auto', borderCollapse: 'collapse' }, '& td, & th': { border: '1px solid', borderColor: 'divider', p: 1 },
      '& blockquote': { borderLeft: '3px solid', borderColor: 'divider', pl: 2, ml: 0 },
      '& img': { maxWidth: '100%' },
    }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></Box>}
    {!literal && <Button size="small" onClick={() => setRaw(value => !value)} sx={{ color: user ? 'inherit' : 'text.secondary', mt: 0.5, fontSize: 11 }}>
      {raw ? 'Markdown 预览' : '查看完整原文'}
    </Button>}
  </Box>;
}

export function MessageError({ error }: { error: unknown }) {
  const info = object(error);
  const data = object(info.data);
  const name = printable(info.name || 'Error');
  const message = data.message ?? info.message ?? error;
  const body = data.responseBody ?? info.responseBody;
  return <Alert severity={/abort/i.test(name) ? 'warning' : 'error'} data-message-error sx={{ width: '100%', '& .MuiAlert-message': { width: '100%', minWidth: 0 } }}>
    <AlertTitle sx={{ overflowWrap: 'anywhere' }}>{name}{typeof data.statusCode === 'number' ? ` · HTTP ${data.statusCode}` : ''}</AlertTitle>
    <RawContent value={message} />
    {body !== undefined && body !== message && <Box sx={{ mt: 1 }}><Typography variant="caption">服务端响应体</Typography><RawContent value={body} /></Box>}
    {typeof data.isRetryable === 'boolean' && <Typography variant="caption">可重试：{data.isRetryable ? '是' : '否'}</Typography>}
    <RawDetails label="完整错误记录 JSON" value={error} />
  </Alert>;
}

const statusLabels: Record<string, string> = { pending: '等待中', running: '执行中', completed: '已完成', error: '失败' };

function ToolPart({ part, expand }: { part: JsonObject; expand: boolean }) {
  const state = object(part.state);
  const input = object(state.input ?? part.input);
  const name = printable(part.tool || part.name || 'unknown');
  const status = printable(state.status || 'unknown');
  const session = childSession(part);
  const hint = state.title ?? part.title ?? input.description ?? input.filePath ?? input.path ?? input.command;
  const [open, setOpen] = useState(expand);
  const output = state.output ?? state.content ?? state.result;
  const interrupted = object(state.metadata).output;
  return <Box component="details" open={open} onToggle={event => setOpen(event.currentTarget.open)} data-tool-part
    sx={{ border: 1, borderColor: status === 'error' ? 'error.light' : 'divider', borderRadius: 1.5, width: '100%', minWidth: 0 }}>
    <Box component="summary" sx={{ p: 1.25, cursor: 'pointer', bgcolor: 'action.hover', overflowWrap: 'anywhere' }}>
      <BuildOutlinedIcon sx={{ fontSize: 16, verticalAlign: 'middle', mr: 1 }} />
      <Box component="span" sx={{ fontWeight: 600 }}>{name}</Box>
      <Box component="span" sx={{ color: status === 'error' ? 'error.main' : 'text.secondary', ml: 1, fontSize: 12 }}>
        {statusLabels[status] || status}{duration(state.time) ? ` · ${duration(state.time)}` : ''}
      </Box>
      {hint !== undefined && <Typography component="span" variant="body2" sx={{ display: 'block', mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{printable(hint)}</Typography>}
      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>展开查看完整输入、输出和元数据</Typography>
    </Box>
    {open && <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {part.callID !== undefined && <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>callID: {printable(part.callID)}</Typography>}
      <Box><Typography variant="caption" fontWeight={600}>输入</Typography><RawContent value={state.input ?? part.input ?? {}} /></Box>
      {output !== undefined && <Box><Typography variant="caption" fontWeight={600}>输出（完整内容，可滚动）</Typography><RawContent value={output} /></Box>}
      {state.error !== undefined && <MessageError error={state.error} />}
      {interrupted !== undefined && interrupted !== output && <Box><Typography variant="caption">中断前的输出</Typography><RawContent value={interrupted} /></Box>}
      {state.attachments !== undefined && <RawDetails label="工具附件" value={state.attachments} />}
      {state.metadata !== undefined && <RawDetails label="工具元数据" value={state.metadata} />}
      {session && <Link href={`/sessions/${encodeURIComponent(session)}`} target="_blank" rel="noopener noreferrer">查看子会话</Link>}
    </Box>}
  </Box>;
}

function FilePart({ part }: { part: JsonObject }) {
  const url = typeof part.url === 'string' ? part.url : '';
  const mime = printable(part.mime || part.mediaType || '文件');
  const name = printable(part.filename || object(part.source).path || mime);
  return <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}><DescriptionOutlinedIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />{name} · {mime}</Typography>
    {/^data:image\/(png|jpeg|webp|gif);base64,/i.test(url) && <Box component="img" src={url} alt={name} loading="lazy" sx={{ display: 'block', maxWidth: '100%', maxHeight: 480, objectFit: 'contain', mt: 1 }} />}
    {/^https?:\/\//i.test(url) && <Link href={url} target="_blank" rel="noopener noreferrer" sx={{ overflowWrap: 'anywhere' }}>打开附件</Link>}
    {url && !url.startsWith('data:') && <Typography variant="caption" sx={{ display: 'block', overflowWrap: 'anywhere', mt: 1 }}>{url}</Typography>}
    <RawDetails label="完整附件信息 / 原始数据" value={part} />
  </Box>;
}

const partNames: Record<string, string> = {
  'step-start': '执行步骤开始', 'step-finish': '执行步骤结束', snapshot: '快照', patch: '文件变更',
  retry: '重试记录', compaction: '上下文压缩', subtask: '子任务', agent: 'Agent 引用',
};

function PartView({ item, user, expandTools }: { item: DisplayPart; user: boolean; expandTools: boolean }) {
  const part = item.data;
  const type = printable(part.type || 'unknown');
  let body: ReactNode;
  if (item.invalid) {
    body = <Alert severity="warning">片段 JSON 无法解析，以下保留原始内容。<RawContent value={item.record.data} /></Alert>;
  } else if (type === 'text') {
    body = <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: user ? 'primary.main' : 'action.hover', color: user ? 'primary.contrastText' : 'text.primary' }}>
      {typeof part.text === 'string' && part.text.length > 0 ? <MarkdownBody text={part.text} user={user} /> : <Typography variant="body2">（空文本片段）</Typography>}
      {(part.synthetic === true || part.ignored === true) && <Typography variant="caption">{part.synthetic === true ? '系统合成片段 ' : ''}{part.ignored === true ? '模型上下文忽略此片段' : ''}</Typography>}
    </Box>;
  } else if (type === 'reasoning') {
    body = <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#fff8ed', border: '1px solid #ffd9a1' }}>
      <Typography variant="body2" fontWeight={600} sx={{ color: '#8a4b08', mb: 1 }}><PsychologyOutlinedIcon sx={{ fontSize: 18, verticalAlign: 'middle', mr: 0.75 }} />
        思考过程{duration(part.time) ? ` · ${duration(part.time)}` : ''}
      </Typography>
      {typeof part.text === 'string' && part.text.length > 0 ? <MarkdownBody text={part.text} /> : <Typography variant="body2" color="text.secondary">此片段未保存思考文本；现有耗时和元数据保留在片段记录中。</Typography>}
    </Box>;
  } else if (type === 'tool') {
    body = <ToolPart key={String(expandTools)} part={part} expand={expandTools} />;
  } else if (type === 'file') {
    body = <FilePart part={part} />;
  } else if (type === 'step-start' || type === 'step-finish') {
    body = <Box sx={{ borderLeft: 2, borderColor: 'divider', pl: 1.5, py: 0.5 }}>
      <Typography variant="caption" color="text.secondary">{partNames[type]}{part.reason ? ` · ${printable(part.reason)}` : ''}</Typography>
      {part.tokens !== undefined && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{tokenSummary(part.tokens)}</Typography>}
    </Box>;
  } else {
    body = <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
      <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>{partNames[type] || '其他片段'} · {type}</Typography>
      <RawContent value={part} />
    </Box>;
  }
  return <Box data-part-id={item.record.id} data-part-type={type} sx={{ minWidth: 0, width: '100%' }}>
    {body}
    <RawDetails label={`片段详情 · ${type} · ${item.record.id}`} value={{ ...part, id: item.record.id, messageID: item.record.message_id, sessionID: item.record.session_id }} />
  </Box>;
}

export function MessageContent({ message, info, expandTools = false }: { message: Message; info: JsonObject; expandTools?: boolean }) {
  const parts = messageParts(message);
  const legacy = info.content;
  return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, width: '100%', minWidth: 0 }}>
    {parts.map(item => <PartView key={item.record.id} item={item} user={info.role === 'user'} expandTools={expandTools} />)}
    {!parts.some(part => part.data.type === 'text') && legacy !== undefined && <MarkdownBody text={printable(legacy)} user={info.role === 'user'} />}
    {info.error !== undefined && info.error !== null && <MessageError error={info.error} />}
    {parts.length === 0 && legacy === undefined && !info.error && <Typography variant="body2" color="text.secondary">此消息没有保存内容片段；可在消息详情中查看状态与元数据。</Typography>}
  </Box>;
}
