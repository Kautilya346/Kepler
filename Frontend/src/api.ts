const BASE_URL = 'http://localhost:3001';
const WS_BASE_URL = 'ws://localhost:3001';

export interface WorkflowNode {
  id: string;
  type: string;
  parameters?: Record<string, any>;
  position?: {
    x: number;
    y: number;
  };
  label?: string;
  retry?: {
    maxAttempts: number;
    backoffType: 'fixed' | 'exponential';
    backoffDelay: number;
  };
}

export interface WorkflowEdge {
  source: string;
  target: string;
  condition?: string;
}

export interface WorkflowDefinition {
  id?: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt?: string;
}

export interface RunEvent {
  timestamp: string;
  type: string;
  nodeId?: string | null;
  message: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: string;
  nodesState: Record<string, 'pending' | 'running' | 'completed' | 'failed'>;
  startedAt: string;
  completedAt?: string | null;
  events?: RunEvent[];
}

let activeToken: string | null = null;

/**
 * Automates login by calling our CLI-auth helper endpoint
 */
export async function authenticateDeveloper(): Promise<string> {
  const stored = localStorage.getItem('t_clone_dev_token');
  if (stored) {
    activeToken = stored;
    return stored;
  }

  const res = await fetch(`${BASE_URL}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'web_developer', role: 'admin' })
  });

  if (!res.ok) {
    throw new Error('Failed to acquire developer credentials.');
  }

  const data = await res.json();
  activeToken = data.token;
  localStorage.setItem('t_clone_dev_token', data.token);
  return data.token;
}

async function request(method: string, path: string, body: any = null) {
  if (!activeToken) {
    await authenticateDeveloper();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${activeToken}`
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  if (res.status === 401) {
    // Retry once with new token
    localStorage.removeItem('t_clone_dev_token');
    await authenticateDeveloper();
    headers['Authorization'] = `Bearer ${activeToken}`;
    const retryRes = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });
    if (!retryRes.ok) throw await retryRes.json();
    return retryRes.json();
  }

  if (!res.ok) {
    const errorPayload = await res.json().catch(() => ({}));
    throw errorPayload;
  }

  return res.json();
}

export const api = {
  listWorkflows: async (): Promise<{ workflows: WorkflowDefinition[] }> => {
    const data = await request('GET', '/api/workflows');
    const mapped = (data.workflows || []).map((wf: any) => {
      const def = typeof wf.definition === 'string' ? JSON.parse(wf.definition) : (wf.definition || {});
      return {
        ...wf,
        nodes: def.nodes || wf.nodes || [],
        edges: def.edges || wf.edges || []
      };
    });
    return { workflows: mapped };
  },
    
  getWorkflow: async (id: string): Promise<{ workflow: WorkflowDefinition }> => {
    const data = await request('GET', `/api/workflows/${id}`);
    const wf = data.workflow;
    if (wf) {
      const def = typeof wf.definition === 'string' ? JSON.parse(wf.definition) : (wf.definition || {});
      data.workflow = {
        ...wf,
        nodes: def.nodes || wf.nodes || [],
        edges: def.edges || wf.edges || []
      };
    }
    return data;
  },
    
  createWorkflow: (workflow: Omit<WorkflowDefinition, 'id'>): Promise<{ message: string; workflow: WorkflowDefinition }> => 
    request('POST', '/api/workflows', workflow),

  updateWorkflow: (id: string, workflow: Omit<WorkflowDefinition, 'id'>): Promise<{ message: string; workflow: WorkflowDefinition }> => 
    request('PUT', `/api/workflows/${id}`, workflow),

  deleteWorkflow: (id: string): Promise<{ message: string }> => 
    request('DELETE', `/api/workflows/${id}`),
    
  triggerRun: (workflowId: string): Promise<{ run: WorkflowRun }> => 
    request('POST', `/api/workflows/${workflowId}/run`),
    
  getRun: (runId: string): Promise<{ run: WorkflowRun }> => 
    request('GET', `/api/workflows/runs/${runId}`),
    
  reconstructState: (runId: string): Promise<{ replayed: { status: string; nodesState: Record<string, string> } }> => 
    request('GET', `/api/workflows/runs/${runId}/replay`),

  pauseRun: (runId: string): Promise<{ message: string; run: WorkflowRun }> => 
    request('POST', `/api/workflows/runs/${runId}/pause`),

  resumeRun: (runId: string): Promise<{ message: string; run: WorkflowRun }> => 
    request('POST', `/api/workflows/runs/${runId}/resume`),

  cancelRun: (runId: string): Promise<{ message: string; run: WorkflowRun }> => 
    request('POST', `/api/workflows/runs/${runId}/cancel`),

  triggerWebhook: async (workflowId: string, nodeId: string, payload: any): Promise<{ runId: string; run: WorkflowRun }> => {
    const res = await fetch(`${BASE_URL}/api/webhooks/${workflowId}/${nodeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw await res.json();
    }
    return res.json();
  }
};

/**
 * Establishes WebSocket live telemetry stream
 */
export function connectLiveTelemetry(
  runId: string,
  onMessage: (msg: any) => void,
  onError: (err: any) => void,
  onClose: () => void
): WebSocket {
  const token = activeToken || '';
  const ws = new WebSocket(`${WS_BASE_URL}/api/runs/${runId}/live?token=${token}`);

  ws.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      onMessage(parsed);
    } catch (err) {
      console.error('Failed to parse WebSocket event:', err);
    }
  };

  ws.onerror = (err) => {
    onError(err);
  };

  ws.onclose = () => {
    onClose();
  };

  return ws;
}
