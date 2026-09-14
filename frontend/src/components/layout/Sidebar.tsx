import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Typography,
  Divider,
  CircularProgress,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import StorageIcon from '@mui/icons-material/Storage';
import { Link, useLocation } from 'react-router-dom';
import { useProjects } from '../../hooks/useProjects';

const DRAWER_WIDTH = 260;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const { data: projects, isLoading } = useProjects();

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorageIcon sx={{ color: 'primary.main' }} />
        <Typography variant="h6" fontWeight={600}>
          OpenCode
        </Typography>
      </Box>
      <Divider />
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <Typography variant="overline" sx={{ px: 2, py: 1, display: 'block' }} color="text.secondary">
          项目列表
        </Typography>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : projects && projects.length > 0 ? (
          <List dense sx={{ pt: 0 }}>
            {projects.map((project) => {
              const projectName = project.name || project.worktree?.split(/[/\\]/).pop() || project.id.slice(0, 8);
              const isSelected = location.pathname === `/projects/${project.id}/sessions`;
              return (
                <ListItem key={project.id} disablePadding>
                  <ListItemButton
                    component={Link}
                    to={`/projects/${project.id}/sessions`}
                    selected={isSelected}
                    onClick={onClose}
                    sx={{
                      '&.Mui-selected': {
                        bgcolor: 'primary.main',
                        color: 'white',
                        '&:hover': { bgcolor: 'primary.dark' },
                        '& .MuiListItemIcon-root': { color: 'white' },
                        '& .MuiListItemText-primary': { fontWeight: 600 },
                        '& .MuiListItemText-secondary': { color: 'rgba(255,255,255,0.8)' },
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <FolderIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={projectName}
                      secondary={`${project.session_count || 0} 会话`}
                      primaryTypographyProps={{ noWrap: true }}
                      secondaryTypographyProps={{ noWrap: true, variant: 'caption' }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
            暂无项目
          </Typography>
        )}
      </Box>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          消息编辑器 · 基于 OC Sessions
        </Typography>
      </Box>
    </Box>
  );

  return (
    <>
      <Drawer
        variant="temporary"
        open={open}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
        }}
      >
        {drawerContent}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            borderRight: 1,
            borderColor: 'divider',
          },
        }}
        open
      >
        {drawerContent}
      </Drawer>
    </>
  );
}
