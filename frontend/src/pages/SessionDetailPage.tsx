import { useParams, Link } from 'react-router-dom';
import {
  Box,
  Typography,
  Breadcrumbs,
  Button,
  Paper,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { SessionDetailPanel } from '../components/SessionDetail';
import { Loading, EmptyState } from '../components/common';
import { useSession } from '../hooks';

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  const { data: session, isLoading } = useSession(sessionId || '');

  if (!sessionId) {
    return (
      <Box>
        <Typography color="error">无效的会话ID</Typography>
        <Button component={Link} to="/" startIcon={<ArrowBackIcon />} sx={{ mt: 2 }}>
          返回项目列表
        </Button>
      </Box>
    );
  }

  if (isLoading) {
    return <Loading message="加载会话详情..." />;
  }

  if (!session) {
    return (
      <EmptyState
        title="会话不存在"
        description="无法找到该会话"
        action={{
          label: '返回项目列表',
          onClick: () => window.location.href = '/',
        }}
      />
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Breadcrumbs sx={{ mb: 2 }}>
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
          {session.title}
        </Typography>
      </Breadcrumbs>

      <Paper
        elevation={0}
        sx={{
          flex: 1,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <SessionDetailPanel 
          key={session.id}
          session={session as any}
          onDelete={() => {
            window.location.href = '/';
          }}
        />
      </Paper>
    </Box>
  );
}
