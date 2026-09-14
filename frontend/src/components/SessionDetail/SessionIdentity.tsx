import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar, TextField, Typography } from '@mui/material';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';

export function SessionIdentity({ sessionID }: { sessionID: string }) {
  const [notice, setNotice] = useState('');
  const [manualCopy, setManualCopy] = useState<{ label: string; value: string } | null>(null);

  async function copy(label: string, value: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setNotice(`已复制${label}`);
    } catch {
      setNotice('');
      setManualCopy({ label, value });
    }
  }

  return <>
    <Box data-session-identity sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mt: 1, mb: 1.25 }}>
      <Typography variant="caption" color="text.secondary">OpenCode 会话 ID</Typography>
      <Typography component="code" data-session-id={sessionID} sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 12, bgcolor: 'action.hover', borderRadius: 1, px: 1, py: 0.5, overflowWrap: 'anywhere', userSelect: 'all', minWidth: 0 }}>
        {sessionID}
      </Typography>
      <Button size="small" aria-label="复制会话 ID" startIcon={<ContentCopyOutlinedIcon fontSize="small" />} onClick={() => void copy('会话 ID', sessionID)}>复制 ID</Button>
      <Button size="small" startIcon={<LinkOutlinedIcon fontSize="small" />}
        onClick={() => void copy('会话链接', new URL(`/sessions/${encodeURIComponent(sessionID)}`, window.location.origin).href)}>复制会话链接</Button>
    </Box>
    <Snackbar open={!!notice} autoHideDuration={2500} onClose={() => setNotice('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert data-session-copy-notice={notice} severity="success" onClose={() => setNotice('')}>{notice}</Alert>
    </Snackbar>
    <Dialog open={!!manualCopy} onClose={() => setManualCopy(null)} maxWidth="sm" fullWidth aria-labelledby="manual-copy-title">
      <DialogTitle id="manual-copy-title">手动复制{manualCopy?.label}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>浏览器未允许自动复制。请选中下方内容，按 ⌘ / Ctrl + C 复制。</Typography>
        <TextField autoFocus fullWidth multiline label={manualCopy?.label || '复制内容'} value={manualCopy?.value || ''}
          InputProps={{ readOnly: true }} onFocus={event => event.target.select()} />
      </DialogContent>
      <DialogActions><Button onClick={() => setManualCopy(null)}>关闭</Button></DialogActions>
    </Dialog>
  </>;
}
