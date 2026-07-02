import { useState, useEffect } from 'react';
import { 
  GitBranch, 
  Activity, 
  Plus, 
  Play, 
  Clock, 
  ExternalLink,
  ChevronRight,
  Database,
  Link2,
  RefreshCw,
  Edit3,
  Trash2
} from 'lucide-react';
import { api } from '../api';
import type { WorkflowDefinition } from '../api';
import { WorkflowBuilder } from './WorkflowBuilder';
import { ExecutionMonitor } from './ExecutionMonitor';

export const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'workflows' | 'executions' | 'builder' | 'monitor'>('workflows');
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<any[]>([]); // We fetch from the db
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowDefinition | null>(null);
  
  // Webhook details modal
  const [selectedWebhookWf, setSelectedWebhookWf] = useState<WorkflowDefinition | null>(null);
  const [webhookNodeId, setWebhookNodeId] = useState('');
  const [webhookPayload, setWebhookPayload] = useState('{\n  "event": "order_completed",\n  "amount": 250\n}');
  const [isTriggeringWebhook, setIsTriggeringWebhook] = useState(false);

  const fetchWorkflows = async () => {
    try {
      const data = await api.listWorkflows();
      setWorkflows(data.workflows);
    } catch (err) {
      console.error('Failed to load workflows:', err);
    }
  };

  const fetchExecutions = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/workflows/runs', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('t_clone_dev_token')}`
        }
      });
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (err) {
      console.error('Failed to load runs:', err);
    }
  };

  useEffect(() => {
    fetchWorkflows();
    // Periodically poll executions list
    const timer = setInterval(() => {
      if (activeTab === 'executions') {
        fetchExecutions();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'workflows') {
      fetchWorkflows();
    } else if (activeTab === 'executions') {
      fetchExecutions();
    }
  }, [activeTab]);

  const triggerWorkflowManual = async (workflowId: string) => {
    try {
      const data = await api.triggerRun(workflowId);
      setSelectedRunId(data.run.id);
      setActiveTab('monitor');
    } catch (err) {
      console.error('Failed to trigger execution:', err);
    }
  };

  const triggerWebhookAPI = async () => {
    if (!selectedWebhookWf) return;
    setIsTriggeringWebhook(true);
    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(webhookPayload);
      } catch (e) {
        alert('Invalid JSON payload');
        return;
      }
      
      const res = await api.triggerWebhook(selectedWebhookWf.id!, webhookNodeId, parsedPayload);
      setSelectedWebhookWf(null);
      setSelectedRunId(res.runId);
      setActiveTab('monitor');
    } catch (err: any) {
      alert(err.error || err.message || 'Webhook trigger failed');
    } finally {
      setIsTriggeringWebhook(false);
    }
  };

  const openWebhookModal = (wf: WorkflowDefinition) => {
    const webhookNode = wf.nodes.find(n => n.type === 'webhook');
    if (webhookNode) {
      setWebhookNodeId(webhookNode.id);
      setSelectedWebhookWf(wf);
    }
  };

  const deleteWorkflowTemplate = async (workflowId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete workflow "${name}"? This will delete all associated executions and event history.`)) {
      return;
    }
    try {
      await api.deleteWorkflow(workflowId);
      fetchWorkflows();
    } catch (err) {
      console.error('Failed to delete workflow:', err);
      alert('Delete workflow failed.');
    }
  };

  const refreshExecutions = () => {
    fetchExecutions();
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100vw', background: 'var(--bg-main)' }}>
      {/* Sidebar Navigation */}
      <div className="glass" style={{ width: '220px', display: 'flex', flexDirection: 'column', gap: '30px', padding: '30px 20px', borderRight: '1px solid var(--border-color)', borderLeft: 'none', borderTop: 'none', borderBottom: 'none', height: '100vh', position: 'sticky', top: 0, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Database size={22} color="var(--color-primary)" />
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'white' }}>
            T-Clone Console
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('workflows')}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: activeTab === 'workflows' ? 'rgba(56, 189, 248, 0.08)' : 'transparent', border: 'none', borderRadius: '6px', color: activeTab === 'workflows' ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontWeight: 600, width: '100%', textAlign: 'left', transition: 'all 0.2s' }}
          >
            <GitBranch size={16} />
            Workflows
          </button>
          
          <button
            onClick={() => setActiveTab('executions')}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: activeTab === 'executions' ? 'rgba(56, 189, 248, 0.08)' : 'transparent', border: 'none', borderRadius: '6px', color: activeTab === 'executions' ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontWeight: 600, width: '100%', textAlign: 'left', transition: 'all 0.2s' }}
          >
            <Activity size={16} />
            Executions
          </button>
        </div>

        <button
          onClick={() => {
            setEditingWorkflow(null);
            setActiveTab('builder');
          }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white', fontWeight: 600, marginTop: 'auto' }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
        >
          <Plus size={16} color="var(--color-primary)" />
          New Workflow
        </button>
      </div>

      {/* Main Panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <header className="glass" style={{ padding: '20px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', borderTop: 'none', borderRight: 'none', borderLeft: 'none' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700 }}>
              {activeTab === 'workflows' && 'Workflow Templates'}
              {activeTab === 'executions' && 'Execution History'}
              {activeTab === 'builder' && 'Workflow Designer'}
              {activeTab === 'monitor' && 'Live Execution Monitor'}
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              {activeTab === 'workflows' && 'Durable templates seeded in PostgreSQL'}
              {activeTab === 'executions' && 'Activity execution logs & state sourcing history'}
              {activeTab === 'builder' && 'Construct cyclical or directed acyclic graph definitions'}
              {activeTab === 'monitor' && 'Streaming pipeline telemetry over WebSockets'}
            </p>
          </div>
          
          <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', display: 'flex', gap: '15px' }}>
            <span>API Port: <span style={{ color: 'white' }}>3001</span></span>
            <span>Redis Port: <span style={{ color: 'white' }}>6379</span></span>
          </div>
        </header>

        {/* Content Tabs */}
        <div style={{ flex: 1, padding: '30px 40px', display: 'flex' }}>
          {activeTab === 'workflows' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Registered Templates ({workflows.length})
                </span>
                <button
                  onClick={() => {
                    setEditingWorkflow(null);
                    setActiveTab('builder');
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '6px', color: 'var(--color-primary)', fontWeight: 600, fontSize: '13px' }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'}
                >
                  <Plus size={14} />
                  New Workflow
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
                {workflows.length === 0 ? (
                  <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    No workflows registered yet. Click "New Workflow" to design one!
                  </div>
                ) : (
                  workflows.map(wf => {
                    const hasCron = wf.nodes.some(n => n.type === 'cron');
                    const hasWebhook = wf.nodes.some(n => n.type === 'webhook');

                    return (
                      <div key={wf.id} className="glass" style={{ borderRadius: '8px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '15px', position: 'relative', overflow: 'hidden' }}>
                        <div>
                          <h3 style={{ fontSize: '16px', color: 'white', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {wf.name}
                            <span style={{ fontSize: '11px', color: 'var(--color-primary)', background: 'rgba(138, 180, 248, 0.1)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 'normal' }}>
                              {wf.id}
                            </span>
                          </h3>
                          <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: '1.4' }}>{wf.description}</p>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: '4px', color: 'var(--color-text-secondary)' }}>
                            Nodes: {wf.nodes.length}
                          </span>
                          {hasCron && (
                            <span style={{ fontSize: '10px', background: 'rgba(245, 158, 11, 0.1)', padding: '3px 8px', borderRadius: '4px', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Clock size={10} /> Cron Trigger
                            </span>
                          )}
                          {hasWebhook && (
                            <span style={{ fontSize: '10px', background: 'rgba(139, 92, 246, 0.1)', padding: '3px 8px', borderRadius: '4px', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Link2 size={10} /> Webhook Trigger
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px', paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                          <button
                            onClick={() => triggerWorkflowManual(wf.id!)}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', background: 'var(--color-success)', border: 'none', borderRadius: '6px', color: 'black', fontWeight: 600, fontSize: '13px' }}
                          >
                            <Play size={14} fill="black" />
                            Trigger Manual
                          </button>
                          
                          {hasWebhook && (
                            <button
                              onClick={() => openWebhookModal(wf)}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white' }}
                              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                              onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                              title="Show Webhook URL"
                            >
                              <Link2 size={15} />
                            </button>
                          )}

                          <button
                            onClick={() => {
                              setEditingWorkflow(wf);
                              setActiveTab('builder');
                            }}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white' }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                            title="Edit Workflow"
                          >
                            <Edit3 size={15} color="var(--color-primary)" />
                          </button>

                          <button
                            onClick={() => deleteWorkflowTemplate(wf.id!, wf.name)}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white' }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                            title="Delete Workflow"
                          >
                            <Trash2 size={15} color="var(--color-error)" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'executions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={refreshExecutions}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white', fontSize: '12px' }}
                >
                  <RefreshCw size={12} />
                  Refresh List
                </button>
              </div>

              <div className="glass" style={{ borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)' }}>
                      <th style={{ padding: '16px 24px' }}>Run ID</th>
                      <th style={{ padding: '16px 24px' }}>Workflow</th>
                      <th style={{ padding: '16px 24px' }}>Status</th>
                      <th style={{ padding: '16px 24px' }}>Started At</th>
                      <th style={{ padding: '16px 24px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                          No execution logs found. Trigger a run from the workflows panel!
                        </td>
                      </tr>
                    ) : (
                      runs.map(run => (
                        <tr key={run.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: 'var(--color-primary)' }}>{run.id}</td>
                          <td style={{ padding: '16px 24px', fontWeight: 600 }}>{run.workflow?.name || run.workflowId}</td>
                          <td style={{ padding: '16px 24px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '12px', fontSize: '11px', background: run.status === 'completed' ? 'rgba(16, 185, 129, 0.1)' : run.status === 'failed' ? 'rgba(244, 63, 94, 0.1)' : 'rgba(56, 189, 248, 0.1)', color: run.status === 'completed' ? 'var(--color-success)' : run.status === 'failed' ? 'var(--color-error)' : 'var(--color-primary)' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: run.status === 'completed' ? 'var(--color-success)' : run.status === 'failed' ? 'var(--color-error)' : 'var(--color-primary)' }} />
                              {run.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '16px 24px', color: 'var(--color-text-secondary)' }}>
                            {new Date(run.startedAt).toLocaleString()}
                          </td>
                          <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                            <button
                              onClick={() => {
                                setSelectedRunId(run.id);
                                setActiveTab('monitor');
                              }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white', fontSize: '12px' }}
                            >
                              Monitor
                              <ChevronRight size={12} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'builder' && (
            <WorkflowBuilder 
              editingWorkflow={editingWorkflow} 
              onWorkflowSaved={() => {
                setEditingWorkflow(null);
                fetchWorkflows();
                setActiveTab('workflows');
              }} 
              workflows={workflows}
            />
          )}

          {activeTab === 'monitor' && selectedRunId && (
            <ExecutionMonitor 
              runId={selectedRunId} 
              onBack={() => setActiveTab('executions')} 
              onEditWorkflow={async (workflowId) => {
                try {
                  const wfData = await api.getWorkflow(workflowId);
                  setEditingWorkflow(wfData.workflow);
                  setActiveTab('builder');
                } catch (err) {
                  console.error('Failed to load workflow for editing:', err);
                  alert('Failed to load workflow.');
                }
              }}
            />
          )}
        </div>
      </div>

      {/* Webhook API Console Modal */}
      {selectedWebhookWf && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div className="glass" style={{ width: '520px', borderRadius: '8px', overflow: 'hidden', padding: '25px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ color: 'white' }}>Webhook Endpoint Guide</h3>
              <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                Workflow: {selectedWebhookWf.name}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: '1.4' }}>
                You can trigger this workflow by performing an unauthenticated HTTP POST request to the API Gateway.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Webhook Endpoint URL</label>
                <div style={{ background: 'black', padding: '10px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--color-primary)', wordBreak: 'break-all' }}>
                  POST http://localhost:3001/api/webhooks/{selectedWebhookWf.id}/{webhookNodeId}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Payload POST Body (JSON)</label>
                <textarea
                  value={webhookPayload}
                  onChange={(e) => setWebhookPayload(e.target.value)}
                  rows={5}
                  style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px 12px', color: 'white', outline: 'none', fontFamily: 'monospace', fontSize: '11px', resize: 'vertical' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button
                onClick={() => setSelectedWebhookWf(null)}
                style={{ padding: '10px 20px', background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--color-text-secondary)' }}
              >
                Close
              </button>
              
              <button
                onClick={triggerWebhookAPI}
                disabled={isTriggeringWebhook}
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: 'var(--color-primary)', border: 'none', borderRadius: '6px', color: 'black', fontWeight: 600 }}
              >
                <ExternalLink size={14} />
                {isTriggeringWebhook ? 'Sending POST...' : 'Trigger Webhook POST'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default Dashboard;
