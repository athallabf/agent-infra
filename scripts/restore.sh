#!/usr/bin/env bash
set -euo pipefail

# Restore Hindsight database from a backup file
# Usage: ./scripts/restore.sh backups/hindsight_20260331_120000.sql.gz

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-file>"
  echo ""
  echo "Available backups:"
  ls -lh "$(dirname "${BASH_SOURCE[0]}")/../backups/"*.sql.gz 2>/dev/null || echo "  No backups found"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "Restoring Hindsight database from: $BACKUP_FILE"
echo "This will REPLACE all existing data. Continue? (y/N)"
read -r confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

# Stop container, drop and recreate database, then restore
docker stop hindsight 2>/dev/null || true
docker rm hindsight 2>/dev/null || true

# Clear old data
rm -rf ~/.hindsight-docker/*

# Start fresh container
docker compose -f "$(dirname "${BASH_SOURCE[0]}")/../docker-compose.yml" up -d

# Wait for health
echo "Waiting for Hindsight to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8888/health &>/dev/null; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Hindsight failed to start"
    exit 1
  fi
  sleep 2
done

# Restore
gunzip < "$BACKUP_FILE" | docker exec -i hindsight psql -U hindsight -d hindsight

echo "Restore complete. Restarting Hindsight..."
docker restart hindsight

echo "Done."
