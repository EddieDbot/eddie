#!/usr/bin/env bash
set -euo pipefail

# EDDIE Daily Backup — restic + rclone → Google Drive
# Runs via systemd timer at 3 AM daily

EDDIE_DIR="/home/na/eddie"
BRAIN_VAULT="/home/na/brain-vault"
BACKUP_REPO="${HOME}/backups/eddie-restic"
RCLONE_REMOTE="gdrive:eddie-backups"
LOG_FILE="${EDDIE_DIR}/data/backup.log"
LOCK_FILE="/tmp/eddie-backup.lock"
RESTIC_PASSWORD_FILE="${HOME}/.config/eddie/backup-password"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  log "ERROR: Another backup is running ($LOCK_FILE)"
  exit 1
fi
trap 'rm -f "$LOCK_FILE"' EXIT
touch "$LOCK_FILE"

log "=== EDDIE backup start ==="

# Init repo if needed
if ! restic --password-file "$RESTIC_PASSWORD_FILE" --repo "$BACKUP_REPO" snapshots &>/dev/null; then
  log "Initializing restic repo at $BACKUP_REPO"
  mkdir -p "$BACKUP_REPO"
  restic --password-file "$RESTIC_PASSWORD_FILE" --repo "$BACKUP_REPO" init
fi

# Backup Brain Vault
log "Backing up Brain Vault..."
restic --password-file "$RESTIC_PASSWORD_FILE" --repo "$BACKUP_REPO" \
  backup "$BRAIN_VAULT" \
  --exclude "*.DS_Store" --exclude ".trash" \
  --tag "brain-vault"

# Backup EDDIE (code + config, skip deps and job artifacts)
log "Backing up EDDIE project..."
restic --password-file "$RESTIC_PASSWORD_FILE" --repo "$BACKUP_REPO" \
  backup "$EDDIE_DIR" \
  --exclude "${EDDIE_DIR}/node_modules" \
  --exclude "${EDDIE_DIR}/.git" \
  --exclude "${EDDIE_DIR}/data/jobs" \
  --tag "eddie-code"

# Prune: keep 7 daily, 4 weekly, 3 monthly
log "Pruning old snapshots..."
restic --password-file "$RESTIC_PASSWORD_FILE" --repo "$BACKUP_REPO" \
  forget --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune

# Sync to Google Drive if configured
if rclone listremotes 2>/dev/null | grep -q "^gdrive:"; then
  log "Syncing to Google Drive..."
  rclone sync "$BACKUP_REPO" "$RCLONE_REMOTE" --transfers 4 \
    --log-level INFO --log-file "$LOG_FILE" \
    || log "WARNING: rclone sync failed (local backup still complete)"
else
  log "SKIP: gdrive: remote not configured — run 'rclone config' to set up"
fi

log "=== EDDIE backup complete ==="
