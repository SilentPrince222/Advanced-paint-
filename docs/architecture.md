# H0 Visual Automation Builder — Architecture

## System Architecture

```mermaid
flowchart TB
    subgraph Browser["Browser (Client)"]
        RF["React Flow Canvas<br/>@xyflow/react"]
        ZS["Zustand v5 Store"]
        UI["shadcn/ui + Tailwind v4"]
        RF <--> ZS
        ZS <--> UI
    end

    subgraph Vercel["Vercel (Next.js 16 / App Router / React 19)"]
        subgraph API["API Route Handlers"]
            FLOWS["/api/flows — CRUD"]
            COMMIT["/api/commit — snapshot"]
            ROLLBACK["/api/rollback"]
            BRANCHES["/api/branches"]
            RUN["/api/run — execute flow"]
            EXECLOG["/api/exec-log — audit trail"]
            DIFF["/api/diff — compare snapshots"]
        end
        INTERP["Interpreter<br/>(BFS walk of node graph)"]
        MOCK["Mock / Real Action Executor"]
    end

    subgraph Aurora["Aurora PostgreSQL 17.7<br/>Serverless v2 (us-east-1)"]
        TABLES["flow | branch | node | edge<br/>node_view | commit | exec_log"]
    end

    subgraph Lambda["AWS Lambda (optional)"]
        CE["Consequence Engine<br/>(irreversible Stripe actions)"]
    end

    Browser -- "HTTPS" --> Vercel
    API -- "pg + SSL" --> Aurora
    RUN --> INTERP
    INTERP --> MOCK
    MOCK -- "if irreversible" --> Lambda
    MOCK -- "commit snapshot + append exec_log" --> Aurora
```

## Run Execution Flow

```mermaid
sequenceDiagram
    participant C as Canvas (Browser)
    participant S as Zustand Store
    participant A as API /run
    participant I as Interpreter (BFS)
    participant E as Action Executor
    participant DB as Aurora PostgreSQL

    C->>S: User clicks "Run"
    S->>A: POST /api/run {flowId, branchId}
    A->>DB: Save current graph state
    A->>I: Start BFS walk from trigger node
    loop Each node in topological order
        I->>E: Execute node action
        E-->>I: Result / side-effect
    end
    I->>DB: INSERT commit (graph_snapshot JSONB)
    I->>DB: INSERT exec_log (append-only)
    Note over DB: exec_log: REVOKE UPDATE/DELETE + trigger
    I-->>A: Execution result
    A-->>S: Response with commit hash
    S-->>C: Update canvas status
```

## Version Control Model

```mermaid
flowchart LR
    subgraph VersionControl["Git-like Version Control"]
        B1["branch: main"]
        B2["branch: experiment-A"]

        C1["commit #1<br/>graph_snapshot JSONB"]
        C2["commit #2<br/>graph_snapshot JSONB"]
        C3["commit #3<br/>graph_snapshot JSONB"]
        C4["commit #4 (fork)<br/>graph_snapshot JSONB"]

        B1 --> C1
        C1 --> C2
        C2 --> C3

        B2 --> C2
        C2 --> C4
    end

    subgraph DualWrite["Dual-Write Strategy"]
        SNAP["Snapshot<br/>(commit.graph_snapshot)"]
        LIVE["Live Tables<br/>(node, edge, node_view)"]
    end

    C3 -- "on commit" --> SNAP
    C3 -- "on commit" --> LIVE

    subgraph Honesty["Honesty Thesis"]
        EL["exec_log<br/>(append-only)"]
        REV["DB-level REVOKE<br/>UPDATE / DELETE"]
        TRG["Trigger rejects<br/>mutations"]
    end

    SNAP -.-> EL
    EL --- REV
    EL --- TRG
```

## Database Schema (ER Diagram)

```mermaid
erDiagram
    flow {
        uuid id PK
        text name
        text description
        timestamptz created_at
        timestamptz updated_at
    }

    branch {
        uuid id PK
        uuid flow_id FK
        text name
        uuid head_commit_id FK
        boolean is_default
        timestamptz created_at
    }

    commit {
        uuid id PK
        uuid branch_id FK
        uuid parent_id FK
        jsonb graph_snapshot
        text message
        timestamptz created_at
    }

    node {
        uuid id PK
        uuid flow_id FK
        text type
        jsonb data
        float position_x
        float position_y
    }

    edge {
        uuid id PK
        uuid flow_id FK
        uuid source_node_id FK
        uuid target_node_id FK
        text source_handle
        text target_handle
    }

    node_view {
        uuid id PK
        uuid node_id FK
        uuid branch_id FK
        jsonb view_data
    }

    exec_log {
        uuid id PK
        uuid flow_id FK
        uuid commit_id FK
        uuid node_id FK
        text action
        jsonb input
        jsonb output
        text status
        timestamptz executed_at
    }

    flow ||--o{ branch : "has branches"
    flow ||--o{ node : "contains"
    flow ||--o{ edge : "contains"
    flow ||--o{ exec_log : "audit trail"
    branch ||--o{ commit : "commit chain"
    branch ||--o{ node_view : "view per branch"
    commit ||--o| commit : "parent"
    commit ||--o{ exec_log : "produced by"
    node ||--o{ edge : "source"
    node ||--o{ edge : "target"
    node ||--o{ node_view : "visual state"
    node ||--o{ exec_log : "executed"
```

---

**Key architectural decisions:**

- **Append-only exec_log** enforces the honesty thesis at the database level — no UPDATE or DELETE is permitted (enforced via PostgreSQL REVOKE and a reject-mutation trigger).
- **Dual-write on commit** stores both a self-contained JSONB snapshot (for instant rollback/diff) and updates live tables (for fast querying and canvas rendering).
- **BFS interpreter** walks the directed graph from trigger nodes, enabling deterministic replay and step-by-step debugging.
- **Branch model** mirrors git: cheap branching for experimentation, with a head pointer per branch referencing the latest commit.
