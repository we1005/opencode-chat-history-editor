import { Box, Drawer, IconButton, List, ListItemButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { DiffFile } from '../../types/session';

export function MessageDiffDrawer({ diffs, selected, onSelect, onClose }: {
  diffs: DiffFile[]; selected: DiffFile | null; onSelect: (diff: DiffFile) => void; onClose: () => void;
}) {
  return <Drawer anchor="right" open={!!selected} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', md: '70%' }, maxWidth: 1000, overflow: 'hidden' } }}>
    <Box sx={{ display: 'flex', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ flex: 1 }}>代码差异</Typography>
      <IconButton aria-label="关闭代码差异" onClick={onClose}><CloseIcon /></IconButton>
    </Box>
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Box sx={{ width: { xs: 140, md: 240 }, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflow: 'auto' }}>
        <List>{diffs.map((diff, index) => <ListItemButton key={index} selected={selected?.file === diff.file} onClick={() => onSelect(diff)}>
          <Box sx={{ minWidth: 0 }}><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{diff.file}</Typography><Typography variant="caption" color="text.secondary">+{diff.additions} -{diff.deletions}</Typography></Box>
        </ListItemButton>)}</List>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', bgcolor: '#1e1e1e', p: 2 }}>
        <Typography variant="body2" sx={{ color: '#fff', overflowWrap: 'anywhere', mb: 2 }}>{selected?.file}</Typography>
        {(selected?.patch || '').split('\n').map((line, index) => {
          const added = line.startsWith('+') && !line.startsWith('+++');
          const removed = line.startsWith('-') && !line.startsWith('---');
          const hunk = line.startsWith('@@');
          return <Box key={index} sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.6, px: 1,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: added ? '#8fd694' : removed ? '#ff9a9a' : hunk ? '#7cc4ff' : '#d4d4d4',
            bgcolor: added ? '#1e3a1e' : removed ? '#3a1e1e' : hunk ? '#264f78' : 'transparent' }}>{line || ' '}</Box>;
        })}
      </Box>
    </Box>
  </Drawer>;
}
