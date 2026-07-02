import { WebSocket } from 'ws';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import db from './db';
import { config } from '../config';

export interface RunEvent {
  id: string;
  timestamp: Date | string;
  type: string;
  nodeId?: string | null;
  message: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: string;
  nodesState: any;
  startedAt: Date;
  completedAt?: Date | null;
  events?: RunEvent[];
}

const redisConfig = {
  host: config.redisHost,
  port: config.redisPort,
};

export const redisPublisher = new Redis(redisConfig);
export const redisSubscriber = new Redis(redisConfig);
export const activityQueue = new Queue('activity-queue', { connection: redisConfig });

export class CoreEngine {
  private wsClients = new Map<string, Set<WebSocket>>();

  constructor() {
    this.initDemoWorkflow();
    this.initRedisSubscription();
  }

  private initRedisSubscription() {
    redisSubscriber.on('message', (channel, message) => {
      const match = channel.match(/^run:([^:]+):events$/);
      if (match) {
        const runId = match[1];
        const clients = this.wsClients.get(runId);
        if (clients) {
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(message);
            }
          }
        }
      }
    });
  }

  private async initDemoWorkflow() {
    try {
      const demoId = 'wf_demo_default';
      const existing = await db.workflow.findUnique({ where: { id: demoId } });
      if (!existing) {
        await db.workflow.create({
          data: {
            id: demoId,
            name: 'E-commerce Order Fulfillment Pipeline',
            description: 'Default demo workflow simulating receipt, payment, inventory, and shipment.',
            definition: {
              nodes: [
                { id: 'start', type: 'trigger', parameters: { name: 'Order Received' } },
                { id: 'auth_payment', type: 'activity', parameters: { action: 'Charge Credit Card' } },
                { id: 'inventory_check', type: 'activity', parameters: { action: 'Verify Stock Levels' } },
                { id: 'ship_goods', type: 'activity', parameters: { action: 'Dispatch Shipping Carrier' } }
              ],
              edges: [
                { source: 'start', target: 'auth_payment' },
                { source: 'auth_payment', target: 'inventory_check' },
                { source: 'inventory_check', target: 'ship_goods' }
              ]
            } as any
          }
        });
        console.log('✅ Seeded default demo workflow in PostgreSQL.');
      }
    } catch (err: any) {
      console.error('Failed to initialize default demo workflow:', err.message);
    }
  }

  /**
   * Scans all workflows in the database and registers repeatable BullMQ jobs for any starting cron trigger nodes.
   */
  async registerCronSchedules() {
    try {
      const workflows = await db.workflow.findMany();
      
      // Clean up previous repeatable jobs to avoid duplicates from server restarts
      const repeatableJobs = await activityQueue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await activityQueue.removeRepeatableByKey(job.key);
      }

      for (const workflow of workflows) {
        const definition = workflow.definition as any;
        const nodes = definition.nodes || [];
        
        // Find if there is a starting cron trigger node
        const cronNode = nodes.find((n: any) => n.type === 'cron');
        const cronExpression = cronNode?.parameters?.cron;

        if (cronExpression) {
          await activityQueue.add(
            `cron_${workflow.id}`,
            {
              workflowId: workflow.id,
              nodeId: cronNode.id,
              isCron: true,
              nodes,
              edges: definition.edges || []
            },
            {
              repeat: {
                pattern: cronExpression
              },
              jobId: `cron_${workflow.id}`
            }
          );
          console.log(`⏰ Scheduled Repeatable Cron "${cronExpression}" for workflow: "${workflow.name}"`);
        }
      }
    } catch (error: any) {
      console.error('Failed to register cron schedules:', error.message);
    }
  }

  // Add a new workflow definition to database and re-sync schedules
  async addWorkflow(name: string, description: string | undefined, definition: any) {
    const id = `wf_${Math.random().toString(36).substring(2, 11)}`;
    const workflow = await db.workflow.create({
      data: {
        id,
        name,
        description,
        definition
      }
    });

    // Re-register cron schedules in case the new workflow has a cron trigger
    await this.registerCronSchedules();
    return workflow;
  }

  // Update an existing workflow definition and re-sync schedules
  async updateWorkflow(id: string, name: string, description: string | undefined, definition: any) {
    const workflow = await db.workflow.update({
      where: { id },
      data: {
        name,
        description,
        definition
      }
    });

    // Re-register cron schedules to update any cron configurations
    await this.registerCronSchedules();
    return workflow;
  }

  // Delete a workflow definition, cascade delete runs/events, and re-sync schedules
  async deleteWorkflow(id: string) {
    const workflow = await db.workflow.delete({
      where: { id }
    });

    // Re-sync cron schedules to remove the deleted workflow's cron trigger
    await this.registerCronSchedules();
    return workflow;
  }

  async getWorkflow(id: string) {
    return await db.workflow.findUnique({
      where: { id }
    });
  }

  async listWorkflows() {
    return await db.workflow.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await db.run.findUnique({
      where: { id: runId },
      include: {
        events: {
          orderBy: { timestamp: 'asc' }
        }
      }
    });
    return run;
  }

  async subscribe(runId: string, ws: WebSocket) {
    if (!this.wsClients.has(runId)) {
      this.wsClients.set(runId, new Set());
      await redisSubscriber.subscribe(`run:${runId}:events`);
    }

    // Safety check: if socket closed during the await block, exit cleanly
    if (ws.readyState === 2 || ws.readyState === 3) { // 2 = CLOSING, 3 = CLOSED
      return;
    }

    let clients = this.wsClients.get(runId);
    if (!clients) {
      clients = new Set<WebSocket>();
      this.wsClients.set(runId, clients);
    }
    clients.add(ws);

    const run = await this.getRun(runId);
    if (run) {
      ws.send(JSON.stringify({ type: 'init', run }));
    }
  }

  async unsubscribe(runId: string, ws: WebSocket) {
    const clients = this.wsClients.get(runId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        this.wsClients.delete(runId);
        await redisSubscriber.unsubscribe(`run:${runId}:events`);
      }
    }
  }

  // Trigger manually (normal execution)
  async triggerRun(workflowId: string): Promise<string> {
    const workflow = await db.workflow.findUnique({
      where: { id: workflowId }
    });
    if (!workflow) {
      throw new Error(`Workflow with ID ${workflowId} not found`);
    }

    const runId = `run_${Math.random().toString(36).substring(2, 11)}`;
    const nodesState: Record<string, 'pending' | 'running' | 'completed' | 'failed'> = {};
    
    const definition = workflow.definition as any;
    const nodes = definition.nodes || [];
    const edges = definition.edges || [];

    for (const node of nodes) {
      nodesState[node.id] = 'pending';
    }

    await db.run.create({
      data: {
        id: runId,
        workflowId,
        status: 'running',
        nodesState: nodesState as any,
        startedAt: new Date()
      }
    });

    const startEvent = await db.event.create({
      data: {
        runId,
        type: 'run_started',
        message: `Workflow run ${runId} started execution manually.`
      }
    });

    await redisPublisher.publish(`run:${runId}:events`, JSON.stringify({
      type: 'event',
      event: {
        timestamp: startEvent.timestamp.toISOString(),
        type: startEvent.type,
        message: startEvent.message
      },
      runStatus: 'running',
      nodesState
    }));

    // Find and queue root nodes
    const rootNodes = nodes.filter((node: any) => !edges.some((edge: any) => edge.target === node.id));

    for (const rootNode of rootNodes) {
      await activityQueue.add(
        `job_${runId}_${rootNode.id}`,
        {
          runId,
          nodeId: rootNode.id,
          workflowId,
          nodes,
          edges
        }
      );
    }

    return runId;
  }

  // Trigger from incoming Webhook payload
  async triggerWebhookRun(workflowId: string, triggerNodeId: string, payload: any): Promise<string> {
    const workflow = await db.workflow.findUnique({
      where: { id: workflowId }
    });
    if (!workflow) {
      throw new Error(`Workflow with ID ${workflowId} not found`);
    }

    const definition = workflow.definition as any;
    const nodes = definition.nodes || [];
    const edges = definition.edges || [];

    // Verify webhook node exists
    const webhookNode = nodes.find((n: any) => n.id === triggerNodeId);
    if (!webhookNode) {
      throw new Error(`Node "${triggerNodeId}" not found in workflow "${workflowId}". Double-check the node ID in your request.`);
    }
    if (webhookNode.type !== 'webhook') {
      throw new Error(`Node "${triggerNodeId}" in workflow "${workflowId}" is of type "${webhookNode.type}", but must be "webhook" to be triggered externally. Change the node type to "Webhook Catch" in the designer.`);
    }

    const runId = `run_${Math.random().toString(36).substring(2, 11)}`;
    const nodesState: Record<string, 'pending' | 'running' | 'completed' | 'failed'> = {};

    for (const node of nodes) {
      nodesState[node.id] = 'pending';
    }

    // Set Webhook node as completed immediately since the payload triggered it!
    nodesState[triggerNodeId] = 'completed';

    await db.run.create({
      data: {
        id: runId,
        workflowId,
        status: 'running',
        nodesState: nodesState as any,
        startedAt: new Date()
      }
    });

    const startEvent = await db.event.create({
      data: {
        runId,
        type: 'run_started',
        message: `Workflow run ${runId} started via webhook trigger "${triggerNodeId}".`
      }
    });

    const webhookEvent = await db.event.create({
      data: {
        runId,
        type: 'webhook_triggered',
        nodeId: triggerNodeId,
        message: `Webhook trigger "${triggerNodeId}" completed with payload: ${JSON.stringify(payload)}`
      }
    });

    // Notify of startup status
    await redisPublisher.publish(`run:${runId}:events`, JSON.stringify({
      type: 'event',
      event: {
        timestamp: startEvent.timestamp.toISOString(),
        type: startEvent.type,
        message: startEvent.message
      },
      runStatus: 'running',
      nodesState
    }));

    // Queue all child nodes of this webhook node
    const children = nodes.filter((n: any) =>
      edges.some((edge: any) => edge.source === triggerNodeId && edge.target === n.id)
    );

    for (const child of children) {
      await activityQueue.add(
        `job_${runId}_${child.id}`,
        {
          runId,
          nodeId: child.id,
          workflowId,
          nodes,
          edges,
          input: payload // Feed the incoming webhook POST payload downstream
        }
      );
    }

    return runId;
  }

  /**
   * Replays chronological event logs from PostgreSQL to reconstruct the deterministic run state.
   * Demonstrates the Event Sourcing core value.
   */
  async reconstructRunState(runId: string): Promise<{ status: string; nodesState: Record<string, string> } | null> {
    const run = await db.run.findUnique({
      where: { id: runId },
      include: { workflow: true }
    });
    if (!run) return null;

    const events = await db.event.findMany({
      where: { runId },
      orderBy: { timestamp: 'asc' }
    });

    const definition = run.workflow.definition as any;
    const nodes = definition.nodes || [];
    
    // Initial State mapping
    const nodesState: Record<string, string> = {};
    for (const node of nodes) {
      nodesState[node.id] = 'pending';
    }
    let status = 'pending';

    // Replay chronological mutations
    for (const event of events) {
      switch (event.type) {
        case 'run_started':
          status = 'running';
          break;
        case 'webhook_triggered':
          if (event.nodeId) nodesState[event.nodeId] = 'completed';
          break;
        case 'node_started':
          if (event.nodeId) nodesState[event.nodeId] = 'running';
          break;
        case 'node_completed':
          if (event.nodeId) nodesState[event.nodeId] = 'completed';
          break;
        case 'node_failed':
          if (event.nodeId) nodesState[event.nodeId] = 'failed';
          break;
        case 'run_completed':
          status = 'completed';
          break;
        case 'run_failed':
          status = 'failed';
          break;
      }
    }

    return { status, nodesState };
  }
}

export const engine = new CoreEngine();
