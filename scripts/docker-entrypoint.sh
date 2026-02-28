#!/bin/bash
set -e

# Ensure data directories exist
mkdir -p /app/data/jobs /app/data/renders

# Start tmux server (required for job system — jobs launch in tmux sessions)
tmux start-server || true

exec "$@"
