import { Router, Request, Response } from 'express';
import { engine } from '../services/engine';

const router = Router();

// Endpoint to trigger execution of a workflow DAG using public webhooks
router.post('/:workflowId/:nodeId', async (req: Request, res: Response) => {
  try {
    const { workflowId, nodeId } = req.params;
    const payload = req.body || {};

    console.log(`[WEBHOOK] Incoming webhook request for workflow "${workflowId}" at trigger node "${nodeId}"`);
    
    const runId = await engine.triggerWebhookRun(workflowId, nodeId, payload);
    const run = await engine.getRun(runId);

    return res.status(202).json({
      message: 'Workflow webhook trigger accepted. Execution started.',
      runId,
      run
    });
  } catch (error: any) {
    console.error('[WEBHOOK] Failed to process webhook trigger:', error.message);
    return res.status(400).json({
      error: 'Failed to trigger workflow via webhook',
      details: error.message
    });
  }
});

export default router;
