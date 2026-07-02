# T-Clone: Durable Workflow Orchestration Engine

T-Clone is a production-grade, durable workflow orchestration platform designed to run fault-tolerant background execution pipelines. Inspired by the core architectures of **Temporal**, it features a visual designer, real-time WebSocket telemetry monitoring, per-node retry loops, conditional branching, parent-child sub-workflows, and deterministic state reconstruction via Event Sourcing.

---

## 🏛️ 1. Technical Stack & Infrastructure
* **Execution & Server Runtimes**: Node.js v20+ with TypeScript compiled to CommonJS modules.
* **API Gateway & Routing**: Express.js with custom rate-limiting middleware, CORS configurations, JWT Authentication handshakes, and unauthenticated public endpoints.
* **WebSocket Streams**: Native Node.js `ws` server upgrading standard HTTP handshakes to secure JSON telemetry broadcasts.
* **Durable Database Persistence**: PostgreSQL database (running on port `5432` under Database `T-Clone`) + Prisma ORM v7 client wrapper.
* **Durable Task Queuing & Timing**: Redis (port `6379`, running in a Docker container `redis-server`) + **BullMQ** for distributed queues, delayed job re-queuing, and repeatable cron jobs.
* **Frontend Visual Dashboard**: Vite + React Flow canvas designer + custom Google I/O Dark Theme Vanilla CSS (`#131314` charcoal background, `#1e1f20` surface panels, `#3c4043` borders).

---

## 📁 2. Directory Structure & Code Layout

```text
T-Clone/
├── Backend/
│   ├── api-gateway/            # Express Gateway Service
│   │   ├── prisma/             # Schema definitions & migrations
│   │   │   └── schema.prisma   # PostgreSQL database schema models
│   │   ├── src/
│   │   │   ├── middleware/     # JWT Auth verification, rate limits
│   │   │   ├── routes/         # workflow, runs, and webhook routers
│   │   │   ├── schemas/        # Zod DAG schema & cycle validation
│   │   │   ├── services/       # engine.ts (core scheduler & replays)
│   │   │   ├── config.ts       # Central config file
│   │   │   └── index.ts        # Server gateway bootstrap & WS server upgrade
│   │   ├── package.json
│   │   └── prisma.config.ts    # Prisma v7 environment connector
│   │
│   └── workers/                # BullMQ Activity Worker Service
│       ├── src/
│       │   ├── db.ts           # Postgres DB client instance
│       │   ├── index.ts        # Task routing dispatcher & handlers
│       │   └── types.d.ts
│       ├── storage/            # Disk storage logs folder
│       ├── package.json
│       └── prisma.config.ts
│
├── Frontend/                   # Vite React Application
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.tsx        # Workflows & run list tables
│   │   │   ├── WorkflowBuilder.tsx   # React Flow drag-and-drop editor
│   │   │   └── ExecutionMonitor.tsx  # WebSocket live nodes & audit logs
│   │   ├── App.tsx             # Handshake & Developer Token check
│   │   ├── api.ts              # REST client & WebSocket connectors
│   │   ├── index.css           # Google I/O Dark Theme variables
│   │   └── main.tsx            # React entry
│   ├── index.html              # Custom page titles & meta descriptions
│   └── package.json
│
└── scratch/                    # Verification E2E scripts
    ├── client-test.js          # Base WebSocket & cycle test script
    ├── test-custom-workers.js  # Worker action-integration E2E test script
    ├── test-conditional-retries.js # Retry & branching E2E test script
    └── test-pause-subworkflow.js # Pause/Resume & Sub-Workflows E2E test script
```

---

## 🗄️ 3. Database Schema Definitions (`schema.prisma`)

T-Clone implements event sourcing by persisting workflow definitions, execution run instances, and immutable event logs in PostgreSQL:

```prisma
model Workflow {
  id          String   @id @default(uuid())
  name        String
  description String?
  definition  Json     // Holds nodes: Node[] and edges: Edge[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  runs        Run[]
}

model Run {
  id          String    @id
  workflowId  String
  status      String    // "running" | "completed" | "failed" | "paused" | "cancelled"
  nodesState  Json      // Record<string, "pending" | "running" | "completed" | "failed" | "skipped">
  startedAt   DateTime  @default(now())
  completedAt DateTime?
  workflow    Workflow  @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  events      Event[]
}

model Event {
  id        String   @id @default(uuid())
  runId     String
  type      String   // "run_started" | "node_started" | "node_completed" | "node_failed" | "run_completed" ...
  nodeId    String?  // Associated Node ID (optional for run events)
  message   String   // Text logs or serialized results (e.g. "Result: Simulated execution complete.")
  timestamp DateTime @default(now())
  run       Run      @relation(fields: [runId], references: [id], onDelete: Cascade)
}
```

---

## 🎛️ 4. API Gateway Endpoints (REST API Specification)

All private routes require a `Bearer <Developer JWT Token>` in the `Authorization` header.

### 4.1 Workflow Templates Management
* **`GET /api/workflows`**: Lists all workflow templates seeded in PostgreSQL.
* **`POST /api/workflows`**: Creates a new workflow template. Executes Zod schema checks and directed acyclic graph (DAG) cycle checks before saving.
* **`GET /api/workflows/:id`**: Fetches the layout nodes, edges, parameters, and metadata of a workflow.
* **`PUT /api/workflows/:id`**: Updates an existing workflow template definition in the database.
* **`DELETE /api/workflows/:id`**: Deletes a workflow template along with all its runs and historical event sourcing logs (onDelete: Cascade).

### 4.2 Workflow Executions Control
* **`POST /api/workflows/:id/run`**: Triggers a manual workflow run. Instantiates a database run record, creates a `'run_started'` event, and enqueues root nodes to BullMQ.
* **`GET /api/workflows/runs`**: Returns all execution logs sorted by start time (`desc`) for tabular display.
* **`GET /api/workflows/runs/:id`**: Returns the complete database record and event history list for a run.
* **`GET /api/workflows/runs/:id/replay`**: Dynamically reconstructs execution states (status, nodesState) from the event log to confirm state consistency.

### 4.3 Execution State Transitions
* **`POST /api/workflows/runs/:id/pause`**: Transitions an active run to `"paused"` status, logs `'run_paused'`, and broadcasts the update.
* **`POST /api/workflows/runs/:id/resume`**: Transitions a paused run back to `"running"` status, logs `'run_resumed'`, and resumes processing.
* **`POST /api/workflows/runs/:id/cancel`**: Sets run status to `"cancelled"`, stamps `completedAt` to halt downstream workers immediately, and logs `'run_cancelled'`.

### 4.4 Webhook Trigger Entry (Public Endpoints)
* **`POST /api/webhooks/:workflowId/:nodeId`**: Unauthenticated entry for webhook trigger nodes.
  - Returns **`404 Not Found`** if the target node does not exist in the workflow.
  - Returns **`400 Bad Request`** if the node exists but is not of type `"webhook"`.
  - Otherwise, parses the JSON body payload, creates the run, logs `'webhook_triggered'`, and enqueues the child nodes.

---

## 📡 5. WebSocket Telemetry Protocol

The API Gateway routes WebSocket upgrade requests (`/api/runs/:runId/live`) to establish a real-time event pipeline:
1. **Auth Handshake:** Browsers pass JWT credentials via the query string `?token=<JWT>` (due to HTTP header constraints on default WebSockets).
2. **Channel Subscription:** If valid, the gateway subscribes the connection to a Redis Pub/Sub channel matching the template: `run:${runId}:events`.
3. **Real-time Broadcasts:** When workers update databases or write events, they publish JSON payloads to the channel. The gateway catches and relays them:
   ```json
   {
     "type": "event",
     "event": {
       "timestamp": "2026-06-30T17:42:11.842Z",
       "type": "node_completed",
       "nodeId": "node_3qng6zv",
       "message": "Node \"node_3qng6zv\" completed. Result: {\"status\":\"ok\"}"
     },
     "runStatus": "running",
     "nodesState": {
       "node_3qng6zv": "completed",
       "node_5sm4o6c": "running"
     }
   }
   ```

---

## 👷 6. Worker Service Action Dispatch Engine

Workers run as standalone, stateless processes pulling from BullMQ.

### 6.1 Worker Action Types
* **`simulated`**: General latency simulator using `setTimeout` (resolves in 1200ms, or throws errors if `fail` is checked).
* **`http`**: Executes outbound `fetch` API requests mapping request headers, HTTP methods, and body payloads.
* **`file`**: Writes text values to physical disk files under `./storage/`, resolving filepath templates and automatically creating parent directory structures.
* **`ai_gemini`**: Calls Google’s Gemini API model (`gemini-2.5-flash:generateContent`) returning generated text (falls back to mock structures if api keys are missing).
* **`condition`**: Evaluates custom JavaScript string expressions via `new Function()`.
* **`subworkflow`**: Instantiates child runs named `run_sub::${parentRunId}::${parentNodeId}::${randomSuffix}` and resumes the parent node execution once the sub-workflow completes.

### 6.2 Variable Substitution Parser
Prior to node execution, the worker fetches all past completed events for the run, resolves output strings, and substitutes placeholder templates:
```typescript
// Replace variable markers {{node_id}} inside templates
let prompt = node.parameters?.prompt || '';
for (const [prevNodeId, val] of Object.entries(outputs)) {
  prompt = prompt.replace(new RegExp(`{{${prevNodeId}}}`, 'g'), val);
}
```

### 6.3 State Control Execution Checks
* **Pause States Loop:** If a worker picks up a node job and the run status is `'paused'`, it skips execution, schedules the job back into BullMQ with a delay parameter, and returns:
  ```typescript
  await activityQueue.add(`job_${runId}_${nodeId}`, jobData, { delay: 2000 });
  ```
* **Cancellation Aborts:** If the status is `'cancelled'`, the worker discards the job immediately and returns without executing the task or scheduling children.
* **Downstream Skip Check:** If the status is terminal (cancelled, completed, failed), `resolveAndQueueDownstream` terminates, preventing child nodes from scheduling.

### 6.4 Retry Policy Calculations (Exponential Backoff)
If an activity throws an exception, the worker checks the node's retry policies:
* **Fixed Delay:** Retries execute using the same Base Delay: $\text{Delay} = \text{Base Delay}$.
* **Exponential Backoff:** Retries double the sleep duration for every failed attempt: 
  $$\text{Delay} = \text{Base Delay} \times 2^{\text{Attempt} - 1}$$
* If attempts are less than `maxAttempts`, the worker logs a failure event and adds the job back to BullMQ with a `{ delay }` parameter. Otherwise, it marks the node `'failed'` and propagates the failure downstream.

### 6.5 DAG Joins & Cascade Skipped States
* **Join Nodes:** A child node with multiple parent connections is scheduled only if **all parent nodes are terminal** (completed, failed, or skipped).
* **Skipped State Propagation:** If parents resolve but the active execution paths bypass a branch (e.g. condition edge mismatch), the child is marked `'skipped'` in the database, writing a `'node_skipped'` event log. This skip status propagates recursively to all downstream child nodes.

---

## 🎨 7. Frontend Console Dashboard UI/UX

* **Workflows List Panel:** Displays all registered templates in a grid layout. Clicking card buttons triggers manual executions, opens webhook details modals, opens the designer, or deletes templates. A prominent **"New Workflow"** button sits at the top-right header.
* **Sticky Layout Design:** Pinned sidebar navigation to `height: '100vh'`, `position: 'sticky'`, and `top: 0` ensures navigation controls never scroll off-screen, keeping the "New Workflow" sidebar button permanently visible.
* **React Flow Visual Canvas:** Drag nodes (triggers, webhooks, crons, activities, conditions, sub-workflows) and connect handles to create edges. Clicking edges opens the Edge Editor sidebar panel to bind routing conditions (`True Path`, `False Path`, or `Unconditional`).
* **Interactive Live monitor:** Visualizes active runs. Node borders glow in real time corresponding to state transitions (Blue: trigger, Purple: webhook, Green: completed, Yellow: cron, Red: failed, Orange: running/paused).
* **Execution Control Toolbar:** Displays Pause/Resume and Cancel buttons inside the monitor. Includes a direct **"Edit Workflow"** shortcut jump to load the template into the designer.
* **Audit Event Replay:** A split console pane reconstructing state directly from raw SQL events, validating engine execution correctness against database records.

---

## 🧪 8. E2E Verification Test Suites

T-Clone includes comprehensive automated E2E test scripts inside `/scratch`:
1. **`client-test.js`**: Registers workflows, triggers manual executions, connects to the WebSocket stream, and verifies cycle-rejection rules.
2. **`test-custom-workers.js`**: Validates pipeline integrations (File logs, HTTP triggers, Gemini AI prompts) and asserts variable substitutions.
3. **`test-conditional-retries.js`**: Asserts condition expression matching, skipped status cascades, and exponential retry backoff loops.
4. **`test-pause-subworkflow.js`**: Triggers executions, pauses them mid-run, asserts tasks remain pending, resumes runs, and triggers parent-child sub-workflow executions.
