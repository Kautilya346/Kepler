import { z } from 'zod';

export const retrySchema = z.object({
  maxAttempts: z.number().min(1).default(1),
  backoffType: z.enum(['fixed', 'exponential']).default('fixed'),
  backoffDelay: z.number().min(0).default(1000)
});

export const nodeSchema = z.object({
  id: z.string().min(1, 'Node ID cannot be empty'),
  type: z.string().min(1, 'Node type cannot be empty'),
  parameters: z.record(z.any()).optional(),
  position: z.object({
    x: z.number(),
    y: z.number()
  }).optional(),
  label: z.string().optional(),
  retry: retrySchema.optional()
});

export const edgeSchema = z.object({
  source: z.string().min(1, 'Edge source cannot be empty'),
  target: z.string().min(1, 'Edge target cannot be empty'),
  condition: z.string().optional(),
});

export const workflowSchema = z.object({
  name: z.string().min(1, 'Workflow name is required'),
  description: z.string().optional(),
  nodes: z.array(nodeSchema).min(1, 'Workflow must contain at least one node'),
  edges: z.array(edgeSchema).default([]),
});

export type WorkflowDefinition = z.infer<typeof workflowSchema>;

/**
 * Validates that the workflow is a valid Directed Acyclic Graph (DAG)
 * 1. Checks if all edge sources and targets exist in the nodes list.
 * 2. Checks for cycles using a Depth-First Search (DFS) graph coloring algorithm.
 */
export function validateDAG(workflow: WorkflowDefinition): { isValid: boolean; error?: string } {
  const nodeIds = new Set(workflow.nodes.map(n => n.id));

  // 1. Check if all referenced nodes in edges exist
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source)) {
      return { isValid: false, error: `Edge source "${edge.source}" does not exist in nodes list` };
    }
    if (!nodeIds.has(edge.target)) {
      return { isValid: false, error: `Edge target "${edge.target}" does not exist in nodes list` };
    }
  }

  // 2. Cycle Detection using DFS (coloring)
  // 0 = UNVISITED, 1 = VISITING, 2 = VISITED
  const visited: Record<string, number> = {};
  for (const node of workflow.nodes) {
    visited[node.id] = 0;
  }

  // Build adjacency list
  const adj: Record<string, string[]> = {};
  for (const node of workflow.nodes) {
    adj[node.id] = [];
  }
  for (const edge of workflow.edges) {
    adj[edge.source].push(edge.target);
  }

  function hasCycle(u: string): boolean {
    visited[u] = 1; // VISITING (gray)

    for (const v of adj[u]) {
      if (visited[v] === 1) {
        return true; // Cycle detected: back-edge to a node currently in the recursion stack
      }
      if (visited[v] === 0) {
        if (hasCycle(v)) return true;
      }
    }

    visited[u] = 2; // VISITED (black)
    return false;
  }

  // Run DFS from each unvisited node
  for (const node of workflow.nodes) {
    if (visited[node.id] === 0) {
      if (hasCycle(node.id)) {
        return { isValid: false, error: `Cycle detected in workflow. Node graph contains a circular dependency starting from or involving node "${node.id}"` };
      }
    }
  }

  return { isValid: true };
}
export interface WorkflowWithId extends WorkflowDefinition {
  id: string;
  createdAt: string;
}
