# Agent Infrastructure

Disaster-recovery setup for your AI agent environment. If your Mac dies, clone this repo and run `./scripts/setup.sh` to restore everything.

## What This Manages

- **Hindsight** — Long-term memory for your AI agent (Docker)
- **OpenCode Plugins** — Auto-reflect, auto-memory, MCP integration
- **Obsidian Vault Structure** — Session logs, templates, decision records

## Quick Start

```bash
git clone <repo-url> agent-infra
cd agent-infra
cp .env.example .env
# Edit .env with your OPENROUTER_API_KEY
./scripts/setup.sh
```

## Directory Structure

```
agent-infra/
├── docker-compose.yml          # Hindsight service
├── .env.example                # Template for API keys
├── opencode/
│   ├── opencode.json           # OpenCode config (MCP + plugins)
│   ├── package.json            # Plugin dependencies
│   └── plugins/
│       ├── auto-reflect.js     # Session summaries → Obsidian
│       └── hindsight-auto-memory.js  # Auto-memory + custom tools
├── obsidian/
│   └── templates/
│       ├── Session.md
│       ├── Project.md
│       └── Decision.md
├── scripts/
│   ├── setup.sh                # Full restore script
│   ├── backup.sh               # Backup Hindsight DB
│   └── restore.sh              # Restore from backup
└── backups/                    # DB backups (gitignored)
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

## Backup

```bash
./scripts/backup.sh    # Creates timestamped backup
./scripts/restore.sh backups/hindsight_YYYYMMDD_HHMMSS.sql.gz
```

## Mental Models

Auto-refreshing mental models are created in each bank:
- **User Preferences** (agent-self) — Your coding style and preferences
- **Project Architecture** (project-kb) — Tech stack and architecture decisions

These regenerate automatically after memory consolidation.
