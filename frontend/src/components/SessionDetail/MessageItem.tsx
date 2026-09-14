import { memo, useCallback, useMemo, useState } from 'react';
import { Avatar, Box, Button, Chip, ListItem, Typography } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';
import EditIcon from '@mui/icons-material/Edit';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import type { DiffFile, Message } from '../../types/session';
import { MessageEditorDialog } from './MessageEditorDialog';
import { MessageContent, RawDetails } from './MessageContent';
import { MessageDiffDrawer } from './MessageDiffDrawer';
import { duration, object, parseRecord, printable, tokenSummary } from './messagePresentation';

export const MessageItem = memo(function MessageItem({ message, index, registerRef, highlighted = false, contextTarget = false, onViewContext, expandTools = false }: {
  message: Message; index: number; registerRef: (messageID: string, el: HTMLElement | null) => void;
  highlighted?: boolean; contextTarget?: boolean; onViewContext?: (messageID: string) => void; expandTools?: boolean;
}) {
  const messageRef = useCallback((element: HTMLElement | null) => registerRef(message.id, element), [message.id, registerRef]);
  const info = useMemo(() => parseRecord(message.data), [message.data]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [diff, setDiff] = useState<DiffFile | null>(null);
  const user = info.role === 'user';
  const model = object(info.model);
  const provider = info.providerID ?? model.providerID;
  const modelID = info.modelID ?? model.modelID;
  const diffs = Array.isArray(object(info.summary).diffs) ? object(info.summary).diffs as DiffFile[] : [];
  return <>
    {editorOpen && <MessageEditorDialog message={message} onClose={() => setEditorOpen(false)} />}
    <ListItem ref={messageRef} data-message-id={message.id} data-context-target={contextTarget || undefined} tabIndex={-1}
      aria-label={`第 ${index + 1} 条${user ? '用户' : 'Agent'}消息`}
      sx={{ alignItems: 'flex-start', px: 2, py: 2, borderLeft: '3px solid', borderColor: contextTarget ? 'primary.main' : 'transparent',
        bgcolor: contextTarget ? 'action.selected' : 'transparent', outlineOffset: -2,
        ...(highlighted && { animation: 'highlight-pulse 1.2s ease-out' }) }}>
      <Box sx={{ display: 'flex', width: '100%', flexDirection: user ? 'row-reverse' : 'row', gap: 1.5, minWidth: 0 }}>
        <Avatar sx={{ width: 34, height: 34, bgcolor: user ? 'primary.main' : 'secondary.main', flexShrink: 0 }}>
          {user ? <PersonIcon fontSize="small" /> : <SmartToyIcon fontSize="small" />}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0, maxWidth: { xs: '100%', lg: '94%' } }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1 }}>
            <Typography variant="caption" fontWeight={600}>#{index + 1} · {user ? '用户' : printable(info.role === 'assistant' ? 'Agent' : info.role || '未知角色')}</Typography>
            {!!info.agent && <Typography variant="caption" color="text.secondary">@{printable(info.agent)}</Typography>}
            {!!(provider || modelID) && <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{[provider, modelID].filter(Boolean).map(printable).join(' / ')}</Typography>}
            <Typography variant="caption" color="text.secondary">{new Date(message.time_created).toLocaleString('zh-CN')}{duration(info.time) ? ` · ${duration(info.time)}` : ''}</Typography>
            {typeof info.finish === 'string' && <Chip label={info.finish} size="small" variant="outlined" />}
            {contextTarget && <Chip label="当前定位" color="primary" size="small" />}
            {onViewContext && <Button size="small" variant="outlined" startIcon={<ForumOutlinedIcon fontSize="small" />}
              aria-label={`查看第 ${index + 1} 条消息的上下文`} onClick={() => onViewContext(message.id)}>查看上下文</Button>}
            <Button size="small" startIcon={<EditIcon fontSize="small" />} disabled={!message.parts?.length} onClick={() => setEditorOpen(true)}
              aria-label={`编辑第 ${index + 1} 条${user ? '用户' : 'Agent'}消息`}>编辑消息</Button>
          </Box>
          <MessageContent message={message} info={info} expandTools={expandTools} />
          {tokenSummary(info.tokens) && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Tokens · {tokenSummary(info.tokens)}</Typography>}
          {typeof info.cost === 'number' && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>费用 · ${info.cost.toLocaleString(undefined, { maximumFractionDigits: 6 })}</Typography>}
          {diffs.length > 0 && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {diffs.map((item, i) => <Chip key={i} size="small" variant="outlined" label={`${item.file} (+${item.additions} / -${item.deletions})`} onClick={() => setDiff(item)} />)}
          </Box>}
          <RawDetails label={`消息详情 / 原始 JSON · ${message.id} · ${message.parts?.length || 0} 个片段`} value={{ ...message, info }} />
        </Box>
      </Box>
    </ListItem>
    <MessageDiffDrawer diffs={diffs} selected={diff} onSelect={setDiff} onClose={() => setDiff(null)} />
  </>;
});
