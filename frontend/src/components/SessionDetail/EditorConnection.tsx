import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

export function EditorConnection() {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['editor-status'], queryFn: api.editor.status, retry: false, refetchInterval: 30000,
  });
  return <Paper sx={{ p: 3, mt: 2 }}>
    <Typography variant="h6" gutterBottom>消息编辑连接</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      会话列表来自本地数据库，消息修改通过同一份数据对应的 OpenCode API 写入。
    </Typography>
    {data && <Alert severity={data.healthy ? 'success' : 'warning'} sx={{ mb: 2 }}>
      OpenCode {data.version} · {data.url}<br />原文备份：{data.backupDirectory}
    </Alert>}
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}
    <Box component="pre" sx={{ bgcolor: 'grey.100', p: 2, borderRadius: 1, overflow: 'auto' }}>npm run opencode</Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      自定义地址：在 backend/.env 设置 OPENCODE_SERVER_URL，然后重启后端。
      服务启用密码时，同时设置 OPENCODE_SERVER_USERNAME 和 OPENCODE_SERVER_PASSWORD。
    </Typography>
    <Button variant="outlined" onClick={() => void refetch()} disabled={isFetching}
      startIcon={isFetching ? <CircularProgress size={16} /> : undefined}>检查连接</Button>
  </Paper>;
}
