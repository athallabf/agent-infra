# Agent Infrastructure

Disaster-recoverable AI agent environment. If your Mac dies, clone this repo and run `./scripts/setup.sh` to restore everything.

## Quick Start

```bash
git clone git@github.com:athallabf/agent-infra.git
cd agent-infra
cp .env.example .env
# Edit .env with your OPENROUTER_API_KEY
./scripts/setup.sh
```

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  OpenCode   │────▶│  Hindsight API   │────▶│  PostgreSQL  │
│  (plugins)  │     │  :8888           │     │  (embedded)  │
└──────┬──────┘     └──────────────────┘     └──────────────┘
       │
       ▼
┌─────────────┐
│  Obsidian   │
│  Vault      │
└─────────────┘
```

## Directory Structure

```
agent-infra/
├── docker-compose.yml          # Hindsight service
├── .env.example                # API key template
├── .env                        # Your secrets (gitignored)
├── opencode/
│   ├── opencode.json           # OpenCode config (MCP + plugins)
│   ├── package.json            # Plugin dependencies
│   └── plugins/
│       ├── auto-reflect.js     # Session summaries → Obsidian
│       └── hindsight-auto-memory.js  # Auto-memory + custom tools
├── obsidian/
│   └── templates/
│       ├── Session.md          # Session log template
│       ├── Project.md          # Project doc template
│       └── Decision.md         # Decision record template
├── scripts/
│   ├── setup.sh                # Full restore (plugins + Hindsight + vault)
│   ├── watcher.sh              # Auto-commit/push daemon
│   ├── com.athl.agent-infra-watcher.plist  # launchd service
│   ├── backup.sh               # pg_dump backup
│   └── restore.sh              # Restore from backup
└── backups/                    # DB dumps (gitignored)
```

## Memory Banks

| Bank | Purpose |
|---|---|
| `agent-self` | Your preferences, coding style, agent knowledge |
| `project-kb` | Project architecture, tech stack, decisions |

## Services

| Service | URL |
|---|---|
| Hindsight API | http://localhost:8888 |
| Hindsight Control Plane | http://localhost:9999 |

## LLM Routing

| Operation | Model | Provider |
|---|---|---|
| Retain (fact extraction) | `minimax-m2.5-free` | Zen (opencode.ai/zen/v1) |
| Reflect (reasoning) | `minimax-m2.5-free` | Zen (opencode.ai/zen/v1) |
| Embeddings | `text-embedding-3-small` | OpenRouter |

## Auto-Commit

The `watcher.sh` script polls the repo every 30 seconds and auto-pushes changes to GitHub. It runs as a launchd service (`com.athl.agent-infra-watcher`) that starts on boot.

```bash
# Start manually
./scripts/watcher.sh

# Install as launchd service
./scripts/setup.sh  # includes watcher installation

# Check status
cat /tmp/agent-infra-watcher.log

# Stop
launchctl unload ~/Library/LaunchAgents/com.athl.agent-infra-watcher.plist
```

## Backup

```bash
./scripts/backup.sh    # Creates timestamped pg_dump in backups/
./scripts/restore.sh backups/hindsight_YYYYMMDD_HHMMSS.sql.gz
```

Backups are gitignored — store them separately (iCloud, external drive, or another repo).

## Mental Models

Auto-refreshing mental models in each bank:
- **User Preferences** (agent-self) — Your coding style and preferences
- **Project Architecture** (project-kb) — Tech stack and architecture decisions

These regenerate automatically after memory consolidation.
