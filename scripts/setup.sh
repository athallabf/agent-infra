#!/usr/bin/env bash
set -euo pipefail

# Agent Infrastructure Setup Script
# Restores OpenCode plugins, Hindsight, and Obsidian vault structure
# Run on a new machine to get everything working again.

echo "=== Agent Infrastructure Setup ==="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
check_prereq() {
  if ! command -v "$1" &>/dev/null; then
    error "$1 is not installed. Please install it first."
    exit 1
  fi
  info "$1 found"
}

check_prereq docker
check_prereq git

# ── Configuration ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCODE_DIR="$HOME/.config/opencode"
OBSIDIAN_VAULT_DIR="$HOME/Obsidian/Vaults/AI-Base"

echo ""
echo "── Step 1: OpenCode Plugins ──"

mkdir -p "$OPENCODE_DIR/plugins"

# Copy plugins from repo
for plugin in "$SCRIPT_DIR/opencode/plugins/"*.js; do
  [ -f "$plugin" ] || continue
  basename="$(basename "$plugin")"
  cp "$plugin" "$OPENCODE_DIR/plugins/$basename"
  info "Installed plugin: $basename"
done

# Create opencode.json if it doesn't exist
if [ ! -f "$OPENCODE_DIR/opencode.json" ]; then
  cp "$SCRIPT_DIR/opencode/opencode.json" "$OPENCODE_DIR/opencode.json"
  info "Created opencode.json"
else
  # Merge MCP config into existing opencode.json
  info "opencode.json exists — merging MCP config..."
  python3 -c "
import json, sys

with open('$OPENCODE_DIR/opencode.json') as f:
    config = json.load(f)

mcp = {
    'hindsight-agent': {
        'type': 'remote',
        'url': 'http://localhost:8888/mcp/agent-self/',
        'enabled': True,
        'timeout': 30000
    },
    'hindsight-project': {
        'type': 'remote',
        'url': 'http://localhost:8888/mcp/project-kb/',
        'enabled': True,
        'timeout': 30000
    }
}

config.setdefault('mcp', {}).update(mcp)

# Add plugin if not present
plugin_ref = './plugins/hindsight-auto-memory.js'
config.setdefault('plugin', [])
if plugin_ref not in config['plugin']:
    config['plugin'].append(plugin_ref)

with open('$OPENCODE_DIR/opencode.json', 'w') as f:
    json.dump(config, f, indent=2)
"
  info "Merged MCP and plugin config"
fi

echo ""
echo "── Step 2: Hindsight ──"

# Check for .env file
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  error ".env file not found. Copy .env.example to .env and fill in your API key."
  echo "  cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env"
  echo "  # Edit .env with your OPENROUTER_API_KEY"
  exit 1
fi

# Start Hindsight
cd "$SCRIPT_DIR"
docker compose up -d
info "Hindsight container started"

# Wait for health
echo "Waiting for Hindsight to become healthy..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8888/health &>/dev/null; then
    info "Hindsight is healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    error "Hindsight failed to start. Check logs: docker logs hindsight"
    exit 1
  fi
  sleep 2
done

echo ""
echo "── Step 3: Memory Banks ──"

# Create banks if they don't exist
for bank in "agent-self:Agent Self-Improvement:You are an AI engineer agent. Remember coding preferences, architecture decisions, debugging solutions, tool configurations, and development patterns." \
            "project-kb:Project Knowledge Base:Remember project architecture, tech stack decisions, codebase structure, deployment configurations, and development workflows."; do
  IFS=':' read -r id name mission <<< "$bank"
  if ! curl -sf "http://localhost:8888/v1/default/banks/$id" &>/dev/null; then
    curl -s -X PUT "http://localhost:8888/v1/default/banks/$id" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$name\",\"mission\":\"$mission\"}" >/dev/null
    info "Created bank: $id"
  else
    info "Bank exists: $id"
  fi
done

echo ""
echo "── Step 4: Obsidian Vault Structure ──"

mkdir -p "$OBSIDIAN_VAULT_DIR"/{Sessions,Templates,Projects,Decisions,Learnings}
info "Created vault directories"

# Create templates if they don't exist
for tmpl in Session Project Decision; do
  if [ ! -f "$OBSIDIAN_VAULT_DIR/Templates/$tmpl.md" ]; then
    cp "$SCRIPT_DIR/obsidian/templates/$tmpl.md" "$OBSIDIAN_VAULT_DIR/Templates/$tmpl.md" 2>/dev/null || true
  fi
done
info "Templates installed"

# Create index if missing
if [ ! -f "$OBSIDIAN_VAULT_DIR/AI-Log-Index.md" ]; then
  cat > "$OBSIDIAN_VAULT_DIR/AI-Log-Index.md" << 'EOF'
# AI Reflection Log

Daily index for AI decision logs, failures, and learnings.

## Recent Logs

EOF
  info "Created AI-Log-Index.md"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Services:"
echo "  Hindsight API:    http://localhost:8888"
echo "  Hindsight UI:     http://localhost:9999"
echo ""
echo "Memory Banks:"
echo "  agent-self:       Your preferences, coding style, agent knowledge"
echo "  project-kb:       Project architecture, tech stack, decisions"
echo ""
echo "Obsidian Vault:     $OBSIDIAN_VAULT_DIR"
echo ""
echo "To backup Hindsight data:"
echo "  ./scripts/backup.sh"
echo ""
echo "To restore from backup:"
echo "  ./scripts/restore.sh <backup-file>"
