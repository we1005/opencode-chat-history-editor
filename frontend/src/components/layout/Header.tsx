import { AppBar, Toolbar, Typography, Box, IconButton, Tooltip } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsIcon from '@mui/icons-material/Settings';
import { Link } from 'react-router-dom';

const DRAWER_WIDTH = 260;

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <AppBar
      position="fixed"
      sx={{
        bgcolor: 'background.paper',
        color: 'text.primary',
        borderBottom: 1,
        borderColor: 'divider',
        boxShadow: 'none',
        ml: { md: `${DRAWER_WIDTH}px` },
        width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
      }}
    >
      <Toolbar sx={{ minHeight: 64 }}>
        <IconButton
          edge="start"
          aria-label="打开项目菜单"
          onClick={onMenuClick}
          sx={{ mr: 2, display: { md: 'none' } }}
        >
          <MenuIcon />
        </IconButton>
        <Link
          to="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <FolderIcon sx={{ mr: 1.5, color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600}>
            OpenCode Message Editor
          </Typography>
        </Link>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="设置">
          <IconButton component={Link} to="/settings" sx={{ color: 'text.secondary' }}>
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>
    </AppBar>
  );
}
