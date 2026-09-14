import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, GlobalStyles, IconButton, List, ListItemButton, ListItemText, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ListAltIcon from '@mui/icons-material/ListAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionMessages, useSessionStats } from '../../hooks';
import { Loading } from '../common';
import { api } from '../../services/api';
import type { SessionTreeNode } from '../../types';
import { MessageItem } from './MessageItem';
import { SessionIdentity } from './SessionIdentity';
import { messageParts, parseRecord, printable } from './messagePresentation';

export { MessageItem } from './MessageItem';

interface SessionDetailPanelProps {
  session: SessionTreeNode;
  onDelete?: (session: SessionTreeNode) => void;
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}天前`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}小时前`;
  return minutes ? `${minutes}分钟前` : '刚刚';
}

export function SessionDetailPanel({ session, onDelete }: SessionDetailPanelProps) {
  const { data: messages, isLoading, error, refetch, isFetching } = useSessionMessages(session.id, { refetchInterval: 10000 });
  const { data: stats, refetch: refetchStats } = useSessionStats(session.id, { refetchInterval: 10000 });
  const queryClient = useQueryClient();
  const [messageSearch, setMessageSearch] = useState('');
  const [contextMessageID, setContextMessageID] = useState<string | null>(null);
  const [pendingJump, setPendingJump] = useState<{ messageID: string } | null>(null);
  const [navigationError, setNavigationError] = useState('');
  const [expandTools, setExpandTools] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [highlightedMessageID, setHighlightedMessageID] = useState<string | null>(null);
  const messageRefs = useRef(new Map<string, HTMLElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>();
  const [renameOpen, setRenameOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const hasChildren = (stats?.childCount ?? 0) > 0;

  const registerRef = useCallback((messageID: string, element: HTMLElement | null) => {
    if (element) messageRefs.current.set(messageID, element);
    else messageRefs.current.delete(messageID);
  }, []);

  const userMessages = useMemo(() => (messages || []).map((message, index) => {
    const info = parseRecord(message.data);
    const text = messageParts(message).filter(part => part.data.type === 'text').map(part => printable(part.data.text)).join('\n') || printable(info.content);
    return { message, index, role: info.role, preview: text.length > 100 ? `${text.slice(0, 100)}…` : text };
  }).filter(item => item.role === 'user'), [messages]);

  const query = messageSearch.trim();
  const indexedMessages = useMemo(() => (messages || []).map((message, index) => ({ message, index })), [messages]);
  const matches = useMemo(() => indexedMessages.filter(({ message }) =>
    !query || (message.data + (message.parts || []).map(part => part.data).join('\n')).toLowerCase().includes(query.toLowerCase())), [indexedMessages, query]);
  const viewingContext = !!query && !!contextMessageID;
  const filtering = !!query && !viewingContext;
  const visible = filtering ? matches : indexedMessages;
  const contextIndex = indexedMessages.findIndex(item => item.message.id === contextMessageID);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  useLayoutEffect(() => {
    if (filtering && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [query, filtering]);

  // Restore/render the full list first. Looking up the stable message ID after
  // commit avoids scrolling against stale refs from the filtered results.
  useLayoutEffect(() => {
    if (!pendingJump || isLoading) return;
    const target = messageRefs.current.get(pendingJump.messageID);
    const scroller = scrollRef.current;
    if (!target || !scroller) {
      setNavigationError('无法定位该消息，记录可能已变化。请刷新或重新搜索。');
      setPendingJump(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const bounds = target.getBoundingClientRect();
      const padding = bounds.height < scroller.clientHeight - 160 ? 120 : 24;
      const top = scroller.scrollTop + bounds.top - scroller.getBoundingClientRect().top - padding;
      // Long jumps should not animate through hundreds of messages (and trigger
      // intermediate lazy-loaded attachments that shift the target mid-scroll).
      const nearby = Math.abs(top - scroller.scrollTop) < scroller.clientHeight * 2;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      scroller.scrollTo({ top: Math.max(0, top), behavior: nearby && !reducedMotion ? 'smooth' : 'auto' });
      target.focus({ preventScroll: true });
      clearTimeout(highlightTimer.current);
      setHighlightedMessageID(pendingJump.messageID);
      highlightTimer.current = setTimeout(() => setHighlightedMessageID(null), 2200);
      setPendingJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingJump, visible, isLoading]);

  const viewContext = useCallback((messageID: string) => {
    setNavigationError('');
    setContextMessageID(messageID);
    setPendingJump({ messageID });
  }, []);

  function returnToResults() {
    setNavigationError('');
    setContextMessageID(null);
    if (contextMessageID && matches.some(item => item.message.id === contextMessageID)) {
      setPendingJump({ messageID: contextMessageID });
    }
  }

  function jump(messageID: string) {
    setMessageSearch(''); setContextMessageID(null); setNavOpen(false);
    setNavigationError(''); setPendingJump({ messageID });
  }

  async function rename() {
    if (!title.trim() || busy) return;
    setBusy(true); setActionError('');
    try {
      await api.sessions.update(session.id, title.trim());
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] });
      setRenameOpen(false);
    } catch (error) { setActionError(error instanceof Error ? error.message : '重命名失败'); }
    finally { setBusy(false); }
  }

  async function collectChildren(id: string): Promise<string[]> {
    const children = await api.sessions.getChildren(id);
    return [id, ...(await Promise.all(children.map(child => collectChildren(child.id)))).flat()];
  }

  async function remove(withChildren: boolean) {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      if (withChildren) await api.sessions.batchDelete(await collectChildren(session.id));
      else await api.sessions.delete(session.id);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setDeleteOpen(false); onDelete?.(session);
    } catch (error) { setActionError(error instanceof Error ? error.message : '删除失败'); }
    finally { setBusy(false); }
  }

  return <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
    <GlobalStyles styles={{ '@keyframes highlight-pulse': { '0%': { backgroundColor: 'rgba(25,118,210,.25)' }, '100%': { backgroundColor: 'transparent' } },
      '@media (prefers-reduced-motion: reduce)': { '*': { scrollBehavior: 'auto !important', animationDuration: '0s !important' } } }} />
    <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1, overflowWrap: 'anywhere' }}>{session.title}</Typography>
        <SessionIdentity key={session.id} sessionID={session.id} />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">更新: {relativeTime(session.time_updated)}</Typography>
          <Typography variant="caption" color="text.secondary">消息: {messages?.length ?? stats?.messageCount ?? session.message_count ?? '—'}</Typography>
          <Typography variant="caption" color="text.secondary">片段: {stats?.partCount ?? '—'}</Typography>
          {!!session.subagent_type && <Chip label={`@${session.subagent_type}`} size="small" color="secondary" />}
          {(session.summary_additions ?? 0) > 0 && <Chip label={`+${session.summary_additions}`} size="small" color="success" />}
          {(session.summary_deletions ?? 0) > 0 && <Chip label={`-${session.summary_deletions}`} size="small" color="error" />}
          {(session.summary_files ?? 0) > 0 && <Chip label={`${session.summary_files} 文件`} size="small" variant="outlined" />}
        </Box>
      </Box>
      <Tooltip title="刷新"><IconButton aria-label="刷新会话" disabled={isFetching} onClick={() => { void refetch(); void refetchStats(); }}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
      <IconButton aria-label="重命名会话" onClick={() => { setTitle(session.title); setActionError(''); setRenameOpen(true); }}><EditIcon fontSize="small" /></IconButton>
      <IconButton aria-label="删除会话" onClick={() => { setActionError(''); setDeleteOpen(true); }}><DeleteIcon fontSize="small" /></IconButton>
    </Box>
    <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
      <TextField fullWidth size="small" label="搜索正文、思考、工具、错误和元数据" value={messageSearch} onChange={event => {
        setMessageSearch(event.target.value); setContextMessageID(null); setPendingJump(null);
        setHighlightedMessageID(null); setNavigationError('');
      }} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 1, mt: 1 }}>
        <Typography variant="caption" color="text.secondary">按原始片段顺序展示。工具可展开完整输入/输出，每条消息可查看原始 JSON。</Typography>
        <FormControlLabel sx={{ mr: 0 }} control={<Switch size="small" checked={expandTools} onChange={event => setExpandTools(event.target.checked)} />} label={<Typography variant="caption">展开全部工具输出</Typography>} />
      </Box>
      {filtering && <Typography variant="caption" color="text.secondary">匹配 {matches.length} / {messages?.length || 0} 条消息 · 点击结果中的“查看上下文”可定位到完整消息流</Typography>}
      {viewingContext && <Box data-search-context sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1, p: 1, bgcolor: 'action.selected', borderRadius: 1 }}>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 180, overflowWrap: 'anywhere' }}>
          {contextIndex >= 0 ? `正在查看第 ${contextIndex + 1} 条消息的上下文` : '定位的消息已不存在'} · 完整消息流 {indexedMessages.length} 条
        </Typography>
        <Button size="small" startIcon={<MyLocationIcon />} disabled={contextIndex < 0} onClick={() => contextMessageID && viewContext(contextMessageID)}>回到定位消息</Button>
        <Button size="small" variant="outlined" startIcon={<ArrowBackIcon />} onClick={returnToResults}>返回搜索结果（{matches.length}）</Button>
      </Box>}
      {navigationError && <Alert severity="warning" sx={{ mt: 1 }} onClose={() => setNavigationError('')}>{navigationError}</Alert>}
    </Box>
    <Box ref={scrollRef} data-message-scroll sx={{ flex: 1, overflow: 'auto', overflowX: 'hidden', minHeight: 0 }}>
      {isLoading ? <Loading message="加载消息..." /> : error ? <Alert severity="error" sx={{ m: 2 }}>{error.message}</Alert> : visible.length ?
        <List disablePadding>{visible.map(({ message, index }) => <MessageItem key={message.id} message={message} index={index} registerRef={registerRef}
          highlighted={highlightedMessageID === message.id} contextTarget={viewingContext && contextMessageID === message.id}
          onViewContext={filtering ? viewContext : undefined} expandTools={expandTools} />)}</List> :
        <Typography color="text.secondary" sx={{ p: 2 }}>{messageSearch ? '没有匹配的消息' : '暂无消息'}</Typography>}
    </Box>
    {userMessages.length > 1 && <Box sx={{ position: 'absolute', right: 16, bottom: 16, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 3, zIndex: 10 }}>
      <Tooltip title="用户消息列表"><IconButton aria-label="用户消息列表" onClick={() => setNavOpen(true)}><ListAltIcon /></IconButton></Tooltip>
    </Box>}
    <Dialog open={navOpen} onClose={() => setNavOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>用户消息列表 · {userMessages.length} 条</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}><List dense>{userMessages.map(item => <ListItemButton key={item.message.id} onClick={() => jump(item.message.id)}>
        <ListItemText primary={item.preview || '（无正文，可能包含附件）'} secondary={`#${item.index + 1} · ${new Date(item.message.time_created).toLocaleString('zh-CN')}`} primaryTypographyProps={{ sx: { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } }} />
      </ListItemButton>)}</List></DialogContent>
      <DialogActions><Button onClick={() => setNavOpen(false)}>关闭</Button></DialogActions>
    </Dialog>
    <Dialog open={renameOpen} onClose={() => { if (!busy) setRenameOpen(false); }} maxWidth="sm" fullWidth>
      <DialogTitle>重命名会话</DialogTitle>
      <DialogContent>{actionError && <Alert severity="error" sx={{ mb: 1 }}>{actionError}</Alert>}
        <TextField autoFocus fullWidth label="会话标题" value={title} onChange={event => setTitle(event.target.value)} sx={{ mt: 1 }} onKeyDown={event => { if (event.key === 'Enter') void rename(); }} />
      </DialogContent>
      <DialogActions><Button onClick={() => setRenameOpen(false)} disabled={busy}>取消</Button><Button variant="contained" disabled={busy || !title.trim() || title === session.title} onClick={() => void rename()}>{busy ? '保存中…' : '保存'}</Button></DialogActions>
    </Dialog>
    <Dialog open={deleteOpen} onClose={() => { if (!busy) setDeleteOpen(false); }} maxWidth="sm" fullWidth>
      <DialogTitle>删除会话</DialogTitle>
      <DialogContent>
        {actionError && <Alert severity="error" sx={{ mb: 1 }}>{actionError}</Alert>}
        <Alert severity="warning" sx={{ mb: 2 }}>{hasChildren ? `此会话包含 ${stats?.childCount} 个子会话` : '此操作不可撤销'}</Alert>
        <Typography sx={{ mb: 2 }}>确定删除“{session.title}”吗？</Typography>
        {hasChildren && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
          <Button color="error" variant="outlined" disabled={busy} onClick={() => void remove(true)}>同时删除所有子会话</Button>
          <Button variant="outlined" disabled={busy} onClick={() => void remove(false)}>仅删除此会话，保留子会话</Button>
        </Box>}
        {busy && <CircularProgress size={20} />}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDeleteOpen(false)}>取消</Button>{!hasChildren && <Button color="error" variant="contained" disabled={busy} onClick={() => void remove(false)}>删除</Button>}</DialogActions>
    </Dialog>
  </Box>;
}
