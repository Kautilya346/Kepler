import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { workflowSchema, validateDAG } from '../schemas/workflow';
import { engine } from '../services/engine';

const router = Router();

// Create/Submit a new workflow definition
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // 1. Structural validation via Zod
    const parsed = workflowSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid workflow structural schema',
        details: parsed.error.format()
      });
    }

    // 2. DAG structure validation (cycle checks & orphans check)
    const dagResult = validateDAG(parsed.data);
    if (!dagResult.isValid) {
      return res.status(422).json({
        error: 'Invalid workflow DAG definition',
        details: dagResult.error
      });
    }

    // 3. Register workflow template in database
    const newWorkflow = await engine.addWorkflow(
      parsed.data.name,
      parsed.data.description,
      parsed.data
    );

    return res.status(201).json({
      message: 'Workflow registered successfully',
      workflow: newWorkflow
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// List all registered workflow templates
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await engine.listWorkflows();
    return res.json({ workflows: list });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Fetch a single workflow template by ID
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const wf = await engine.getWorkflow(req.params.id);
    if (!wf) {
      return res.status(404).json({ error: `Workflow template with ID "${req.params.id}" not found` });
    }
    return res.json({ workflow: wf });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update/Edit an existing workflow definition
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id;
    const existing = await engine.getWorkflow(id);
    if (!existing) {
      return res.status(404).json({ error: `Workflow template with ID "${id}" not found` });
    }

    // 1. Structural validation via Zod
    const parsed = workflowSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid workflow structural schema',
        details: parsed.error.format()
      });
    }

    // 2. DAG structure validation (cycle checks & orphans check)
    const dagResult = validateDAG(parsed.data);
    if (!dagResult.isValid) {
      return res.status(422).json({
        error: 'Invalid workflow DAG definition',
        details: dagResult.error
      });
    }

    // 3. Update workflow template in database
    const updatedWorkflow = await engine.updateWorkflow(
      id,
      parsed.data.name,
      parsed.data.description,
      parsed.data
    );

    return res.json({
      message: 'Workflow updated successfully',
      workflow: updatedWorkflow
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Delete a workflow definition template
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id;
    const existing = await engine.getWorkflow(id);
    if (!existing) {
      return res.status(404).json({ error: `Workflow template with ID "${id}" not found` });
    }

    await engine.deleteWorkflow(id);

    return res.json({
      message: 'Workflow deleted successfully'
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
