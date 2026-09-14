import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  Paper,
  CircularProgress,
  IconButton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { EditorConnection } from '../components/SessionDetail/EditorConnection';

interface DbConfig {
  path: string;
  exists: boolean;
  connected: boolean;
}

export function SettingsPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<DbConfig | null>(null);
  const [inputPath, setInputPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await api.config.getDatabase();
      setConfig(data);
      setInputPath(data.path);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load configuration' });
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!inputPath.trim()) return;
    
    setTesting(true);
    setMessage(null);
    
    try {
      const result = await api.config.testDatabase(inputPath);
      
      if (result.exists) {
        setMessage({ type: 'success', text: 'Database file found!' });
      } else {
        setMessage({ type: 'error', text: 'Database file not found at this path' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to test path' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!inputPath.trim()) return;
    
    setSaving(true);
    setMessage(null);
    
    try {
      await api.config.updateDatabase(inputPath);
      setMessage({ type: 'success', text: 'Database path updated successfully!' });
      setConfig({ path: inputPath, exists: true, connected: true });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update database path' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => navigate(-1)} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4">
          设置
        </Typography>
      </Box>
      
      <EditorConnection />
      <Paper sx={{ p: 3, mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          数据库配置
        </Typography>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          配置 OpenCode 数据库文件路径。应用会自动检测默认路径，如果检测不正确可以手动修改。
        </Typography>
        
        {config && (
          <Alert 
            severity={config.exists ? 'success' : 'error'} 
            sx={{ mb: 2 }}
          >
            当前路径: {config.path}
            <br />
            状态: {config.exists ? '✅ 数据库文件存在' : '❌ 数据库文件不存在'}
          </Alert>
        )}
        
        <TextField
          fullWidth
          label="数据库路径"
          value={inputPath}
          onChange={(e) => setInputPath(e.target.value)}
          placeholder="例如: C:\Users\{username}\.local\share\opencode\opencode.db"
          sx={{ mb: 2 }}
          helperText="Windows: C:\Users\{username}\.local\share\opencode\opencode.db | Linux/Mac: ~/.local/share/opencode/opencode.db"
        />
        
        {message && (
          <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            onClick={handleTest}
            disabled={testing || saving || !inputPath.trim()}
          >
            {testing ? '测试中...' : '测试路径'}
          </Button>
          
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={testing || saving || !inputPath.trim()}
          >
            {saving ? '保存中...' : '保存'}
          </Button>
        </Box>
      </Paper>
      
      <Paper sx={{ p: 3, mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          默认路径说明
        </Typography>
        
        <Typography variant="body2" component="div">
          <strong>Windows:</strong>
          <br />
          <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>
            %USERPROFILE%\.local\share\opencode\opencode.db
          </code>
          <br /><br />
          <strong>Linux / macOS:</strong>
          <br />
          <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>
            ~/.local/share/opencode/opencode.db
          </code>
        </Typography>
      </Paper>
    </Box>
  );
}
