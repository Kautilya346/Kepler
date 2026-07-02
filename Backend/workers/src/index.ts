import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import db from './db';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

const redisPublisher = new Redis(redisConfig);

// Setup a Queue instance to allow enqueuing downstream dependent tasks
const activityQueue = new Queue('activity-queue', { connection: redisConfig });

console.log('==================================================');
console.log('👷 T-Clone Activity Worker process is starting...');
console.log(`📡 Connecting to Redis at ${redisConfig.host}:${redisConfig.port}`);
console.log('==================================================');

async function resolveAndQueueDownstream(
  runId: string,
  workflowId: string,
  nodes: any[],
  edges: any[],
  nodesState: Record<string, string>,
  activityQueue: Queue
) {
  const run = await db.run.findUnique({ where: { id: runId } });
  if (!run || run.status === 'cancelled' || run.status === 'failed' || run.status === 'completed') {
    console.log(`[WORKER] Run ${runId} status is "${run?.status}". Halting downstream scheduling.`);
    return;
  }

  const pastEvents = await db.event.findMany({
    where: { 
      runId,
      type: { in: ['node_completed', 'webhook_triggered'] }
    }
  });
  const outputs: Record<string, string> = {};
  for (const ev of pastEvents) {
    if (ev.nodeId) {
      if (ev.type === 'node_completed') {
        const match = ev.message.match(/Result: (.*)$/s);
        if (match) {
          outputs[ev.nodeId] = match[1];
        }
      } else if (ev.type === 'webhook_triggered') {
        const match = ev.message.match(/completed with payload: (.*)$/s);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            outputs[ev.nodeId] = typeof parsed === 'string' ? parsed : match[1];
          } catch {
            outputs[ev.nodeId] = match[1];
          }
        }
      }
    }
  }

  let stateChanged = true;
  const nodesToQueue = new Set<string>();

  while (stateChanged) {
    stateChanged = false;

    for (const node of nodes) {
      const currentState = nodesState[node.id];
      if (currentState === 'completed' || currentState === 'failed' || currentState === 'skipped') {
        continue;
      }

      if (currentState === 'running' || nodesToQueue.has(node.id)) {
        continue;
      }

      const parentEdges = edges.filter((e: any) => e.target === node.id);
      if (parentEdges.length === 0) {
        continue;
      }

      const allParentsTerminal = parentEdges.every((edge: any) => {
        const pState = nodesState[edge.source];
        return pState === 'completed' || pState === 'failed' || pState === 'skipped';
      });

      if (!allParentsTerminal) {
        continue;
      }

      let hasCompletedPath = false;
      let hasFailedParent = false;
      const paths = parentEdges.map((edge: any) => {
        const pState = nodesState[edge.source];
        if (pState === 'failed') {
          hasFailedParent = true;
          return 'failed';
        }
        if (pState === 'skipped') {
          return 'skipped';
        }
        
        const parentNode = nodes.find((n: any) => n.id === edge.source);
        if (parentNode && parentNode.type === 'condition') {
          const parentOutput = outputs[edge.source];
          if (edge.condition && edge.condition !== parentOutput) {
            return 'skipped';
          }
        }
        hasCompletedPath = true;
        return 'completed';
      });

      if (hasFailedParent) {
        nodesState[node.id] = 'failed';
        stateChanged = true;
        
        await db.run.update({
          where: { id: runId },
          data: { nodesState }
        });
        await db.event.create({
          data: {
            runId,
            type: 'node_failed',
            nodeId: node.id,
            message: `Dependency failure: parent node execution failed.`
          }
        });
        continue;
      }

      const allPathsSkipped = paths.every((p: string) => p === 'skipped');
      if (allPathsSkipped) {
        nodesState[node.id] = 'skipped';
        stateChanged = true;

        await db.run.update({
          where: { id: runId },
          data: { nodesState }
        });

        const skipEvent = await db.event.create({
          data: {
            runId,
            type: 'node_skipped',
            nodeId: node.id,
            message: `Node "${node.id}" skipped due to condition branching.`
          }
        });

        await redisPublisher.publish(
          `run:${runId}:events`,
          JSON.stringify({
            type: 'event',
            event: {
              timestamp: skipEvent.timestamp.toISOString(),
              type: skipEvent.type,
              nodeId: skipEvent.nodeId,
              message: skipEvent.message
            },
            runStatus: 'running',
            nodesState
          })
        );
        continue;
      }

      nodesToQueue.add(node.id);
    }
  }

  for (const nodeId of nodesToQueue) {
    console.log(`[WORKER] Queueing child node "${nodeId}" for Run ID: ${runId}`);
    await activityQueue.add(
      `job_${runId}_${nodeId}`,
      {
        runId,
        nodeId,
        workflowId,
        nodes,
        edges
      }
    );
  }
}

const worker = new Worker(
  'activity-queue',
  async (job) => {
    const { runId, nodeId, workflowId, nodes, edges, isCron } = job.data;

    // Handle Repeatable Cron Trigger Jobs enqueued by BullMQ
    if (isCron) {
      const newRunId = `run_cron_${Math.random().toString(36).substring(2, 11)}`;
      console.log(`[WORKER] [CRON] Triggering scheduled execution "${newRunId}" for workflow "${workflowId}"`);
      
      try {
        const nodesState: Record<string, string> = {};
        for (const n of nodes) {
          nodesState[n.id] = 'pending';
        }
        nodesState[nodeId] = 'completed'; // Mark cron trigger completed

        await db.run.create({
          data: {
            id: newRunId,
            workflowId,
            status: 'running',
            nodesState: nodesState as any,
            startedAt: new Date()
          }
        });

        const startEvent = await db.event.create({
          data: {
            runId: newRunId,
            type: 'run_started',
            message: `Workflow run ${newRunId} started automatically via cron schedule.`
          }
        });

        const cronEvent = await db.event.create({
          data: {
            runId: newRunId,
            type: 'cron_triggered',
            nodeId,
            message: `Cron trigger "${nodeId}" activated execution.`
          }
        });

        // Publish start event to Redis Pub/Sub
        await redisPublisher.publish(`run:${newRunId}:events`, JSON.stringify({
          type: 'event',
          event: {
            timestamp: startEvent.timestamp.toISOString(),
            type: startEvent.type,
            message: startEvent.message
          },
          runStatus: 'running',
          nodesState
        }));

        // Enqueue children of the cron node
        const children = nodes.filter((n: any) =>
          edges.some((edge: any) => edge.source === nodeId && edge.target === n.id)
        );

        for (const child of children) {
          console.log(`[WORKER] [CRON] Queueing downstream activity "${child.id}" for Run ID: ${newRunId}`);
          await activityQueue.add(
            `job_${newRunId}_${child.id}`,
            {
              runId: newRunId,
              nodeId: child.id,
              workflowId,
              nodes,
              edges
            }
          );
        }
      } catch (err: any) {
        console.error(`[WORKER] [CRON] Failed to instantiate cron run:`, err.message);
      }
      return;
    }

    console.log(`[WORKER] Received job for node "${nodeId}" (Run ID: ${runId})`);

    const node = nodes.find((n: any) => n.id === nodeId);
    if (!node) {
      console.error(`[WORKER] Node "${nodeId}" definition not found in job payload.`);
      return;
    }

    try {
      // 1. Check current run status in database
      let run = await db.run.findUnique({ where: { id: runId } });
      if (!run) {
        console.log(`[WORKER] Run ${runId} not found. Aborting node.`);
        return;
      }

      if (run.status === 'paused') {
        console.log(`[WORKER] Run ${runId} is paused. Deferring node "${nodeId}" for 2000ms.`);
        await activityQueue.add(
          `job_${runId}_${nodeId}`,
          {
            runId,
            nodeId,
            workflowId,
            nodes,
            edges
          },
          { delay: 2000 }
        );
        return;
      }

      if (run.status === 'cancelled' || run.status === 'failed' || run.status === 'completed') {
        console.log(`[WORKER] Run ${runId} is in a non-running status (${run.status}). Aborting node.`);
        return;
      }

      // Mark node as running
      const nodesState = (run.nodesState || {}) as Record<string, string>;
      nodesState[nodeId] = 'running';

      await db.run.update({
        where: { id: runId },
        data: { nodesState }
      });

      const nodeStartEvent = await db.event.create({
        data: {
          runId,
          type: 'node_started',
          nodeId,
          message: `Node "${nodeId}" (${node.type}) started processing.`
        }
      });

      // Publish event to Redis Pub/Sub channel
      await redisPublisher.publish(
        `run:${runId}:events`,
        JSON.stringify({
          type: 'event',
          event: {
            timestamp: nodeStartEvent.timestamp.toISOString(),
            type: nodeStartEvent.type,
            nodeId: nodeStartEvent.nodeId,
            message: nodeStartEvent.message
          },
          runStatus: run.status,
          nodesState
        })
      );

      // 2. Resolve inputs from previous execution nodes (Event Sourcing Replay)
      const pastEvents = await db.event.findMany({
        where: { 
          runId,
          type: { in: ['node_completed', 'webhook_triggered'] }
        }
      });
      const outputs: Record<string, string> = {};
      for (const ev of pastEvents) {
        if (ev.nodeId) {
          if (ev.type === 'node_completed') {
            const match = ev.message.match(/Result: (.*)$/s);
            if (match) {
              outputs[ev.nodeId] = match[1];
            }
          } else if (ev.type === 'webhook_triggered') {
            const match = ev.message.match(/completed with payload: (.*)$/s);
            if (match) {
              try {
                const parsed = JSON.parse(match[1]);
                outputs[ev.nodeId] = typeof parsed === 'string' ? parsed : match[1];
              } catch {
                outputs[ev.nodeId] = match[1];
              }
            }
          }
        }
      }

      // 3. Dispatch task to specialized action type handler
      let outputText = '';
      if (node.type === 'condition') {
        let expression = node.parameters?.expression || 'true';
        // Substitute outputs
        for (const [prevNodeId, val] of Object.entries(outputs)) {
          const escapedVal = JSON.stringify(val);
          expression = expression.replace(new RegExp(`{{\\s*${prevNodeId}\\s*}}`, 'g'), escapedVal);
        }
        
        let result = false;
        try {
          result = !!(new Function(`return (${expression})`)());
        } catch (e: any) {
          console.error(`Failed to evaluate condition "${expression}":`, e);
          throw new Error(`Condition evaluation error: ${e.message}`);
        }
        outputText = result ? 'true' : 'false';
        console.log(`[WORKER] Condition evaluated: "${expression}" -> ${outputText}`);
      } else if (node.type === 'subworkflow') {
        const subWorkflowId = node.parameters?.subWorkflowId || '';
        let payloadTemplate = node.parameters?.payload || '{}';

        // Substitute outputs in payload template
        for (const [key, val] of Object.entries(outputs)) {
          payloadTemplate = payloadTemplate.replace(new RegExp(`{{${key}}}`, 'g'), val);
        }

        const subWorkflow = await db.workflow.findUnique({ where: { id: subWorkflowId } });
        if (!subWorkflow) {
          throw new Error(`Sub-workflow with ID "${subWorkflowId}" not found.`);
        }

        // Generate child run key using unique identifier delimiter
        const subRunId = `run_sub::${runId}::${nodeId}::${Math.random().toString(36).substring(2, 9)}`;
        const subDefinition = subWorkflow.definition as any;
        const subNodes = subDefinition.nodes || [];
        const subEdges = subDefinition.edges || [];
        const subNodesState: Record<string, string> = {};
        for (const sn of subNodes) {
          subNodesState[sn.id] = 'pending';
        }

        console.log(`[WORKER] [SUB-WORKFLOW] Starting child run "${subRunId}" of workflow "${subWorkflowId}"`);

        await db.run.create({
          data: {
            id: subRunId,
            workflowId: subWorkflowId,
            status: 'running',
            nodesState: subNodesState as any,
            startedAt: new Date()
          }
        });

        const startMsg = `Sub-workflow run ${subRunId} started from parent run "${runId}" node "${nodeId}" with input: ${payloadTemplate}`;
        const subStartEvent = await db.event.create({
          data: {
            runId: subRunId,
            type: 'run_started',
            message: startMsg
          }
        });

        // Publish sub-workflow start event
        await redisPublisher.publish(
          `run:${subRunId}:events`,
          JSON.stringify({
            type: 'event',
            event: {
              timestamp: subStartEvent.timestamp.toISOString(),
              type: subStartEvent.type,
              message: subStartEvent.message
            },
            runStatus: 'running',
            nodesState: subNodesState
          })
        );

        // Mark root nodes of the sub-workflow as completed using the payloadTemplate
        const childNodesToQueue = new Set<string>();
        for (const rootNode of subNodes) {
          const isRoot = !subEdges.some((edge: any) => edge.target === rootNode.id);
          if (isRoot) {
            subNodesState[rootNode.id] = 'completed';
            const subCompleteEvent = await db.event.create({
              data: {
                runId: subRunId,
                type: 'node_completed',
                nodeId: rootNode.id,
                message: `Node "${rootNode.id}" completed. Result: ${payloadTemplate}`
              }
            });

            await redisPublisher.publish(
              `run:${subRunId}:events`,
              JSON.stringify({
                type: 'event',
                event: {
                  timestamp: subCompleteEvent.timestamp.toISOString(),
                  type: subCompleteEvent.type,
                  nodeId: rootNode.id,
                  message: subCompleteEvent.message
                },
                runStatus: 'running',
                nodesState: subNodesState
              })
            );

            // Find children of this root node
            const children = subNodes.filter((n: any) =>
              subEdges.some((edge: any) => edge.source === rootNode.id && edge.target === n.id)
            );
            for (const child of children) {
              childNodesToQueue.add(child.id);
            }
          }
        }

        // Update the sub-run nodesState in the database
        await db.run.update({
          where: { id: subRunId },
          data: { nodesState: subNodesState }
        });

        // Queue all children in BullMQ
        for (const cid of childNodesToQueue) {
          await activityQueue.add(
            `job_${subRunId}_${cid}`,
            {
              runId: subRunId,
              nodeId: cid,
              workflowId: subWorkflowId,
              nodes: subNodes,
              edges: subEdges
            }
          );
        }

        // Defer parent execution path by returning early without completing the parent node.
        console.log(`[WORKER] [SUB-WORKFLOW] Parent run "${runId}" node "${nodeId}" suspended waiting for sub-run "${subRunId}"`);
        return;
      } else {
        const actionType = node.parameters?.actionType || 'simulated';
        
        console.log(`[WORKER] Running action type: "${actionType}" for node: "${nodeId}"`);

        if (actionType === 'simulated') {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const shouldFail = node.parameters?.fail === true || node.id.toLowerCase().includes('fail');
          if (shouldFail) {
            throw new Error(`Simulated task failure requested for node "${nodeId}".`);
          }
          outputText = `Simulated execution complete.`;
        } 
        else if (actionType === 'http') {
          const urlTemplate = node.parameters?.url || '';
          const method = node.parameters?.method || 'POST';
          const headersRaw = node.parameters?.headers || '{}';
          const bodyTemplate = node.parameters?.body || '';

          // Resolve templates
          let url = urlTemplate;
          let body = bodyTemplate;
          for (const [key, val] of Object.entries(outputs)) {
            url = url.replace(new RegExp(`{{${key}}}`, 'g'), val);
            body = body.replace(new RegExp(`{{${key}}}`, 'g'), val);
          }

          const headers = typeof headersRaw === 'string' ? JSON.parse(headersRaw) : headersRaw;
          console.log(`[WORKER] [HTTP] Triggering ${method} -> ${url}`);

          const fetchRes = await fetch(url, {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...headers
            },
            body: method !== 'GET' && method !== 'HEAD' && body ? body : null
          });

          const textResult = await fetchRes.text();
          if (!fetchRes.ok) {
            throw new Error(`Outbound HTTP failed with status ${fetchRes.status}: ${textResult.substring(0, 100)}`);
          }
          outputText = textResult;
        } 
        else if (actionType === 'file') {
          const filepathTemplate = node.parameters?.filepath || './storage/log.txt';
          const contentTemplate = node.parameters?.content || 'Task completed at {{timestamp}}';

          let filepath = filepathTemplate;
          let content = contentTemplate;
          for (const [key, val] of Object.entries(outputs)) {
            filepath = filepath.replace(new RegExp(`{{${key}}}`, 'g'), val);
            content = content.replace(new RegExp(`{{${key}}}`, 'g'), val);
          }
          content = content.replace(/{{timestamp}}/g, new Date().toISOString());

          const absolutePath = path.resolve(process.cwd(), filepath);
          const dir = path.dirname(absolutePath);

          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(absolutePath, content, 'utf8');
          console.log(`[WORKER] [FILE] Saved content to ${absolutePath}`);
          outputText = `File written successfully to ${filepath}`;
        } 
        else if (actionType === 'ai_gemini') {
          const promptTemplate = node.parameters?.prompt || 'Welcome developer';

          let prompt = promptTemplate;
          for (const [key, val] of Object.entries(outputs)) {
            prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), val);
          }

          const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
          let aiResponse = '';

          if (apiKey) {
            console.log(`[WORKER] [AI] Dispatching prompt to Gemini API...`);
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            
            const response = await fetch(geminiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
              })
            });
            
            if (!response.ok) {
              const errText = await response.text();
              throw new Error(`Gemini API error ${response.status}: ${errText}`);
            }
            
            const resJson: any = await response.json();
            aiResponse = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
            aiResponse = aiResponse.trim();
          } else {
            console.log(`[WORKER] [AI] Warning: GEMINI_API_KEY missing, using mock generator.`);
            aiResponse = `[SIMULATED GEMINI AI RESPONSE] Completed prompt: "${prompt}".`;
          }

          outputText = aiResponse;
        }
      }

      // 4. Mark node as completed in database
      nodesState[nodeId] = 'completed';
      run = await db.run.update({
        where: { id: runId },
        data: { nodesState }
      });

      const nodeCompleteEvent = await db.event.create({
        data: {
          runId,
          type: 'node_completed',
          nodeId,
          message: `Node "${nodeId}" completed. Result: ${outputText}`
        }
      });

      // Publish completion event to Redis Pub/Sub
      await redisPublisher.publish(
        `run:${runId}:events`,
        JSON.stringify({
          type: 'event',
          event: {
            timestamp: nodeCompleteEvent.timestamp.toISOString(),
            type: nodeCompleteEvent.type,
            nodeId: nodeCompleteEvent.nodeId,
            message: nodeCompleteEvent.message
          },
          runStatus: run.status,
          nodesState
        })
      );

      console.log(`[WORKER] Node "${nodeId}" completed successfully.`);

      // 5. Evaluate downstream child nodes and queue if ready
      await resolveAndQueueDownstream(runId, workflowId, nodes, edges, nodesState, activityQueue);

      // 6. Check if the entire workflow run is completed
      const isWorkflowFinished = nodes.every((n: any) => 
        nodesState[n.id] === 'completed' || 
        nodesState[n.id] === 'skipped' || 
        nodesState[n.id] === 'failed'
      );

      if (isWorkflowFinished) {
        const hasFailed = nodes.some((n: any) => nodesState[n.id] === 'failed');
        const finalStatus = hasFailed ? 'failed' : 'completed';

        await db.run.update({
          where: { id: runId },
          data: {
            status: finalStatus,
            completedAt: new Date()
          }
        });

        const endEvent = await db.event.create({
          data: {
            runId,
            type: finalStatus === 'completed' ? 'run_completed' : 'run_failed',
            message: finalStatus === 'completed' 
              ? `Workflow run completed successfully.` 
              : `Workflow run finished with failures.`
          }
        });

        // Publish final completion event to Redis Pub/Sub
        await redisPublisher.publish(
          `run:${runId}:events`,
          JSON.stringify({
            type: 'event',
            event: {
              timestamp: endEvent.timestamp.toISOString(),
              type: endEvent.type,
              message: endEvent.message
            },
            runStatus: finalStatus,
            nodesState
          })
        );

        console.log(`[WORKER] Run ${runId} has finished all execution paths. Status: ${finalStatus}`);

        if (runId.startsWith('run_sub::')) {
          const parts = runId.split('::');
          const parentRunId = parts[1];
          const parentNodeId = parts[2];

          console.log(`[WORKER] Sub-workflow "${runId}" finished with status "${finalStatus}". Resuming parent run "${parentRunId}" node "${parentNodeId}"`);

          const parentRun = await db.run.findUnique({ where: { id: parentRunId } });
          if (parentRun && parentRun.status === 'running') {
            const parentNodesState = (parentRun.nodesState || {}) as Record<string, string>;

            const parentWf = await db.workflow.findUnique({ where: { id: parentRun.workflowId } });
            if (parentWf) {
              const parentDefinition = parentWf.definition as any;
              const parentNodes = parentDefinition.nodes || [];
              const parentEdges = parentDefinition.edges || [];

              if (finalStatus === 'completed') {
                const lastSubEvent = await db.event.findFirst({
                  where: { runId, type: 'node_completed' },
                  orderBy: { timestamp: 'desc' }
                });
                const childOutputText = lastSubEvent?.message || `Sub-workflow completed.`;

                parentNodesState[parentNodeId] = 'completed';
                await db.run.update({
                  where: { id: parentRunId },
                  data: { nodesState: parentNodesState }
                });

                const completeEv = await db.event.create({
                  data: {
                    runId: parentRunId,
                    type: 'node_completed',
                    nodeId: parentNodeId,
                    message: `Node "${parentNodeId}" completed. Result: ${childOutputText}`
                  }
                });

                await redisPublisher.publish(
                  `run:${parentRunId}:events`,
                  JSON.stringify({
                    type: 'event',
                    event: {
                      timestamp: completeEv.timestamp.toISOString(),
                      type: completeEv.type,
                      nodeId: completeEv.nodeId,
                      message: completeEv.message
                    },
                    runStatus: 'running',
                    nodesState: parentNodesState
                  })
                );

                await resolveAndQueueDownstream(parentRunId, parentRun.workflowId, parentNodes, parentEdges, parentNodesState, activityQueue);
              } else {
                parentNodesState[parentNodeId] = 'failed';
                await db.run.update({
                  where: { id: parentRunId },
                  data: { nodesState: parentNodesState }
                });

                const failEv = await db.event.create({
                  data: {
                    runId: parentRunId,
                    type: 'node_failed',
                    nodeId: parentNodeId,
                    message: `Node "${parentNodeId}" failed because the child sub-workflow execution failed.`
                  }
                });

                await redisPublisher.publish(
                  `run:${parentRunId}:events`,
                  JSON.stringify({
                    type: 'event',
                    event: {
                      timestamp: failEv.timestamp.toISOString(),
                      type: failEv.type,
                      nodeId: failEv.nodeId,
                      message: failEv.message
                    },
                    runStatus: 'running',
                    nodesState: parentNodesState
                  })
                );

                await resolveAndQueueDownstream(parentRunId, parentRun.workflowId, parentNodes, parentEdges, parentNodesState, activityQueue);
              }
            }
          }
        }
      }

    } catch (err: any) {
      console.error(`[WORKER] Error executing job for node "${nodeId}":`, err.message);
      try {
        const maxAttempts = node.retry?.maxAttempts || 1;
        const backoffType = node.retry?.backoffType || 'fixed';
        const backoffDelay = node.retry?.backoffDelay || 1000;

        const failuresCount = await db.event.count({
          where: { runId, nodeId, type: 'node_failed' }
        });

        const currentAttempt = failuresCount + 1;

        if (currentAttempt < maxAttempts) {
          let calculatedDelay = backoffDelay;
          if (backoffType === 'exponential') {
            calculatedDelay = backoffDelay * Math.pow(2, currentAttempt - 1);
          }

          const retryEvent = await db.event.create({
            data: {
              runId,
              type: 'node_failed',
              nodeId,
              message: `Attempt ${currentAttempt} failed: ${err.message}. Retrying in ${calculatedDelay}ms (backoff: ${backoffType}).`
            }
          });

          await redisPublisher.publish(
            `run:${runId}:events`,
            JSON.stringify({
              type: 'event',
              event: {
                timestamp: retryEvent.timestamp.toISOString(),
                type: 'node_started',
                nodeId,
                message: retryEvent.message
              },
              runStatus: 'running',
              nodesState: (await db.run.findUnique({ where: { id: runId } }))?.nodesState || {}
            })
          );

          await activityQueue.add(
            `job_${runId}_${nodeId}`,
            {
              runId,
              nodeId,
              workflowId,
              nodes,
              edges
            },
            { delay: calculatedDelay }
          );

          console.log(`[WORKER] Scheduled retry attempt ${currentAttempt + 1} for node "${nodeId}" in ${calculatedDelay}ms`);
          return;
        }

        const run = await db.run.findUnique({ where: { id: runId } });
        if (run) {
          const nodesState = (run.nodesState || {}) as Record<string, string>;
          nodesState[nodeId] = 'failed';
          
          await db.run.update({
            where: { id: runId },
            data: { nodesState }
          });

          const nodeFailEvent = await db.event.create({
            data: {
              runId,
              type: 'node_failed',
              nodeId,
              message: `Node "${nodeId}" failed after ${currentAttempt} attempts. Error: ${err.message}`
            }
          });

          await redisPublisher.publish(
            `run:${runId}:events`,
            JSON.stringify({
              type: 'event',
              event: {
                timestamp: nodeFailEvent.timestamp.toISOString(),
                type: nodeFailEvent.type,
                nodeId: nodeFailEvent.nodeId,
                message: nodeFailEvent.message
              },
              runStatus: 'failed',
              nodesState
            })
          );

          // Propagate failure/skips downstream
          await resolveAndQueueDownstream(runId, workflowId, nodes, edges, nodesState, activityQueue);

          const isWorkflowFinished = nodes.every((n: any) => 
            nodesState[n.id] === 'completed' || 
            nodesState[n.id] === 'skipped' || 
            nodesState[n.id] === 'failed'
          );

          if (isWorkflowFinished) {
            await db.run.update({
              where: { id: runId },
              data: {
                status: 'failed',
                completedAt: new Date()
              }
            });

            const runFailEvent = await db.event.create({
              data: {
                runId,
                type: 'run_failed',
                message: `Workflow run finished with failures.`
              }
            });

            await redisPublisher.publish(
              `run:${runId}:events`,
              JSON.stringify({
                type: 'event',
                event: {
                  timestamp: runFailEvent.timestamp.toISOString(),
                  type: runFailEvent.type,
                  message: runFailEvent.message
                },
                runStatus: 'failed',
                nodesState
              })
            );

            if (runId.startsWith('run_sub::')) {
              const parts = runId.split('::');
              const parentRunId = parts[1];
              const parentNodeId = parts[2];

              console.log(`[WORKER] Sub-workflow "${runId}" finished with status "failed". Resuming parent run "${parentRunId}" node "${parentNodeId}"`);

              const parentRun = await db.run.findUnique({ where: { id: parentRunId } });
              if (parentRun && parentRun.status === 'running') {
                const parentNodesState = (parentRun.nodesState || {}) as Record<string, string>;

                const parentWf = await db.workflow.findUnique({ where: { id: parentRun.workflowId } });
                if (parentWf) {
                  const parentDefinition = parentWf.definition as any;
                  const parentNodes = parentDefinition.nodes || [];
                  const parentEdges = parentDefinition.edges || [];

                  parentNodesState[parentNodeId] = 'failed';
                  await db.run.update({
                    where: { id: parentRunId },
                    data: { nodesState: parentNodesState }
                  });

                  const failEv = await db.event.create({
                    data: {
                      runId: parentRunId,
                      type: 'node_failed',
                      nodeId: parentNodeId,
                      message: `Node "${parentNodeId}" failed because the child sub-workflow execution failed.`
                    }
                  });

                  await redisPublisher.publish(
                    `run:${parentRunId}:events`,
                    JSON.stringify({
                      type: 'event',
                      event: {
                        timestamp: failEv.timestamp.toISOString(),
                        type: failEv.type,
                        nodeId: failEv.nodeId,
                        message: failEv.message
                      },
                      runStatus: 'running',
                      nodesState: parentNodesState
                    })
                  );

                  await resolveAndQueueDownstream(parentRunId, parentRun.workflowId, parentNodes, parentEdges, parentNodesState, activityQueue);
                }
              }
            }
          }
        }
      } catch (dbErr: any) {
        console.error(`[WORKER] Failed to register node failure in DB:`, dbErr.message);
      }
    }
  },
  { connection: redisConfig }
);

worker.on('failed', (job, err) => {
  console.error(`[WORKER] Job ${job?.id} failed with error:`, err.message);
});

worker.on('error', (err) => {
  console.error('[WORKER] Global worker error:', err.message);
});
