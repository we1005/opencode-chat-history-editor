import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, List, ListItemButton, ListItemText, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import HistoryIcon from '@mui/icons-material/History';
import { useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../services/api';
import type { EditablePart, Message, PartBackup, PartSnapshot } from '../../types/session';
import { SessionIdentity } from './SessionIdentity';

function label(type: string) {
  return ({ text: '消息正文', reasoning: '思考过程', tool: '工具调用', file: '文件附件' } as Record<string, string>)[type] || type;
}

export function MessageEditorDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const parts = message.parts || [];
  const [partID, setPartID] = useState(parts[0]?.id || '');
  const [snapshot, setSnapshot] = useState<PartSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState('text');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [backups, setBackups] = useState<PartBackup[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const requestID = useRef(0);
  const saveLock = useRef(false);
  const queryClient = useQueryClient();
  const original = snapshot ? JSON.stringify(snapshot.part, null, 2) : '';
  const dirty = !!snapshot && draft !== original;
  const isText = snapshot && ['text', 'reasoning'].includes(snapshot.part.type);
  let parsed: EditablePart | null = null;
  let parseError = '';
  try {
    const value = JSON.parse(draft || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要一个 JSON 对象');
    parsed = value;
  } catch (error) { parseError = error instanceof Error ? error.message : 'JSON 格式不正确'; }
  const identityChanged = !!snapshot && !!parsed && ['id', 'messageID', 'sessionID', 'type'].some(key => parsed![key] !== snapshot.part[key]);
  const invalidText = !!isText && !!parsed && typeof parsed.text !== 'string';
  const validationError = parseError || (identityChanged ? 'id、messageID、sessionID 和 type 需要保持不变。' : invalidText ? 'text 必须是字符串，可以为空。' : '');

  const load = useCallback(async () => {
    if (!partID) return;
    const generation = ++requestID.current;
    setLoading(true); setError(''); setNotice(''); setBackups([]);
    try {
      const current = await api.editor.get(message.session_id, message.id, partID);
      if (generation !== requestID.current) return;
      setSnapshot(current);
      setDraft(JSON.stringify(current.part, null, 2));
      setTab(['text', 'reasoning'].includes(current.part.type) ? 'text' : 'json');
    } catch (error) {
      if (generation === requestID.current) setError(error instanceof Error ? error.message : '加载失败');
    } finally { if (generation === requestID.current) setLoading(false); }
  }, [message.session_id, message.id, partID]);

  useEffect(() => { void load(); return () => { requestID.current++; }; }, [load]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    if (dirty || saving) window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, saving]);

  function canDiscard() { return !dirty || window.confirm('有未保存的修改，确定放弃草稿吗？'); }
  function close() { if (!saving && canDiscard()) onClose(); }
  async function save() {
    if (!snapshot || !parsed || validationError || !dirty || saveLock.current) return;
    saveLock.current = true;
    setSaving(true); setError(''); setNotice('');
    try {
      const current = await api.editor.update(message.session_id, message.id, partID, { part: parsed, revision: snapshot.revision });
      setSnapshot(current); setDraft(JSON.stringify(current.part, null, 2));
      setNotice('已写入 OpenCode。此片段的修改前版本已备份。');
      void queryClient.invalidateQueries({ queryKey: ['messages', message.session_id] });
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败，草稿已保留。'); }
    finally { setSaving(false); saveLock.current = false; }
  }
  async function showHistory() {
    setTab('history'); setHistoryLoading(true); setError('');
    const generation = requestID.current;
    try {
      const history = await api.editor.history(message.session_id, message.id, partID);
      if (generation === requestID.current) setBackups(history);
    } catch (error) { if (generation === requestID.current) setError(error instanceof Error ? error.message : '读取备份失败'); }
    finally { if (generation === requestID.current) setHistoryLoading(false); }
  }

  return (
    <Dialog open onClose={close} maxWidth="lg" fullWidth aria-labelledby="message-editor-title"
      PaperProps={{ sx: { height: { xs: '95dvh', md: '86vh' }, maxHeight: '95dvh' } }}
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save(); }
      }}>
      <DialogTitle id="message-editor-title" sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          编辑历史消息 <Chip label={`${parts.length} 个片段`} size="small" />
          {dirty && <Chip label="未保存" color="warning" size="small" />}
        </Box>
        <SessionIdentity sessionID={message.session_id} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          选择片段 → 编辑内容 → 保存到 OpenCode。每个片段单独保存，后续消息保留。
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: 0 }}>
        <Box sx={{ width: { xs: '100%', md: 230 }, flexShrink: 0, borderRight: { md: 1 }, borderColor: 'divider', overflow: 'auto', maxHeight: { xs: 150, md: 'none' } }}>
          <List dense aria-label="消息片段列表">
            {parts.map((part, index) => {
              let data: Record<string, unknown> = {};
              try { data = JSON.parse(part.data); } catch { /* Raw JSON can be inspected after loading. */ }
              return <ListItemButton key={part.id} selected={part.id === partID} disabled={saving}
                onClick={() => {
                  if (part.id === partID || !canDiscard()) return;
                  setSnapshot(null); setDraft(''); setPartID(part.id);
                }} sx={{ minHeight: 60, alignItems: 'flex-start' }}>
                <ListItemText primary={`${index + 1}. ${label(String(data.type || 'unknown'))}`}
                  secondary={typeof data.text === 'string' ? data.text.slice(0, 65) || '（空文本）' : String(data.tool || part.id)}
                  secondaryTypographyProps={{ noWrap: true }} />
              </ListItemButton>;
            })}
          </List>
          {parts.length === 0 && <Typography sx={{ p: 2 }}>这条消息没有可编辑的片段。</Typography>}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: { xs: 2, md: 3 } }}>
          {loading ? <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress aria-label="加载最新片段" /></Box> : <>
            {error && <Alert severity="error" sx={{ mb: 2, overflowWrap: 'anywhere' }}>{error}</Alert>}
            {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{partID}</Typography>
              <Button size="small" onClick={() => { if (canDiscard()) void load(); }} disabled={saving || !partID}>重新加载</Button>
            </Box>
            {snapshot && <>
              <Tabs value={tab} onChange={(_, value) => { if (value === 'history') void showHistory(); else setTab(value); }}
                aria-label="编辑模式" variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
                {isText && <Tab label="文本编辑" value="text" disabled={!!validationError} />}
                <Tab label="完整 JSON" value="json" />
                {isText && <Tab label="预览" value="preview" disabled={!!validationError} />}
                <Tab label="历史备份" value="history" icon={<HistoryIcon fontSize="small" />} iconPosition="start" />
              </Tabs>
              {tab === 'text' && <TextField fullWidth multiline minRows={14} maxRows={28} autoFocus
                label={label(snapshot.part.type)} value={typeof parsed?.text === 'string' ? parsed.text : ''}
                onChange={event => { setDraft(JSON.stringify({ ...parsed, text: event.target.value }, null, 2)); setNotice(''); }}
                disabled={saving} helperText="保留换行、Markdown 与空白；支持清空内容。⌘ / Ctrl + Enter 保存。"
                inputProps={{ spellCheck: false, 'aria-label': '片段文本内容' }}
                sx={{ '& textarea': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 14, lineHeight: 1.7 } }} />}
              {tab === 'json' && <TextField fullWidth multiline minRows={14} maxRows={28}
                label="完整 Part JSON" value={draft} onChange={event => { setDraft(event.target.value); setNotice(''); }}
                disabled={saving} error={!!validationError} helperText={validationError || '支持编辑工具输入/输出、metadata 等字段；保存时由 OpenCode 校验结构。'}
                inputProps={{ spellCheck: false, 'aria-label': '片段 JSON 内容' }}
                sx={{ '& textarea': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13, lineHeight: 1.6 } }} />}
              {tab === 'preview' && <Box sx={{ overflowWrap: 'anywhere', '& pre': { overflow: 'auto', p: 2, bgcolor: 'grey.100' } }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{typeof parsed?.text === 'string' ? parsed.text : ''}</ReactMarkdown>
                {!parsed?.text && <Typography color="text.secondary">（空文本）</Typography>}
              </Box>}
              {tab === 'history' && <>
                <Alert severity="info" sx={{ mb: 2 }}>每次保存前保留原文。选择备份会载入草稿，点击“保存片段”才会恢复。这里也可能包含保存失败前留下的备份。</Alert>
                {historyLoading ? <CircularProgress size={24} /> : backups.length === 0 ? <Typography color="text.secondary">此片段暂无备份。</Typography> :
                  backups.map(backup => <Box key={backup.id} sx={{ py: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                      <Typography variant="body2">{new Date(backup.createdAt).toLocaleString()}</Typography>
                      <Button size="small" disabled={saving} onClick={() => {
                        if (!canDiscard()) return;
                        setDraft(JSON.stringify(backup.part, null, 2)); setTab(isText ? 'text' : 'json');
                        setNotice('备份已载入草稿，保存后生效。');
                      }}>载入此版本</Button>
                    </Box>
                    <Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'text.secondary' }}>
                      {String(backup.part.text ?? JSON.stringify(backup.part)).slice(0, 250)}
                    </Typography>
                    <Divider />
                  </Box>)}
              </>}
            </>}
          </>}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>保存通过官方 part.update API 完成</Typography>
        <Button onClick={close} disabled={saving}>关闭</Button>
        <Button variant="contained" onClick={() => void save()} disabled={loading || saving || !dirty || !!validationError}
          startIcon={saving ? <CircularProgress size={16} /> : <SaveOutlinedIcon />}>
          {saving ? '保存中…' : '保存片段'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
