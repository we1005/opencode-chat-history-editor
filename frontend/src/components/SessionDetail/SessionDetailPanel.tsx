import { Box, Typography, Chip, Drawer, IconButton, List, ListItem, Avatar, Button, Dialog, DialogTitle, DialogContent, DialogActions, Alert, CircularProgress, TextField, Tooltip, ListItemText, GlobalStyles, Link } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import DescriptionIcon from '@mui/icons-material/Description';
import RefreshIcon from '@mui/icons-material/Refresh';
import BuildIcon from '@mui/icons-material/Build';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState, useMemo, useRef, useCallback, memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionMessages, useSessionStats } from '../../hooks';
import { Loading } from '../common';
import { api } from '../../services/api';
import type { SessionTreeNode, Message, DiffFile } from '../../types';

// 简化消息内容，隐藏大段粘贴和文件内容
function simplifyContent(text: string): { display: string; pastes: { marker: string; content: string }[]; files: { path: string; type: string; content: string }[] } {
  if (!text || typeof text !== 'string') {
    return { display: '', pastes: [], files: [] };
  }
  
  const pastes: { marker: string; content: string }[] = [];
  const files: { path: string; type: string; content: string }[] = [];
  
  let display = text;
  
  try {
    // 匹配粘贴内容 [Pasted ~N lines] 后面跟着的内容
    // 边界：下一个 [Pasted 标记 或 结束
    display = display.replace(/\[Pasted ~(\d+) lines?\]\s*\n?([\s\S]*?)(?=\[Pasted|$)/g, (match, lines, content) => {
      const trimmedContent = content.trim();
      if (trimmedContent) {
        const marker = `[Pasted ~${lines} lines]`;
        pastes.push({ marker, content: trimmedContent });
        return marker;
      }
      return match;
    });
    
    // 匹配大段代码块（超过50行）
    display = display.replace(/```(\w*)\n([\s\S]{500,}?)```/g, (match, lang, content) => {
      const lineCount = content.split('\n').length;
      if (lineCount > 50) {
        const marker = `[Code block ~${lineCount} lines]`;
        pastes.push({ marker, content: content.trim() });
        return `\`\`\`${lang}\n... ${lineCount} lines ...\n\`\`\``;
      }
      return match;
    });
    
    // 匹配文件读取内容 - 先匹配带 path/type 的完整格式
    display = display.replace(/<path>(.*?)<\/path>\s*<type>(.*?)<\/type>\s*<content>([\s\S]*?)<\/content>/g, (match, path, type, content) => {
      files.push({ path: path.trim(), type: type.trim(), content: content.trim() });
      return `<path>${path}</path>\n<type>${type}</type>\n<content>...${content.split('\n').length} lines...</content>`;
    });
    
    // 匹配单独的 <content>...</content>（没有前面的path/type）
    display = display.replace(/<content>([\s\S]{200,}?)<\/content>/g, (match, content) => {
      files.push({ path: 'content', type: 'content', content: content.trim() });
      return `<content>...${content.split('\n').length} lines...</content>`;
    });
  } catch (e) {
    console.error('simplifyContent error:', e);
    return { display: text, pastes: [], files: [] };
  }
  
  return { display, pastes, files };
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
}

interface SessionDetailPanelProps {
  session: SessionTreeNode;
  onDelete?: (session: SessionTreeNode) => void;
}

export function SessionDetailPanel({ session, onDelete }: SessionDetailPanelProps) {
  const { data: messages, isLoading, refetch: refetchMessages, isFetching } = useSessionMessages(session.id, { refetchInterval: 10000 });
  const { data: stats, refetch: refetchStats } = useSessionStats(session.id, { refetchInterval: 10000 });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [navDialogOpen, setNavDialogOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  
  const hasChildren = (stats?.childCount ?? 0) > 0;

  // 获取所有用户消息（提取真实文本内容）
  const userMessages = useMemo(() => {
    if (!messages) return [];
    return messages
      .map((msg, index) => {
        let content: any = {};
        try {
          content = JSON.parse(msg.data);
        } catch {
          content = { role: 'unknown' };
        }
        
        // 提取用户消息的文本内容
        let textContent = content.content || '';
        if (msg.parts && msg.parts.length > 0) {
          const textParts = msg.parts
            .map(p => {
              try {
                const parsed = JSON.parse(p.data);
                return parsed.text || '';
              } catch {
                return p.data || '';
              }
            })
            .filter(t => t);
          if (textParts.length > 0) {
            textContent = textParts.join('\n');
          }
        }
        
        // 预计算预览文本
        const preview = textContent.length > 100 ? textContent.slice(0, 100) + '...' : textContent;
        
        return { msg, index, content, textContent, preview };
      })
      .filter(item => item.content.role === 'user');
  }, [messages]);

  // 消息元素缓存
  const messageRefs = useRef<Map<number, HTMLElement>>(new Map());
  
  // 注册消息元素
  const registerMessageRef = useCallback((index: number, el: HTMLElement | null) => {
    if (el) {
      messageRefs.current.set(index, el);
    } else {
      messageRefs.current.delete(index);
    }
  }, []);

  // 跳转到指定消息
  const scrollToMessage = useCallback((index: number) => {
    const element = messageRefs.current.get(index);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedIndex(index);
      setTimeout(() => setHighlightedIndex(null), 1200);
    }
  }, []);

  // 从弹窗跳转
  const handleNavSelect = (index: number) => {
    scrollToMessage(index);
    setNavDialogOpen(false);
  };

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
  };

  const handleEditClick = () => {
    setEditTitle(session.title);
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editTitle.trim() || editTitle === session.title) {
      setEditDialogOpen(false);
      return;
    }
    setIsSaving(true);
    try {
      await api.sessions.update(session.id, editTitle.trim());
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setEditDialogOpen(false);
    } catch (error) {
      console.error('更新标题失败:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const getAllSessionIdsRecursive = async (sessionId: string): Promise<string[]> => {
    const ids: string[] = [sessionId];
    try {
      const children = await api.sessions.getChildren(sessionId);
      for (const child of children) {
        const childIds = await getAllSessionIdsRecursive(child.id);
        ids.push(...childIds);
      }
    } catch (error) {
      console.error('获取子会话失败:', error);
    }
    return ids;
  };

  const handleDeleteConfirm = async (withChildren: boolean) => {
    setIsDeleting(true);
    try {
      if (withChildren && hasChildren) {
        const allIds = await getAllSessionIdsRecursive(session.id);
        await api.sessions.batchDelete(allIds);
      } else {
        await api.sessions.delete(session.id);
      }
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onDelete?.(session);
    } catch (error) {
      console.error('删除失败:', error);
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <GlobalStyles
        styles={{
          '@keyframes highlight-pulse': {
            '0%': { backgroundColor: 'rgba(25, 118, 210, 0.3)' },
            '30%': { backgroundColor: 'rgba(25, 118, 210, 0.25)' },
            '100%': { backgroundColor: 'transparent' },
          },
        }}
      />
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', overflowX: 'hidden', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
            {session.title}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              更新: {formatRelativeTime(session.time_updated)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              消息: {session.message_count}
            </Typography>
            {session.subagent_type && (
              <Chip label={`@${session.subagent_type}`} size="small" color="secondary" />
            )}
          </Box>
          {(session.summary_additions || session.summary_deletions) && (
            <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
              {session.summary_additions && (
                <Chip label={`+${session.summary_additions}`} size="small" color="success" />
              )}
              {session.summary_deletions && (
                <Chip label={`-${session.summary_deletions}`} size="small" color="error" />
              )}
              {session.summary_files && (
                <Chip label={`${session.summary_files} 文件`} size="small" variant="outlined" />
              )}
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="刷新">
            <IconButton 
              onClick={() => { refetchMessages(); refetchStats(); }}
              disabled={isFetching}
              sx={{ 
                color: 'text.secondary',
                '&:hover': { color: 'primary.main', bgcolor: 'primary.lighter' }
              }}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton 
            onClick={handleEditClick}
            sx={{ 
              color: 'text.secondary',
              '&:hover': { color: 'primary.main', bgcolor: 'primary.lighter' }
            }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton 
            onClick={handleDeleteClick}
            sx={{ 
              color: 'text.secondary',
              '&:hover': { color: 'error.main', bgcolor: 'error.lighter' }
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', overflowX: 'hidden', position: 'relative' }} ref={messagesContainerRef}>
        {isLoading ? (
          <Loading message="加载消息..." />
        ) : messages && messages.length > 0 ? (
          <List disablePadding>
            {messages.map((msg, idx) => (
              <MessageItem key={msg.id} message={msg} index={idx} registerRef={registerMessageRef} highlightedIndex={highlightedIndex} />
            ))}
          </List>
        ) : (
          <Typography color="text.secondary" sx={{ p: 2 }}>暂无消息</Typography>
        )}
      </Box>
      
      {userMessages.length > 1 && (
        <Box sx={{
          position: 'absolute',
          right: 16,
          bottom: 80,
          bgcolor: 'background.paper',
          borderRadius: 2,
          boxShadow: 3,
          p: 0.5,
          zIndex: 10,
        }}>
          <Tooltip title="消息列表" placement="left">
            <IconButton size="small" onClick={() => setNavDialogOpen(true)}>
              <ListAltIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>删除会话</DialogTitle>
        <DialogContent>
          {hasChildren ? (
            <>
              <Alert severity="warning" sx={{ mb: 2 }}>
                此会话包含 {stats?.childCount} 个子会话
              </Alert>
              <Typography sx={{ mb: 2 }}>
                请选择删除方式：
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Button 
                  variant="outlined" 
                  color="error"
                  onClick={() => handleDeleteConfirm(true)}
                  disabled={isDeleting}
                  startIcon={isDeleting ? <CircularProgress size={16} /> : null}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  同时删除所有子会话
                </Button>
                <Box>
                  <Button 
                    variant="outlined"
                    onClick={() => handleDeleteConfirm(false)}
                    disabled={isDeleting}
                    sx={{ mb: 1 }}
                  >
                    仅删除此会话
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 1 }}>
                    子会话将保留，在会话列表中显示"主会话已删除"标记
                  </Typography>
                </Box>
              </Box>
            </>
          ) : (
            <>
              <Alert severity="warning" sx={{ mb: 2 }}>
                此操作不可撤销
              </Alert>
              <Typography>
                确定要删除会话 "<strong>{session.title}</strong>" 吗？
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>取消</Button>
          {!hasChildren && (
            <Button 
              onClick={() => handleDeleteConfirm(false)} 
              variant="contained" 
              color="error"
              disabled={isDeleting}
              startIcon={isDeleting ? <CircularProgress size={16} /> : null}
            >
              {isDeleting ? '删除中...' : '删除'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>重命名会话</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="输入新标题"
            sx={{ mt: 1 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleEditSave();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)} disabled={isSaving}>取消</Button>
          <Button 
            onClick={handleEditSave} 
            variant="contained"
            disabled={isSaving || !editTitle.trim() || editTitle === session.title}
            startIcon={isSaving ? <CircularProgress size={16} /> : null}
          >
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={navDialogOpen} onClose={() => setNavDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            用户消息列表
            <Typography variant="caption" color="text.secondary">
              共 {userMessages.length} 条
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <List dense>
            {userMessages.map((item, idx) => (
              <ListItem
                key={item.msg.id}
                button
                onClick={() => handleNavSelect(item.index)}
                sx={{
                  '&:hover': { bgcolor: 'action.hover' },
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <ListItemText
                  primary={item.preview || '(空消息)'}
                  secondary={`#${idx + 1} · ${formatDate(item.msg.time_created)}`}
                  primaryTypographyProps={{
                    sx: { 
                      fontSize: '0.85rem',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.4,
                    }
                  }}
                  secondaryTypographyProps={{
                    sx: { fontSize: '0.7rem', mt: 0.5 }
                  }}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNavDialogOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const MessageItem = memo(function MessageItem({ message, index, registerRef, highlightedIndex }: { message: Message; index: number; registerRef: (index: number, el: HTMLElement | null) => void; highlightedIndex: number | null }) {
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);
  const [selectedDiff, setSelectedDiff] = useState<DiffFile | null>(null);
  
  // 解析内容 - 用 useMemo 缓存
  const content = useMemo(() => {
    try {
      return JSON.parse(message.data);
    } catch {
      return { role: 'unknown' };
    }
  }, [message.data]);

  const isUser = content.role === 'user';
  const isAssistant = content.role === 'assistant';
  const isHighlighted = index === highlightedIndex;

  const diffs: DiffFile[] = content.summary?.diffs || [];
  
  // 缓存 parts 解析
  const { reasoningContent, rawTextContent, toolCalls } = useMemo(() => {
    const partContent = message.parts?.map(p => {
      try {
        return JSON.parse(p.data);
      } catch {
        return { text: p.data };
      }
    }) || [];
    
    const reasoningParts = partContent.filter(p => p.type === 'reasoning');
    const textParts = partContent.filter(p => p.type === 'text');
    const toolParts = partContent.filter(p => p.type === 'tool');
    
    return {
      reasoningContent: reasoningParts.map(p => p.text || '').join('\n'),
      rawTextContent: textParts.map(p => p.text || '').join('\n') || content.content || '',
      toolCalls: toolParts,
    };
  }, [message.parts, content.content]);

  // 简化内容，隐藏大段粘贴和文件内容
  const { display: textContent, pastes, files } = useMemo(() => {
    return simplifyContent(rawTextContent || '');
  }, [rawTextContent]);

  const isShortText = textContent && textContent.length < 20;
  const isShortReasoning = reasoningContent && reasoningContent.length < 100 && !reasoningContent.includes('\n');
  
  const hasNoResponse = isAssistant && !reasoningContent && !textContent;

  const bubbleSx = {
    position: 'relative' as const,
    display: 'inline-block',
    maxWidth: isShortText ? 'none' : '85%',
    p: 1.5,
    borderRadius: 2,
    bgcolor: isUser ? '#1976d2' : (isAssistant ? '#f5f5f5' : '#e8e8e8'),
    color: isUser ? '#fff' : 'text.primary',
    boxShadow: 1,
    overflow: 'hidden',
    '& pre': {
      bgcolor: '#1e1e1e',
      color: '#d4d4d4',
      p: 1.5,
      borderRadius: 1,
      overflow: 'auto',
      fontSize: '0.8rem',
      maxWidth: '100%',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    },
    '& code': {
      bgcolor: isUser ? 'rgba(255,255,255,0.2)' : 'grey.200',
      px: 0.5,
      py: 0.25,
      borderRadius: 0.5,
      fontSize: '0.85rem',
      fontFamily: '"Cascadia Code", "Consolas", monospace',
      wordBreak: 'break-word',
    },
    '& pre code': {
      bgcolor: 'transparent',
      p: 0,
      wordBreak: 'break-word',
    },
    '& a': {
      color: isUser ? '#ffeb3b' : '#1976d2',
      textDecoration: 'underline',
      '&:hover': {
        color: isUser ? '#ff80ab' : '#1565c0',
      },
    },
    '& h1, & h2, & h3': {
      mt: 1.5,
      mb: 1,
      fontWeight: 600,
      wordBreak: 'break-word',
    },
    '& h1': { fontSize: '1.25rem' },
    '& h2': { fontSize: '1.1rem' },
    '& h3': { fontSize: '1rem' },
    '& ul, & ol': {
      pl: 2.5,
      mb: 1,
      wordBreak: 'break-word',
    },
    '& li': {
      mb: 0.5,
    },
    '& blockquote': {
      borderLeft: 3,
      borderColor: isUser ? 'rgba(255,255,255,0.5)' : 'primary.main',
      pl: 2,
      ml: 0,
      color: isUser ? 'rgba(255,255,255,0.8)' : 'text.secondary',
      fontStyle: 'italic',
      wordBreak: 'break-word',
    },
    '& table': {
      borderCollapse: 'collapse',
      width: '100%',
      mb: 1,
      display: 'block',
      overflowX: 'auto',
      maxWidth: '100%',
    },
    '& th, & td': {
      border: 1,
      borderColor: isUser ? 'rgba(255,255,255,0.3)' : 'grey.300',
      p: 1,
      textAlign: 'left',
    },
    '& th': {
      bgcolor: isUser ? 'rgba(255,255,255,0.2)' : 'grey.100',
      fontWeight: 600,
    },
  };

  const arrowSx = {
    position: 'absolute' as const,
    top: 12,
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderWidth: isUser ? '8px 0 8px 10px' : '8px 10px 8px 0',
    borderColor: isUser 
      ? 'transparent transparent transparent #1976d2'
      : 'transparent #f5f5f5 transparent transparent',
    [isUser ? 'right' : 'left']: -10,
  };

  return (
    <>
      <ListItem 
        ref={(el) => registerRef(index, el)}
        sx={{ 
          alignItems: 'flex-start',
          py: 1.5,
          px: 2,
          ...(isHighlighted && {
            animation: 'highlight-pulse 1.2s ease-out',
          }),
        }}
      >
        <Box sx={{ display: 'flex', width: '100%', flexDirection: isUser ? 'row-reverse' : 'row', gap: 1.5 }}>
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: isUser ? '#1976d2' : '#9c27b0',
              flexShrink: 0,
              mt: 0.5,
            }}
          >
            {isUser ? <PersonIcon sx={{ fontSize: 20 }} /> : <SmartToyIcon sx={{ fontSize: 20 }} />}
          </Avatar>
          
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexDirection: isUser ? 'row-reverse' : 'row' }}>
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                {isUser ? '用户' : (isAssistant ? 'AI' : content.role)}
              </Typography>
              {content.agent && (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                  @{content.agent}
                </Typography>
              )}
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem' }}>
                {formatDate(message.time_created)}
              </Typography>
            </Box>
            
            {hasNoResponse ? (
              <Box sx={{ 
                p: 1.5, 
                borderRadius: 2, 
                bgcolor: '#f5f5f5',
                color: '#9e9e9e',
                fontSize: '0.85rem',
                fontStyle: 'italic',
                boxShadow: 1,
              }}>
                ⚠️ 模型无响应或被用户终止
              </Box>
            ) : (
              <Box sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 1, 
                alignItems: isUser ? 'flex-end' : 'flex-start',
              }}>
                {reasoningContent && (
                  <Box sx={{ 
                    display: 'inline-block',
                    p: 1.5, 
                    borderRadius: 2, 
                    bgcolor: '#fff3e0', 
                    border: '1px solid #ffcc80',
                    maxWidth: isShortReasoning ? 'none' : '85%',
                    '& pre': { 
                      overflow: 'auto', 
                      whiteSpace: 'pre-wrap',
                      maxWidth: '100%',
                    },
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, color: '#e65100' }}>
                      <Typography variant="caption" fontWeight={600} sx={{ fontSize: '0.75rem' }}>
                        💭 思考过程
                      </Typography>
                    </Box>
                    <Box sx={{ 
                      color: '#5d4037',
                      fontSize: '0.85rem',
                      fontStyle: 'italic',
                    }}>
                      {isShortReasoning ? reasoningContent : (
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: 'span',
                            div: 'span',
                          }}
                          unwrapDisallowed={true}
                        >
                          {reasoningContent}
                        </ReactMarkdown>
                      )}
                    </Box>
                  </Box>
                )}
                    {toolCalls && toolCalls.length > 0 && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxWidth: '85%' }}>
                    {toolCalls.map((tool: any, idx: number) => {
                      const toolName = tool.tool || tool.name || 'unknown';
                      const status = tool.state?.status || 'unknown';
                      const title = tool.title || '';
                      const subagentType = tool.state?.input?.subagent_type || tool.input?.subagent_type || tool.subagentType || '';
                      const isTask = toolName === 'task' || toolName === 'subagent' || !!subagentType;
                      const description = tool.state?.input?.description || tool.input?.description || tool.description || '';
                      
                      let sessionId: string | null = null;
                      if (isTask) {
                        const tryExtractId = (obj: any): string | null => {
                          if (!obj || typeof obj !== 'object') {
                            if (typeof obj === 'string') {
                              const m = obj.match(/<task\s+id="([a-zA-Z0-9_]+)"/);
                              return m ? m[1] : null;
                            }
                            return null;
                          }
                          return obj.sessionId || obj.session_id || obj.id || obj.task_id || null;
                        };
                        sessionId = tryExtractId(tool);
                        if (!sessionId) sessionId = tryExtractId(tool.state);
                        if (!sessionId) sessionId = tryExtractId(tool.state?.metadata);
                        if (!sessionId && tool.state?.output) {
                          const m = tool.state.output.match(/<task\s+id="([a-zA-Z0-9_]+)"/);
                          sessionId = m ? m[1] : null;
                        }
                        if (!sessionId && tool.state?.result) sessionId = tryExtractId(
                          (() => { try { return typeof tool.state.result === 'string' ? JSON.parse(tool.state.result) : tool.state.result; } catch { return null; } })()
                        );
                      }
                      
                      const StatusIcon = status === 'completed' ? CheckCircleIcon : status === 'error' ? ErrorIcon : HourglassEmptyIcon;
                      const statusColor = status === 'completed' ? '#4caf50' : status === 'error' ? '#f44336' : '#ff9800';
                      
                      return (
                        <Box 
                          key={idx}
                          sx={{ 
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            p: 1,
                            borderRadius: 1,
                            bgcolor: '#f8f9fa',
                            border: '1px solid #e0e0e0',
                            fontSize: '0.8rem',
                          }}
                        >
                          <BuildIcon sx={{ fontSize: 16, color: '#666' }} />
                          <StatusIcon sx={{ fontSize: 16, color: statusColor }} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            {isTask ? (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography sx={{ fontWeight: 500, color: '#333' }}>
                                  @{subagentType || 'task'}
                                </Typography>
                                {description && (
                                  <Typography sx={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {description}
                                  </Typography>
                                )}
                              </Box>
                            ) : (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography sx={{ fontWeight: 500, color: '#333' }}>
                                  {toolName}
                                </Typography>
                                {title && (
                                  <Typography sx={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {title}
                                  </Typography>
                                )}
                              </Box>
                            )}
                          </Box>
                          {isTask && sessionId && (
                             <Link 
                               href={`/sessions/${sessionId}`}
                               target="_blank"
                               rel="noopener noreferrer"
                               sx={{ 
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                fontSize: '0.75rem',
                                color: '#1976d2',
                                textDecoration: 'none',
                                '&:hover': { textDecoration: 'underline' },
                              }}
                            >
                              <OpenInNewIcon sx={{ fontSize: 14 }} />
                              查看子会话
                            </Link>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                )}
                {textContent && (
                  <Box sx={bubbleSx}>
                    <Box sx={arrowSx} />
                    {textContent.length < 200 && !textContent.includes('\n') && !textContent.includes('`') && !textContent.includes('[') && !textContent.includes('<') ? (
                      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{textContent}</span>
                    ) : (
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: 'span',
                          div: 'span',
                        }}
                        unwrapDisallowed={true}
                      >
                        {textContent}
                      </ReactMarkdown>
                    )}
                    {(pastes.length > 0 || files.length > 0) && (
                      <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {pastes.map((paste, idx) => {
                          const previewContent = paste.content.length > 2000 
                            ? paste.content.slice(0, 2000) + '...' 
                            : paste.content;
                          return (
                            <Tooltip 
                              key={`paste-${idx}`}
                              title={
                                <Box sx={{ p: 1, maxHeight: 300, overflow: 'auto', maxWidth: 500, bgcolor: '#333', borderRadius: 1 }}>
                                  <Box sx={{ fontSize: '0.7rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: '#fff' }}>
                                    {previewContent}
                                  </Box>
                                </Box>
                              }
                              placement="top"
                              arrow
                            >
                              <Chip 
                                icon={<ContentPasteIcon sx={{ fontSize: 16, color: isUser ? '#1976d2' : undefined }} />}
                                label={paste.marker} 
                                size="small" 
                                sx={{ 
                                  fontSize: '0.7rem', 
                                  cursor: 'help',
                                  bgcolor: isUser ? 'rgba(255,255,255,0.9)' : undefined,
                                  color: isUser ? '#1976d2' : undefined,
                                  '& .MuiChip-label': { color: isUser ? '#1976d2' : undefined }
                                }}
                              />
                            </Tooltip>
                          );
                        })}
                        {files.map((file, idx) => {
                          const previewContent = file.content.length > 2000 
                            ? file.content.slice(0, 2000) + '...' 
                            : file.content;
                          return (
                            <Tooltip 
                              key={`file-${idx}`}
                              title={
                                <Box sx={{ p: 1, maxHeight: 300, overflow: 'auto', maxWidth: 500, bgcolor: '#333', borderRadius: 1 }}>
                                  <Box sx={{ fontSize: '0.7rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: '#fff' }}>
                                    {previewContent}
                                  </Box>
                                </Box>
                              }
                              placement="top"
                              arrow
                            >
                              <Chip 
                                icon={<DescriptionIcon sx={{ fontSize: 16, color: isUser ? '#1976d2' : undefined }} />}
                                label={file.path.split('/').pop() || 'file'} 
                                size="small" 
                                sx={{ 
                                  fontSize: '0.7rem', 
                                  cursor: 'help',
                                  bgcolor: isUser ? 'rgba(255,255,255,0.9)' : undefined,
                                  color: isUser ? '#1976d2' : undefined,
                                  '& .MuiChip-label': { color: isUser ? '#1976d2' : undefined }
                                }}
                              />
                            </Tooltip>
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            )}

            {diffs.length > 0 && (
              <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                {diffs.slice(0, 5).map((diff: DiffFile, idx: number) => (
                  <Chip
                    key={idx}
                    label={`${diff.file.split('/').pop()}`}
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setSelectedDiff(diff);
                      setDiffDrawerOpen(true);
                    }}
                    sx={{ cursor: 'pointer', fontSize: '0.7rem' }}
                    icon={<span style={{ color: diff.additions > 0 ? '#4caf50' : '#f44336' }}>●</span>}
                  />
                ))}
                {diffs.length > 5 && (
                  <Chip
                    label={`+${diffs.length - 5} 更多`}
                    size="small"
                    variant="outlined"
                    onClick={() => setDiffDrawerOpen(true)}
                    sx={{ cursor: 'pointer', fontSize: '0.7rem' }}
                  />
                )}
              </Box>
            )}

            {content.tokens && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, fontSize: '0.7rem' }}>
                Tokens: {content.tokens.total?.toLocaleString()} (输入: {content.tokens.input?.toLocaleString()}, 输出: {content.tokens.output?.toLocaleString()})
              </Typography>
            )}
          </Box>
        </Box>
      </ListItem>

      <DiffDrawer
        open={diffDrawerOpen}
        onClose={() => setDiffDrawerOpen(false)}
        diffs={diffs}
        selectedDiff={selectedDiff}
        onSelect={setSelectedDiff}
      />
    </>
  );
});

interface DiffDrawerProps {
  open: boolean;
  onClose: () => void;
  diffs: DiffFile[];
  selectedDiff: DiffFile | null;
  onSelect: (diff: DiffFile | null) => void;
}

function DiffDrawer({ open, onClose, diffs, selectedDiff, onSelect }: DiffDrawerProps) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: '70%', maxWidth: 800, overflow: 'hidden' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ flex: 1 }}>代码差异</Typography>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>
      
      <Box sx={{ display: 'flex', height: 'calc(100% - 56px)', overflow: 'hidden' }}>
        <Box sx={{ width: 250, borderRight: 1, borderColor: 'divider', overflow: 'auto' }}>
          <List dense>
            {diffs.map((diff, idx) => (
              <ListItem
                key={idx}
                onClick={() => onSelect(diff)}
                sx={{
                  cursor: 'pointer',
                  bgcolor: selectedDiff?.file === diff.file ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.85rem', fontFamily: '"Cascadia Code", "Consolas", monospace', wordBreak: 'break-all' }}>
                    {diff.file.split('/').pop()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    +{diff.additions} -{diff.deletions}
                  </Typography>
                </Box>
              </ListItem>
            ))}
          </List>
        </Box>
        
        <Box sx={{ flex: 1, overflow: 'auto', bgcolor: '#1e1e1e' }}>
          {selectedDiff ? (
            <DiffViewer diff={selectedDiff} />
          ) : (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              选择文件查看差异
            </Typography>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}

function DiffViewer({ diff }: { diff: DiffFile }) {
  const patch = diff.patch || '';
  const lines = patch.split('\n');

  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Typography sx={{ color: '#fff', fontFamily: '"Cascadia Code", "Consolas", monospace', fontSize: '0.85rem', mb: 2, wordBreak: 'break-all', flexShrink: 0 }}>
        {diff.file}
      </Typography>
      <Box sx={{ fontFamily: '"Cascadia Code", "Consolas", monospace', fontSize: '0.75rem', lineHeight: 1.5, overflow: 'auto', flex: 1 }}>
        {lines.map((line, idx) => {
          let bgColor = 'transparent';
          let textColor = '#d4d4d4';
          
          if (line.startsWith('+') && !line.startsWith('+++')) {
            bgColor = '#1e3a1e';
            textColor = '#4caf50';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            bgColor = '#3a1e1e';
            textColor = '#f44336';
          } else if (line.startsWith('@@')) {
            bgColor = '#264f78';
            textColor = '#569cd6';
          }
          
          return (
            <Box
              key={idx}
              sx={{
                bgcolor: bgColor,
                color: textColor,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                px: 1,
                py: 0.25,
              }}
            >
              {line || ' '}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
