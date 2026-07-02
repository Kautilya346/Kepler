import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { engine } from '../services/engine';
import db from '../services/db';
import { IncomingMessage } from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config';

const router = Router();

// Trigger a new workflow execution
router.post('/:id/run', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const workflowId = req.params.id;
    const workflow = await engine.getWorkflow(workflowId);
    if (!workflow) {
      return res.status(404).json({ error: `Workflow template with ID "${workflowId}" not found` });
    }

    const runId = await engine.triggerRun(workflowId);
    const run = await engine.getRun(runId);

    return res.status(201).json({
      message: 'Workflow execution triggered successfully',
      run
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// List all executions in the database
router.get('/runs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await db.run.findMany({
      include: {
        workflow: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        startedAt: 'desc'
      }
    });
    return res.json({ runs: list });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Fetch historical and current state of a workflow run
router.get('/runs/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = req.params.id;
    const run = await engine.getRun(runId);
    if (!run) {
      return res.status(404).json({ error: `Workflow run with ID "${runId}" not found` });
    }
    return res.json({ run });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Reconstruct run status and node state dynamically from the event sourcing log
router.get('/runs/:id/replay', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = req.params.id;
    const replayed = await engine.reconstructRunState(runId);
    if (!replayed) {
      return res.status(404).json({ error: `Workflow run with ID "${runId}" not found` });
    }
    return res.json({
      message: 'State reconstructed successfully from event sourcing log',
      replayed
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Pause a running workflow execution
router.post('/runs/:id/pause', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = req.params.id;
    let run = await db.run.findUnique({ where: { id: runId } });
    if (!run) {
      return res.status(404).json({ error: `Workflow run with ID "${runId}" not found` });
    }
    if (run.status !== 'running') {
      return res.status(400).json({ error: `Cannot pause a run that is in "${run.status}" status.` });
    }

    run = await db.run.update({
      where: { id: runId },
      data: { status: 'paused' }
    });

    const ev = await db.event.create({
      data: {
        runId,
        type: 'run_paused',
        message: 'Workflow run execution paused by user.'
      }
    });

    const { redisPublisher } = require('../services/engine');
    await redisPublisher.publish(`run:${runId}:events`, JSON.stringify({
      type: 'event',
      event: {
        timestamp: ev.timestamp.toISOString(),
        type: ev.type,
        message: ev.message
      },
      runStatus: 'paused',
      nodesState: run.nodesState
    }));

    return res.json({ message: 'Workflow paused successfully.', run });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Resume a paused workflow execution
router.post('/runs/:id/resume', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = req.params.id;
    let run = await db.run.findUnique({ where: { id: runId } });
    if (!run) {
      return res.status(404).json({ error: `Workflow run with ID "${runId}" not found` });
    }
    if (run.status !== 'paused') {
      return res.status(400).json({ error: `Cannot resume a run that is in "${run.status}" status.` });
    }

    run = await db.run.update({
      where: { id: runId },
      data: { status: 'running' }
    });

    const ev = await db.event.create({
      data: {
        runId,
        type: 'run_resumed',
        message: 'Workflow run execution resumed by user.'
      }
    });

    const { redisPublisher } = require('../services/engine');
    await redisPublisher.publish(`run:${runId}:events`, JSON.stringify({
      type: 'event',
      event: {
        timestamp: ev.timestamp.toISOString(),
        type: ev.type,
        message: ev.message
      },
      runStatus: 'running',
      nodesState: run.nodesState
    }));

    return res.json({ message: 'Workflow resumed successfully.', run });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Cancel an active workflow execution
router.post('/runs/:id/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = req.params.id;
    let run = await db.run.findUnique({ where: { id: runId } });
    if (!run) {
      return res.status(404).json({ error: `Workflow run with ID "${runId}" not found` });
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return res.status(400).json({ error: `Cannot cancel a run that is in terminal status "${run.status}".` });
    }

    run = await db.run.update({
      where: { id: runId },
      data: { 
        status: 'cancelled',
        completedAt: new Date()
      }
    });

    const ev = await db.event.create({
      data: {
        runId,
        type: 'run_cancelled',
        message: 'Workflow run execution cancelled by user.'
      }
    });

    const { redisPublisher } = require('../services/engine');
    await redisPublisher.publish(`run:${runId}:events`, JSON.stringify({
      type: 'event',
      event: {
        timestamp: ev.timestamp.toISOString(),
        type: ev.type,
        message: ev.message
      },
      runStatus: 'cancelled',
      nodesState: run.nodesState
    }));

    return res.json({ message: 'Workflow cancelled successfully.', run });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Handles upgrading standard HTTP connections to WebSockets
 * Checks for path match: /api/runs/:runId/live and validates JWT from query string
 */
export async function handleWsUpgrade(wss: WebSocketServer, req: IncomingMessage, socket: any, head: Buffer) {
  // Use a dummy base URL to parse relative request URL path and query parameters
  const requestUrl = req.url || '';
  const urlObj = new URL(requestUrl, 'http://localhost');
  const pathname = urlObj.pathname;
  
  // Extract runId from path: /api/runs/{runId}/live
  const match = pathname.match(/^\/api\/runs\/([^\/]+)\/live$/);
  if (!match) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const runId = match[1];
  
  // WS clients in browsers typically set JWT token via query string as headers are restricted
  const token = urlObj.searchParams.get('token');
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\nUnauthenticated WS upgrade request');
    socket.destroy();
    return;
  }

  try {
    // Validate JWT
    jwt.verify(token, config.jwtSecret);
  } catch (err) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\nInvalid or expired credentials');
    socket.destroy();
    return;
  }

  // Ensure execution context exists in database
  const run = await engine.getRun(runId);
  if (!run) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\nExecution context not found');
    socket.destroy();
    return;
  }

  // Hand over upgrade connection handling to ws library
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
    
    // Subscribe this WebSocket client to the run execution channel
    engine.subscribe(runId, ws);
    
    ws.on('close', () => {
      engine.unsubscribe(runId, ws);
    });

    ws.on('error', () => {
      engine.unsubscribe(runId, ws);
    });
  });
}

export default router;
