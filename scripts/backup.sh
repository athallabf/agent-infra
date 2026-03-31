#!/usr/bin/env bash
set -euo pipefail

# Backup Hindsight PostgreSQL data
# Creates a timestamped dump that can be restored with restore.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/hindsight_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Backing up Hindsight database..."

# Use docker exec to run pg_dump inside the container
docker exec hindsight pg_dump -U hindsight -d hindsight | gzip > "$BACKUP_FILE"

if [ -f "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "Backup complete: $BACKUP_FILE ($SIZE)"
  
  # Keep only last 10 backups
  ls -t "$BACKUP_DIR"/hindsight_*.sql.gz | tail -n +11 | xargs rm -f 2>/dev/null || true
  echo "Kept last 10 backups"
else
  echo "ERROR: Backup failed"
  exit 1
fi
