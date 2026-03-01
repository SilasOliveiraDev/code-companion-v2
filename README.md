# Code Companion v2 — AI Software Engineer Agent

An autonomous AI engineering agent that plans, builds, and improves software projects inside a full development workspace.

## Overview

Code Companion v2 implements the AI Software Engineer Agent PRD. It provides a complete development environment where an AI engineer collaborates with you to build software efficiently, safely, and with high quality standards.

## Architecture

```
code-companion-v2/
├── backend/              # Node.js + Express + TypeScript
│   └── src/
│       ├── agent/        # AI orchestrator (planner + executor)
│       ├── mcp/          # MCP tool architecture
│       │   └── tools/    # create_repo, write_files, deploy_preview, run_migrations, connect_supabase
│       ├── integrations/ # Git, Supabase, deployment
│       ├── workspace/    # File system operations
│       └── routes/       # REST API (agent, workspace, git)
└── frontend/             # React + TypeScript + Vite + Tailwind
    └── src/
        ├── components/
        │   ├── chat/     # AI chat with mode selector + plan approval
        │   ├── editor/   # Monaco code editor
        │   ├── explorer/ # File tree explorer
        │   ├── git/      # Git status + commits
        │   ├── preview/  # Live preview panel
        │   ├── terminal/ # Terminal emulator
        │   └── layout/   # Workspace layout with resizable panels
        ├── store/        # Zustand state management
        └── services/     # API client
```

## Features

### Three Execution Modes (PRD §5)
| Mode | Behavior |
|------|----------|
| **ASK** | Answers questions without changing code |
| **PLAN** | Proposes a structured plan, awaits approval |
| **AGENT** | Executes tasks autonomously with tools |

Default mode is **PLAN** for safety.

### MCP Tool Architecture (PRD §6)
Tools executed via the Tool Router → MCP Server pipeline:

- `create_repo` — Initialize a git repository with scaffold
- `write_files` — Create or update multiple files atomically
- `deploy_preview` — Deploy to a preview environment
- `run_migrations` — Execute SQL migrations against Supabase
- `connect_supabase` — Configure Supabase auth, realtime, and database

### Workspace (PRD §4)
- **Repository Explorer** — File tree with expand/collapse
- **Code Editor** — Monaco Editor with syntax highlighting, auto-save
- **Preview Panel** — Embedded iframe with URL navigation
- **Terminal** — Pseudo-terminal (real PTY via WebSocket in production)
- **Git Panel** — Status, staged changes, commit log, branch management
- **Resizable Panels** — Drag-to-resize all workspace areas

### Execution Planning (PRD §3.2)
Plans include:
- Goal statement
- Impacted files list
- Architecture decisions with rationale
- Ordered implementation steps with action types
- Validation method

Users can **Approve**, **Reject**, or request plan modifications.

### Safety Rules (PRD §10)
- Secrets never exposed in output
- Sensitive operations require explicit approval
- Path traversal protection in file system service
- Production config changes blocked without confirmation

## Prerequisites

- Node.js 20+
- npm 10+
- An Anthropic API key

## Getting Started

```bash
# Clone and set up environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Install dependencies
npm run install:all

# Start both backend and frontend
npm run dev
```

The workspace will be available at `http://localhost:5173`.

## Docker

```bash
docker-compose up --build
```

## API Reference

### Agent Sessions
```
POST   /api/agent/sessions              Create session
GET    /api/agent/sessions/:id          Get session
POST   /api/agent/sessions/:id/message  Send message (SSE stream)
POST   /api/agent/sessions/:id/plan/approve
POST   /api/agent/sessions/:id/plan/reject
PATCH  /api/agent/sessions/:id/mode    Change mode (ASK/PLAN/AGENT)
```

### Workspace
```
GET    /api/workspace/files    List file tree
GET    /api/workspace/file     Read file
PUT    /api/workspace/file     Write file
DELETE /api/workspace/file     Delete file
POST   /api/workspace/search   Search files
POST   /api/workspace/directory Create directory
```

### Git
```
GET  /api/git/status    Git status
GET  /api/git/log       Commit log
GET  /api/git/branches  Branch list
POST /api/git/branch    Create branch
POST /api/git/checkout  Checkout branch
POST /api/git/stage     Stage files
POST /api/git/commit    Commit changes
GET  /api/git/diff      Get diff
```

## Tech Stack

**Backend:** Node.js, Express, TypeScript, Anthropic SDK, simple-git, Socket.IO

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Monaco Editor, Zustand, react-resizable-panels

**AI Model:** claude-sonnet-4-6 (planning, execution, Q&A)
