import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import agentRoutes from './routes/agent';
import workspaceRoutes from './routes/workspace';
import gitRoutes from './routes/git';
import openrouterRoutes from './routes/openrouter';
import supabaseRoutes from './routes/supabase';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/agent', agentRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/openrouter', openrouterRoutes);
app.use('/api/supabase', supabaseRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// WebSocket for real-time updates
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join:session', (sessionId: string) => {
    socket.join(`session:${sessionId}`);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on('leave:session', (sessionId: string) => {
    socket.leave(`session:${sessionId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Export io for use in routes if needed
export { io };

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = parseInt(process.env.PORT || '3001', 10);

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   AI Software Engineer Agent - Backend  ║
║   Running on http://localhost:${PORT}       ║
╚══════════════════════════════════════════╝
  `);
});

export default app;
