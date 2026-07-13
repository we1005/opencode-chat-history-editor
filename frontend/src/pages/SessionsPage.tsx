import { useParams, Link } from 'react-router-dom';
import {
  Box,
  Typography,
  Breadcrumbs,
  Paper,
  Divider,
  useTheme,
  useMediaQuery,
  Button,
  Snackbar,
  Alert,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SessionList } from '../components/SessionList';
import { SessionDetailPanel } from '../components/SessionDetail';
import { BatchActions } from '../components/SessionList/BatchActions';
import { RenameDialog } from '../components/SessionList/RenameDialog';
import { DeleteConfirmDialog } from '../components/SessionList/DeleteConfirmDialog';
import { useSelectionStore } from '../stores/selectionStore';
import { useSessions } from '../hooks';
import { api } from '../services/api';
import type { SessionTreeNode } from '../types';

export function SessionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedSession, setSelectedSession] = useState<SessionTreeNode | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const queryClient = useQueryClient();
  
  const { 
    selectedIds, 
    isSelecting, 
    toggle, 
    selectAll, 
    clear, 
    startSelecting, 
    stopSelecting 
  } = useSelectionStore();
  
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; session: SessionTreeNode | null }>({ 
    open: false, 
    session: null 
  });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; sessions: SessionTreeNode[] }>({ 
    open: false, 
    sessions: [] 
  });
  const [isLoading, setIsLoading] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ 
    open: false, 
    message: '', 
    severity: 'success' 
  });
  
  const { data: sessions = [] } = useSessions(projectId ?? '');

  if (!projectId) {
    return (
      <Box>
        <Typography color="error">无效的项目ID</Typography>
        <Breadcrumbs sx={{ mt: 2 }}>
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Typography variant="body2">返回项目列表</Typography>
          </Link>
        </Breadcrumbs>
      </Box>
    );
  }

  const getAllSessionIds = (sessionList: SessionTreeNode[]): string[] => {
    const ids: string[] = [];
    const traverse = (s: SessionTreeNode) => {
      ids.push(s.id);
      if (s.children) s.children.forEach(traverse);
    };
    sessionList.forEach(traverse);
    return ids;
  };

  const handleRename = (session: SessionTreeNode) => {
    setRenameDialog({ open: true, session });
  };

  const handleRenameConfirm = async (newTitle: string) => {
    if (!renameDialog.session) return;
    
    setIsLoading(true);
    try {
      await api.sessions.update(renameDialog.session.id, newTitle);
      setSnackbar({ open: true, message: '重命名成功', severity: 'success' });
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      if (selectedSession?.id === renameDialog.session.id) {
        setSelectedSession({ ...selectedSession, title: newTitle });
      }
    } catch (error) {
      setSnackbar({ open: true, message: '重命名失败：数据库只读', severity: 'error' });
    } finally {
      setIsLoading(false);
      setRenameDialog({ open: false, session: null });
    }
  };

  const handleDelete = (session: SessionTreeNode) => {
    setDeleteDialog({ open: true, sessions: [session] });
  };

  const handleBatchDelete = () => {
    const selectedSessions = flattenSessions(sessions).filter(s => selectedIds.has(s.id));
    setDeleteDialog({ open: true, sessions: selectedSessions });
  };

  const handleDeleteConfirm = async () => {
    setIsLoading(true);
    try {
      if (deleteDialog.sessions.length === 1) {
        await api.sessions.delete(deleteDialog.sessions[0].id);
      } else {
        await api.sessions.batchDelete(deleteDialog.sessions.map(s => s.id));
      }
      setSnackbar({ open: true, message: `成功删除 ${deleteDialog.sessions.length} 个会话`, severity: 'success' });
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      clear();
      stopSelecting();
      if (selectedSession && deleteDialog.sessions.some(s => s.id === selectedSession.id)) {
        setSelectedSession(null);
      }
    } catch (error) {
      setSnackbar({ open: true, message: '删除失败：数据库只读', severity: 'error' });
    } finally {
      setIsLoading(false);
      setDeleteDialog({ open: false, sessions: [] });
    }
  };

  const flattenSessions = (sessionList: SessionTreeNode[]): SessionTreeNode[] => {
    const result: SessionTreeNode[] = [];
    const traverse = (s: SessionTreeNode) => {
      result.push(s);
      if (s.children) s.children.forEach(traverse);
    };
    sessionList.forEach(traverse);
    return result;
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexShrink: 0 }}>
        <Breadcrumbs>
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Typography
              component="span"
              variant="body2"
              sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
            >
              项目列表
            </Typography>
          </Link>
          <Typography variant="body2" color="text.primary">
            会话
          </Typography>
        </Breadcrumbs>
        
        {!isSelecting && (
          <Button
            size="small"
            startIcon={<EditIcon />}
            onClick={startSelecting}
            variant="outlined"
          >
            管理
          </Button>
        )}
      </Box>

      <Paper
        elevation={0}
        sx={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Box
          sx={{
            width: isMobile ? '100%' : 320,
            minWidth: isMobile ? '100%' : 320,
            borderRight: isMobile ? 0 : 1,
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'grey.50',
          }}
        >
          {isSelecting && (
            <BatchActions
              selectedCount={selectedIds.size}
              totalCount={getAllSessionIds(sessions).length}
              onSelectAll={() => selectAll(getAllSessionIds(sessions))}
              onClear={stopSelecting}
              onDelete={handleBatchDelete}
            />
          )}
          <SessionList
            projectId={projectId}
            selectedId={selectedSession?.id}
            onSelect={setSelectedSession}
            isSelecting={isSelecting}
            selectedIds={selectedIds}
            onToggleSelect={toggle}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </Box>

        {!isMobile && (
          <>
            <Divider orientation="vertical" flexItem />
            <Box sx={{ flex: 1, overflow: 'hidden' }}>
              {selectedSession ? (
                <SessionDetailPanel 
                  session={selectedSession} 
                  onDelete={(s) => {
                    setSelectedSession(null);
                    queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
                  }}
                />
              ) : (
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'text.secondary',
                  }}
                >
                  <Typography>选择一个会话查看详情</Typography>
                </Box>
              )}
            </Box>
          </>
        )}
      </Paper>

      <RenameDialog
        open={renameDialog.open}
        title={renameDialog.session?.title || ''}
        onClose={() => setRenameDialog({ open: false, session: null })}
        onConfirm={handleRenameConfirm}
        isLoading={isLoading}
      />

      <DeleteConfirmDialog
        open={deleteDialog.open}
        count={deleteDialog.sessions.length}
        onClose={() => setDeleteDialog({ open: false, sessions: [] })}
        onConfirm={handleDeleteConfirm}
        isLoading={isLoading}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
