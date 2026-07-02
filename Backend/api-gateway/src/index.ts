import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';

import { config } from './config';
import { apiRateLimiter } from './middleware/rateLimiter';
import { authMiddleware } from './middleware/auth';
import workflowRoutes from './routes/workflowRoutes';
import runRoutes, { handleWsUpgrade } from './routes/runRoutes';
import webhookRoutes from './routes/webhookRoutes';
import { engine } from './services/engine';

const app = express();
const server = http.createServer(app);

// Initialize WebSocket server (handled via manual upgrade)
const wss = new WebSocketServer({ noServer: true });

// Global Middlewares
app.use(cors());
app.use(express.json());

// Auth token generator endpoint for development / testing
app.post('/api/auth/token', (req, res) => {
  const { username, role } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required to generate a token.' });
  }

  const payload = {
    id: `usr_${Math.random().toString(36).substring(2, 11)}`,
    username,
    role: role || 'developer'
  };

  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });
  return res.json({
    message: 'Token generated successfully.',
    token,
    user: payload
  });
});

// Apply rate limiting and auth middleware on workflow/run management APIs
app.use('/api', apiRateLimiter);
app.use('/api/webhooks', webhookRoutes); // Public webhook handler
app.use('/api/workflows', authMiddleware, runRoutes);
app.use('/api/workflows', authMiddleware, workflowRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  const url = request.url || '';
  // Upgrade if path matches /api/runs/:runId/live
  if (url.includes('/api/runs/')) {
    handleWsUpgrade(wss, request, socket, head);
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
  }
});

// Start the server
server.listen(config.port, async () => {
  console.log(`==================================================`);
  console.log(`🚀 T-Clone API Gateway is running on port ${config.port}`);
  console.log(`   Health check: http://localhost:${config.port}/health`);
  console.log(`==================================================`);

  // Register cron triggers from database to BullMQ repeatable queues
  await engine.registerCronSchedules();
});

export { app, server, wss };
