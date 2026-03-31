#!/usr/bin/env bash
# Auto-commit and push changes to agent-infra repo
# Watches for file changes, commits with descriptive message, and pushes to GitHub
# Designed to run as a background daemon via launchd

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="/tmp/agent-infra-watcher.lock"
LOG_FILE="/tmp/agent-infra-watcher.log"
POLL_INTERVAL=30  # Check every 30 seconds

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }

# Prevent duplicate instances
if [ -f "$LOCK_FILE" ]; then
  PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$PID" 2>/dev/null; then
    log "Watcher already running (PID: $PID)"
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log "Watcher started (PID: $$, repo: $REPO_DIR)"

cd "$REPO_DIR"

# Store current state
get_state() {
  git status --porcelain 2>/dev/null | wc -l | tr -d ' '
}

LAST_STATE=$(get_state)

while true; do
  sleep "$POLL_INTERVAL"
  
  CURRENT_STATE=$(get_state)
  
  if [ "$CURRENT_STATE" != "$LAST_STATE" ]; then
    log "Changes detected ($CURRENT_STATE files modified)"
    
    # Add all changes
    git add -A
    
    # Check if there's actually something to commit
    if ! git diff --cached --quiet 2>/dev/null; then
      # Count changes
      ADDED=$(git diff --cached --diff-filter=A --name-only | wc -l | tr -d ' ')
      MODIFIED=$(git diff --cached --diff-filter=M --name-only | wc -l | tr -d ' ')
      DELETED=$(git diff --cached --diff-filter=D --name-only | wc -l | tr -d ' ')
      
      # Build commit message
      MSG="auto: "
      [ "$ADDED" -gt 0 ] && MSG+="$ADDED added "
      [ "$MODIFIED" -gt 0 ] && MSG+="$MODIFIED modified "
      [ "$DELETED" -gt 0 ] && MSG+="$DELETED deleted "
      MSG+="($(date '+%Y-%m-%d %H:%M'))"
      
      # Commit and push
      if git commit -m "$MSG" 2>/dev/null; then
        log "Committed: $MSG"
        
        if git push origin main 2>/dev/null; then
          log "Pushed to GitHub"
        else
          log "Push failed, will retry next cycle"
        fi
      else
        log "Commit failed (possibly no changes or conflict)"
      fi
    fi
    
    LAST_STATE=$(get_state)
  fi
done
