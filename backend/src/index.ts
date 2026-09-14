import 'dotenv/config';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';

// 导入路由
import projectsRouter from './routes/projects';
import sessionsRouter from './routes/sessions';
import configRouter from './routes/config';
import editorRouter from './routes/editor';

// 配置
const PORT = process.env.PORT || 9001;

// 创建Express应用
const app: Application = express();

// 创建HTTP服务器
const server = createServer(app);

// 创建WebSocket服务器
const wss = new WebSocketServer({ server });

// WebSocket客户端连接
const wsClients = new Set<WebSocket>();

// 中间件配置
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:9000', 'http://127.0.0.1:9000'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// 请求日志中间件
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// API路由
app.use('/api/projects', projectsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/config', configRouter);
app.use('/api/editor', editorRouter);

// 健康检查端点
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API信息端点
app.get('/api', (req: Request, res: Response) => {
  res.json({
    name: 'OpenCode Sessions API',
    version: '1.0.0',
    endpoints: {
      projects: {
        'GET /api/projects': '获取所有项目',
        'GET /api/projects/:id': '获取单个项目',
        'GET /api/projects/stats/overview': '获取项目统计'
      },
      sessions: {
        'GET /api/sessions/project/:projectId': '获取项目下的会话树',
        'GET /api/sessions/:id': '获取会话详情',
        'GET /api/sessions/:id/messages': '获取会话消息',
        'GET /api/sessions/:id/diff': '获取代码差异',
        'GET /api/sessions/:id/children': '获取子会话',
        'GET /api/sessions/:id/tree': '获取会话树',
        'GET /api/sessions/:id/stats': '获取会话统计',
        'PUT /api/sessions/:id': '更新会话标题',
        'DELETE /api/sessions/:id': '删除会话'
      },
      config: {
        'GET /api/config/database': '获取数据库配置',
        'PUT /api/config/database': '更新数据库路径',
        'POST /api/config/database/test': '测试数据库路径'
      }
    }
  });
});

// Production: serve the built frontend and support client-side deep links.
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'), error => { if (error) next(); });
});

// 404处理
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not found'
  });
});

// 错误处理中间件
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// WebSocket连接处理
wss.on('connection', (ws: WebSocket, req) => {
  console.log(`[WS] Client connected from ${req.socket.remoteAddress}`);
  wsClients.add(ws);

  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to OpenCode Sessions WebSocket',
    timestamp: Date.now()
  }));

  // 处理消息
  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('[WS] Received:', message);
      
      // 广播给所有客户端
      broadcast({
        type: 'message',
        payload: message,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[WS] Error parsing message:', error);
    }
  });

  // 处理断开连接
  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    wsClients.delete(ws);
  });

  // 处理错误
  ws.on('error', (error) => {
    console.error('[WS] Error:', error);
    wsClients.delete(ws);
  });
});

// 广播消息给所有WebSocket客户端
function broadcast(message: any): void {
  const data = JSON.stringify(message);
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// 启动服务器
server.listen(Number(PORT), process.env.HOST || '127.0.0.1', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           OpenCode Sessions Backend Server                 ║
╠════════════════════════════════════════════════════════════╣
║  HTTP Server:  http://localhost:${PORT}                       ║
║  WebSocket:    ws://localhost:${PORT}                         ║
║  Health:       http://localhost:${PORT}/health                ║
║  API Info:     http://localhost:${PORT}/api                   ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down...');
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down...');
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

export { app, server, wss, broadcast };
