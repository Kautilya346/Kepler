import { useState, useRef, useCallback, useEffect } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap
} from 'reactflow';
import type { Connection, Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { 
  Play, 
  Trash2, 
  Save, 
  Cpu, 
  Link2, 
  Clock, 
  AlertTriangle,
  Info,
  GitBranch,
  Layers
} from 'lucide-react';
import { api } from '../api';
import type { WorkflowDefinition } from '../api';

const initialNodes: Node[] = [
  {
    id: 'start',
    type: 'default',
    data: { label: 'Order Trigger' },
    position: { x: 250, y: 50 },
    className: 'rf-node-base rf-node-trigger',
  },
];

interface BuilderProps {
  editingWorkflow?: WorkflowDefinition | null;
  onWorkflowSaved: () => void;
  workflows: WorkflowDefinition[];
}

const WorkflowBuilderContent: React.FC<BuilderProps> = ({ editingWorkflow, onWorkflowSaved, workflows }) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  
  // Form states
  const [workflowName, setWorkflowName] = useState('My Custom Workflow');
  const [workflowDesc, setWorkflowDesc] = useState('Describe what this workflow does...');
  const [nodeLabel, setNodeLabel] = useState('');
  const [nodeCron, setNodeCron] = useState('* * * * *');
  const [nodeFail, setNodeFail] = useState(false);
  const [nodeActionType, setNodeActionType] = useState('simulated');
  const [nodeUrl, setNodeUrl] = useState('');
  const [nodeMethod, setNodeMethod] = useState('POST');
  const [nodeHeaders, setNodeHeaders] = useState('{}');
  const [nodeBody, setNodeBody] = useState('');
  const [nodeFilepath, setNodeFilepath] = useState('./storage/log.txt');
  const [nodeContent, setNodeContent] = useState('');
  const [nodePrompt, setNodePrompt] = useState('');
  const [nodeExpression, setNodeExpression] = useState('true');
  const [nodeRetryMax, setNodeRetryMax] = useState(1);
  const [nodeRetryDelay, setNodeRetryDelay] = useState(1000);
  const [nodeRetryType, setNodeRetryType] = useState<'fixed' | 'exponential'>('fixed');

  // Sub-workflow states
  const [nodeSubWorkflowId, setNodeSubWorkflowId] = useState('');
  const [nodeSubPayload, setNodeSubPayload] = useState('{}');

  // Edge editing states
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [edgeCondition, setEdgeCondition] = useState('');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Sync selection details to panel
  useEffect(() => {
    if (selectedNode) {
      setSelectedEdge(null);
      const p = selectedNode.data.parameters || {};
      const retry = selectedNode.data.retry || {};
      setNodeLabel(selectedNode.data.label || '');
      setNodeCron(p.cron || '0 * * * *');
      setNodeFail(!!p.fail);
      setNodeActionType(p.actionType || 'simulated');
      setNodeUrl(p.url || '');
      setNodeMethod(p.method || 'POST');
      setNodeHeaders(typeof p.headers === 'string' ? p.headers : JSON.stringify(p.headers || {}, null, 2));
      setNodeBody(p.body || '');
      setNodeFilepath(p.filepath || './storage/log.txt');
      setNodeContent(p.content || '');
      setNodePrompt(p.prompt || '');
      setNodeExpression(p.expression || 'true');
      setNodeRetryMax(retry.maxAttempts || 1);
      setNodeRetryDelay(retry.backoffDelay || 1000);
      setNodeRetryType(retry.backoffType || 'fixed');
      setNodeSubWorkflowId(p.subWorkflowId || '');
      setNodeSubPayload(typeof p.payload === 'string' ? p.payload : JSON.stringify(p.payload || {}, null, 2));
    } else {
      setNodeLabel('');
    }
  }, [selectedNode]);

  // Sync edge details to panel
  useEffect(() => {
    if (selectedEdge) {
      setSelectedNode(null);
      setEdgeCondition(selectedEdge.data?.condition || selectedEdge.label || '');
    }
  }, [selectedEdge]);

  // Sync editing workflow state on mount or change
  useEffect(() => {
    if (editingWorkflow) {
      setWorkflowName(editingWorkflow.name);
      setWorkflowDesc(editingWorkflow.description || '');
      
      const flowNodes: Node[] = editingWorkflow.nodes.map((n: any, idx: number) => {
        let nodeClass = 'rf-node-base rf-node-activity';
        if (n.type === 'trigger') nodeClass = 'rf-node-base rf-node-trigger';
        else if (n.type === 'webhook') nodeClass = 'rf-node-base rf-node-webhook';
        else if (n.type === 'cron') nodeClass = 'rf-node-base rf-node-cron';
        else if (n.type === 'condition') nodeClass = 'rf-node-base rf-node-condition';
        else if (n.type === 'subworkflow') nodeClass = 'rf-node-base rf-node-subworkflow';

        const position = n.position || { x: 150 + idx * 150, y: 100 + (idx % 2) * 80 };

        return {
          id: n.id,
          type: 'default',
          position,
          data: { 
            label: n.label || n.id,
            parameters: n.parameters || {},
            retry: n.retry || { maxAttempts: 1, backoffType: 'fixed', backoffDelay: 1000 }
          },
          className: nodeClass
        };
      });
      setNodes(flowNodes);

      const flowEdges: Edge[] = editingWorkflow.edges.map((e: any) => ({
        id: `edge_${e.source}_${e.target}`,
        source: e.source,
        target: e.target,
        label: e.condition || undefined,
        data: { condition: e.condition },
        animated: true
      }));
      setEdges(flowEdges);
    } else {
      setWorkflowName('My Custom Workflow');
      setWorkflowDesc('Describe what this workflow does...');
      setNodes([
        {
          id: 'start',
          type: 'default',
          data: { label: 'Order Trigger' },
          position: { x: 250, y: 50 },
          className: 'rf-node-base rf-node-trigger',
        }
      ]);
      setEdges([]);
    }
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [editingWorkflow, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!reactFlowWrapper.current || !reactFlowInstance) return;

      const type = event.dataTransfer.getData('application/reactflow');

      // check if the dropped element is valid
      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const id = `node_${Math.random().toString(36).substring(2, 9)}`;
      
      let label = 'Activity Task';
      let nodeClass = 'rf-node-base rf-node-activity';

      if (type === 'trigger') {
        label = 'Manual Trigger';
        nodeClass = 'rf-node-base rf-node-trigger';
      } else if (type === 'webhook') {
        label = 'Webhook Catch';
        nodeClass = 'rf-node-base rf-node-webhook';
      } else if (type === 'cron') {
        label = 'Cron Schedule';
        nodeClass = 'rf-node-base rf-node-cron';
      } else if (type === 'condition') {
        label = 'Condition Branch';
        nodeClass = 'rf-node-base rf-node-condition';
      } else if (type === 'subworkflow') {
        label = 'Sub-Workflow';
        nodeClass = 'rf-node-base rf-node-subworkflow';
      }

      const newNode: Node = {
        id,
        type: 'default',
        position,
        data: { 
          label,
          parameters: type === 'cron' ? { cron: '0 * * * *' } : 
                     (type === 'condition' ? { expression: 'true' } : 
                     (type === 'subworkflow' ? { subWorkflowId: '', payload: '{}' } : {})) 
        },
        className: nodeClass,
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
  }, []);

  const updateSelectedEdge = () => {
    if (!selectedEdge) return;
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id === selectedEdge.id) {
          return {
            ...e,
            label: edgeCondition || undefined,
            data: { ...e.data, condition: edgeCondition }
          };
        }
        return e;
      })
    );
    setSelectedEdge(null);
  };

  const updateSelectedNode = () => {
    if (!selectedNode) return;

    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === selectedNode.id) {
          const parameters: Record<string, any> = { ...node.data.parameters };
          
          if (selectedNode.className?.includes('rf-node-cron')) {
            parameters.cron = nodeCron;
          }
          if (selectedNode.className?.includes('rf-node-activity')) {
            parameters.actionType = nodeActionType;
            if (nodeActionType === 'simulated') {
              parameters.fail = nodeFail;
            } else if (nodeActionType === 'http') {
              parameters.url = nodeUrl;
              parameters.method = nodeMethod;
              try {
                parameters.headers = JSON.parse(nodeHeaders);
              } catch (e) {
                parameters.headers = {};
              }
              parameters.body = nodeBody;
            } else if (nodeActionType === 'file') {
              parameters.filepath = nodeFilepath;
              parameters.content = nodeContent;
            } else if (nodeActionType === 'ai_gemini') {
              parameters.prompt = nodePrompt;
            }
          }
          if (selectedNode.className?.includes('rf-node-condition')) {
            parameters.expression = nodeExpression;
          }
          if (selectedNode.className?.includes('rf-node-subworkflow')) {
            parameters.subWorkflowId = nodeSubWorkflowId;
            parameters.payload = nodeSubPayload;
          }

          const retry = {
            maxAttempts: nodeRetryMax,
            backoffType: nodeRetryType,
            backoffDelay: nodeRetryDelay
          };

          return {
            ...node,
            data: {
              ...node.data,
              label: nodeLabel,
              parameters,
              retry
            },
          };
        }
        return node;
      })
    );

    setSelectedNode(null);
    setSuccessMessage('Node configurations saved.');
    setTimeout(() => setSuccessMessage(null), 2500);
  };

  const deleteNode = () => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  };

  const saveWorkflow = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (nodes.length === 0) {
      setErrorMessage('A workflow must contain at least one node.');
      return;
    }

    // Format structure to matches our API schema
    const formattedNodes = nodes.map(n => {
      let nodeType = 'activity';
      if (n.className?.includes('rf-node-trigger')) nodeType = 'trigger';
      else if (n.className?.includes('rf-node-webhook')) nodeType = 'webhook';
      else if (n.className?.includes('rf-node-cron')) nodeType = 'cron';
      else if (n.className?.includes('rf-node-condition')) nodeType = 'condition';
      else if (n.className?.includes('rf-node-subworkflow')) nodeType = 'subworkflow';

      return {
        id: n.id,
        type: nodeType,
        position: n.position,
        label: n.data.label,
        parameters: n.data.parameters || {},
        retry: n.data.retry
      };
    });

    const formattedEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      condition: e.data?.condition || e.label || undefined
    }));

    const workflowPayload: Omit<WorkflowDefinition, 'id'> = {
      name: workflowName,
      description: workflowDesc,
      nodes: formattedNodes,
      edges: formattedEdges
    };

    try {
      if (editingWorkflow && editingWorkflow.id) {
        await api.updateWorkflow(editingWorkflow.id, workflowPayload);
        setSuccessMessage('Workflow template updated successfully!');
      } else {
        await api.createWorkflow(workflowPayload);
        setSuccessMessage('Workflow template saved successfully! Seeded in database.');
      }
      setTimeout(() => {
        onWorkflowSaved();
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.error || err.message || 'Failed to save workflow.');
    }
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', width: '100%' }}>
      {/* Sidebar - Node Palette */}
      <div className="glass" style={{ width: '260px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', borderRight: '1px solid var(--border-color)', borderLeft: 'none' }}>
        <div>
          <h3 style={{ fontSize: '15px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '15px' }}>
            Node Palette
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: '1.4', marginBottom: '20px' }}>
            Drag and drop triggers or tasks onto the canvas to construct your workflow:
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div
            className="rf-node-base rf-node-trigger"
            style={{ cursor: 'grab' }}
            onDragStart={(e) => onDragStart(e, 'trigger')}
            draggable
          >
            <Play size={15} color="#3b82f6" />
            <div>
              <div style={{ fontWeight: 600 }}>Manual Trigger</div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Instantiate manually</div>
            </div>
          </div>

          <div
            className="rf-node-base rf-node-webhook"
            style={{ cursor: 'grab' }}
            onDragStart={(e) => onDragStart(e, 'webhook')}
            draggable
          >
            <Link2 size={15} color="#8b5cf6" />
            <div>
              <div style={{ fontWeight: 600 }}>Webhook Catch</div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Trigger via POST</div>
            </div>
          </div>

          <div
            className="rf-node-base rf-node-cron"
            style={{ cursor: 'grab' }}
            onDragStart={(e) => onDragStart(e, 'cron')}
            draggable
          >
            <Clock size={15} color="#f59e0b" />
            <div>
              <div style={{ fontWeight: 600 }}>Cron Schedule</div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Repeatable timer</div>
            </div>
          </div>

          <div
            className="rf-node-base rf-node-activity"
            style={{ cursor: 'grab' }}
            onDragStart={(e) => onDragStart(e, 'activity')}
            draggable
          >
            <Cpu size={15} color="#10b981" />
            <div>
              <div style={{ fontWeight: 600 }}>Activity Task</div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Execute background activity</div>
            </div>
          </div>

          <div
            className="rf-node-base rf-node-condition"
            style={{ cursor: 'grab' }}
            onDragStart={(e) => onDragStart(e, 'condition')}
            draggable
          >
            <GitBranch size={15} color="#ec4899" />
            <div>
              <div style={{ fontWeight: 600 }}>Condition Branch</div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Evaluate logic expression</div>
            </div>
          </div>

          <div
            className="rf-node-base rf-node-subworkflow"
            style={{ cursor: 'grab' }}
            onDragStart={(e) => onDragStart(e, 'subworkflow')}
            draggable
          >
            <Layers size={15} color="#a855f7" />
            <div>
              <div style={{ fontWeight: 600 }}>Sub-Workflow</div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Execute reusable workflow</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 'auto', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px', fontSize: '11px', color: 'var(--color-text-secondary)', display: 'flex', gap: '8px' }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>Connect nodes by dragging handles. Rejections for cycles run on save.</span>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {/* Top Info Bar */}
        <div className="glass" style={{ padding: '15px 25px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', borderTop: 'none', borderRight: 'none', borderLeft: 'none' }}>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flex: 1 }}>
            {editingWorkflow && (
              <span style={{ fontSize: '11px', color: 'var(--color-primary)', background: 'rgba(138, 180, 248, 0.1)', padding: '4px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                ID: {editingWorkflow.id}
              </span>
            )}
            <input
              type="text"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              style={{ background: 'transparent', border: 'none', borderBottom: '1px solid transparent', color: 'white', fontSize: '18px', fontWeight: 700, outline: 'none', width: '240px', transition: 'border-color 0.2s' }}
              placeholder="Workflow Name"
              onFocus={(e) => e.target.style.borderBottomColor = 'var(--color-primary)'}
              onBlur={(e) => e.target.style.borderBottomColor = 'transparent'}
            />
            <input
              type="text"
              value={workflowDesc}
              onChange={(e) => setWorkflowDesc(e.target.value)}
              style={{ background: 'transparent', border: 'none', borderBottom: '1px solid transparent', color: 'var(--color-text-secondary)', fontSize: '13px', outline: 'none', flex: 1 }}
              placeholder="Workflow Description"
              onFocus={(e) => e.target.style.borderBottomColor = 'rgba(255,255,255,0.2)'}
              onBlur={(e) => e.target.style.borderBottomColor = 'transparent'}
            />
          </div>

          <button
            onClick={saveWorkflow}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', background: 'var(--color-primary)', border: 'none', borderRadius: '6px', color: 'black', fontWeight: 600, transition: 'background 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.background = 'var(--color-primary-hover)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'var(--color-primary)'}
          >
            <Save size={16} />
            {editingWorkflow ? 'Update Workflow' : 'Save Workflow'}
          </button>
        </div>

        {/* Message Notifications */}
        {errorMessage && (
          <div className="glass" style={{ position: 'absolute', top: '75px', left: '20px', zIndex: 100, padding: '12px 18px', borderLeft: '4px solid var(--color-error)', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '4px', fontSize: '13px', maxWidth: '400px' }}>
            <AlertTriangle size={18} color="var(--color-error)" />
            <span style={{ color: 'var(--color-error)' }}>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="celebrate-toast" style={{ position: 'absolute', top: '75px', left: '20px', zIndex: 100, bottom: 'auto', right: 'auto' }}>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Canvas Wrap */}
        <div ref={reactFlowWrapper} style={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={() => {
              setSelectedNode(null);
              setSelectedEdge(null);
            }}
            fitView
          >
            <Controls style={{ background: '#121622', border: '1px solid var(--border-color)', color: 'white' }} />
            <MiniMap style={{ background: '#121622', border: '1px solid var(--border-color)' }} maskColor="rgba(0, 0, 0, 0.4)" />
            <Background color="rgba(255, 255, 255, 0.05)" gap={16} />
          </ReactFlow>
        </div>
      </div>

      {/* Right Sidebar - Node Properties configuration */}
      {selectedNode && (
        <div className="glass" style={{ width: '280px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', borderLeft: '1px solid var(--border-color)', borderRight: 'none' }}>
          <div>
            <h3 style={{ fontSize: '15px', color: 'white', marginBottom: '8px' }}>Node Editor</h3>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: '4px' }}>
              ID: {selectedNode.id}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Node Label</label>
              <input
                type="text"
                value={nodeLabel}
                onChange={(e) => setNodeLabel(e.target.value)}
                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px 12px', color: 'white', outline: 'none' }}
              />
            </div>

            {/* Render Cron Node configurations */}
            {selectedNode.className?.includes('rf-node-cron') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Cron Schedule Pattern</label>
                <input
                  type="text"
                  value={nodeCron}
                  onChange={(e) => setNodeCron(e.target.value)}
                  placeholder="*/5 * * * *"
                  style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px 12px', color: 'white', outline: 'none', fontFamily: 'monospace' }}
                />
                <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Standard cron expression (5 fields).</span>
              </div>
            )}

            {/* Render Webhook Node info */}
            {selectedNode.className?.includes('rf-node-webhook') && (
              <div style={{ background: 'rgba(139, 92, 246, 0.05)', padding: '10px', borderRadius: '4px', border: '1px dashed rgba(139, 92, 246, 0.3)', width: '100%', boxSizing: 'border-box' }}>
                <label style={{ fontSize: '10px', color: '#8b5cf6', textTransform: 'uppercase', fontWeight: 600 }}>Webhook Trigger Url</label>
                <div style={{ fontSize: '10px', wordBreak: 'break-all', fontFamily: 'monospace', color: 'var(--color-text-secondary)', marginTop: '5px', background: 'black', padding: '6px', borderRadius: '2px' }}>
                  POST http://localhost:3001/api/webhooks/{editingWorkflow?.id || 'WORKFLOW_ID'}/{selectedNode.id}
                </div>
              </div>
            )}

            {/* Render Condition Node configurations */}
            {selectedNode.className?.includes('rf-node-condition') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Boolean Expression</label>
                <input
                  type="text"
                  value={nodeExpression}
                  onChange={(e) => setNodeExpression(e.target.value)}
                  placeholder="{{previous_node_id}} === 'success'"
                  style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px 12px', color: 'white', outline: 'none', fontFamily: 'monospace' }}
                />
                <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Substitute completed node outputs with {"{{node_id}}"}. Evaluates as standard Javascript.</span>
              </div>
            )}

            {/* Render Sub-Workflow configurations */}
            {selectedNode.className?.includes('rf-node-subworkflow') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Select Sub-Workflow</label>
                  <select
                    value={nodeSubWorkflowId}
                    onChange={(e) => setNodeSubWorkflowId(e.target.value)}
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px 12px', color: 'white', outline: 'none' }}
                  >
                    <option value="">-- Choose Reusable Workflow --</option>
                    {workflows
                      .filter(wf => wf.id !== editingWorkflow?.id) // Prevent self-referencing cycle loops
                      .map(wf => (
                        <option key={wf.id} value={wf.id}>{wf.name} ({wf.id})</option>
                      ))
                    }
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Input Payload Template</label>
                  <textarea
                    value={nodeSubPayload}
                    onChange={(e) => setNodeSubPayload(e.target.value)}
                    rows={4}
                    placeholder='{"input": "{{previous_node_id}}"}'
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px 12px', color: 'white', outline: 'none', fontFamily: 'monospace', fontSize: '11px' }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Provide a template string or JSON object. Supports output replacements via {"{{node_id}}"}.</span>
                </div>
              </div>
            )}

            {/* Render Activity Node configurations */}
            {selectedNode.className?.includes('rf-node-activity') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Action Type</label>
                  <select
                    value={nodeActionType}
                    onChange={(e) => setNodeActionType(e.target.value)}
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px 12px', color: 'white', outline: 'none' }}
                  >
                    <option value="simulated">General Delay (Simulated)</option>
                    <option value="http">HTTP Integration</option>
                    <option value="file">File Write / Backup</option>
                    <option value="ai_gemini">Gemini LLM Prompt</option>
                  </select>
                </div>

                {nodeActionType === 'simulated' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                    <input
                      type="checkbox"
                      id="nodeFail"
                      checked={nodeFail}
                      onChange={(e) => setNodeFail(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <label htmlFor="nodeFail" style={{ fontSize: '12px', color: 'var(--color-text)', cursor: 'pointer' }}>Simulate Task Failure</label>
                  </div>
                )}

                {nodeActionType === 'http' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Target URL</label>
                      <input
                        type="text"
                        value={nodeUrl}
                        onChange={(e) => setNodeUrl(e.target.value)}
                        placeholder="https://httpbin.org/post"
                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontSize: '12px' }}
                      />
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>HTTP Method</label>
                      <select
                        value={nodeMethod}
                        onChange={(e) => setNodeMethod(e.target.value)}
                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontSize: '12px' }}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Headers (JSON)</label>
                      <textarea
                        value={nodeHeaders}
                        onChange={(e) => setNodeHeaders(e.target.value)}
                        rows={2}
                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontFamily: 'monospace', fontSize: '11px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Body Template</label>
                      <textarea
                        value={nodeBody}
                        onChange={(e) => setNodeBody(e.target.value)}
                        rows={3}
                        placeholder='{"message": "Hello from T-Clone!"}'
                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontFamily: 'monospace', fontSize: '11px' }}
                      />
                    </div>
                  </div>
                )}

                {nodeActionType === 'file' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>File Path</label>
                      <input
                        type="text"
                        value={nodeFilepath}
                        onChange={(e) => setNodeFilepath(e.target.value)}
                        placeholder="./storage/welcome.txt"
                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontSize: '12px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Content Template</label>
                      <textarea
                        value={nodeContent}
                        onChange={(e) => setNodeContent(e.target.value)}
                        rows={4}
                        placeholder="Hello, here is the result: {{previous_node_id}}"
                        style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontSize: '11px' }}
                      />
                    </div>
                  </div>
                )}

                {nodeActionType === 'ai_gemini' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>AI Prompt Template</label>
                    <textarea
                      value={nodePrompt}
                      onChange={(e) => setNodePrompt(e.target.value)}
                      rows={5}
                      placeholder="Translate this to French: {{input_node}}"
                      style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontSize: '11px' }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Render Retry Config for activities and conditions */}
            {(selectedNode.className?.includes('rf-node-activity') || selectedNode.className?.includes('rf-node-condition')) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px', borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
                <label style={{ fontSize: '11px', color: 'var(--color-primary)', textTransform: 'uppercase', fontWeight: 600 }}>Retry Policy</label>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Max Retry Attempts</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={nodeRetryMax}
                    onChange={(e) => setNodeRetryMax(parseInt(e.target.value, 10) || 1)}
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontSize: '12px' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Backoff Type</label>
                  <select
                    value={nodeRetryType}
                    onChange={(e) => setNodeRetryType(e.target.value as any)}
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontSize: '12px' }}
                  >
                    <option value="fixed">Fixed Delay</option>
                    <option value="exponential">Exponential Backoff</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Base Delay (ms)</label>
                  <input
                    type="number"
                    min={0}
                    value={nodeRetryDelay}
                    onChange={(e) => setNodeRetryDelay(parseInt(e.target.value, 10) || 0)}
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', outline: 'none', fontSize: '12px' }}
                  />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: 'auto' }}>
            <button
              onClick={deleteNode}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px', background: '#ef444422', border: '1px solid #ef444433', borderRadius: '6px', color: '#f87171', fontWeight: 600 }}
              onMouseOver={(e) => e.currentTarget.style.background = '#ef444433'}
              onMouseOut={(e) => e.currentTarget.style.background = '#ef444422'}
            >
              <Trash2 size={14} />
              Delete Node
            </button>
            <button
              onClick={updateSelectedNode}
              style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white', fontWeight: 600 }}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            >
              Update
            </button>
          </div>
        </div>
      )}

      {/* Right Sidebar - Edge Properties configuration */}
      {selectedEdge && (
        <div className="glass" style={{ width: '280px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', borderLeft: '1px solid var(--border-color)', borderRight: 'none' }}>
          <div>
            <h3 style={{ fontSize: '15px', color: 'white', marginBottom: '8px' }}>Edge Editor</h3>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: '4px' }}>
              Branch Connection
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Routing Condition</label>
              <select
                value={edgeCondition}
                onChange={(e) => setEdgeCondition(e.target.value)}
                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '8px 12px', color: 'white', outline: 'none' }}
              >
                <option value="">Unconditional (Default)</option>
                <option value="true">True Path</option>
                <option value="false">False Path</option>
              </select>
              <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                For outgoing edges from a Condition Branch node. Determines if the workflow follows this path based on evaluation.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: 'auto' }}>
            <button
              onClick={() => {
                setEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
                setSelectedEdge(null);
              }}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px', background: '#ef444422', border: '1px solid #ef444433', borderRadius: '6px', color: '#f87171', fontWeight: 600 }}
              onMouseOver={(e) => e.currentTarget.style.background = '#ef444433'}
              onMouseOut={(e) => e.currentTarget.style.background = '#ef444422'}
            >
              <Trash2 size={14} />
              Delete Edge
            </button>
            <button
              onClick={updateSelectedEdge}
              style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'white', fontWeight: 600 }}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            >
              Update Edge
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const WorkflowBuilder: React.FC<BuilderProps> = ({ editingWorkflow, onWorkflowSaved, workflows }) => {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderContent editingWorkflow={editingWorkflow} onWorkflowSaved={onWorkflowSaved} workflows={workflows} />
    </ReactFlowProvider>
  );
};
