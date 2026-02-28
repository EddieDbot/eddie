#!/bin/bash
set -e

SOCKET_DIR="/run/eddie-ebpf"
SOCKET_PATH="$SOCKET_DIR/events.sock"
PIPE_PATH="$SOCKET_DIR/events.pipe"

mkdir -p "$SOCKET_DIR"
rm -f "$SOCKET_PATH" "$PIPE_PATH"
mkfifo "$PIPE_PATH"

PIDS=()

cleanup() {
  echo "supervisor: shutting down" >&2
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  rm -f "$SOCKET_PATH" "$PIPE_PATH"
  exit 0
}
trap cleanup SIGTERM SIGINT

start_program() {
  local prog="$1"
  bpftrace -f json "$prog" >> "$PIPE_PATH" 2>/dev/null &
  local pid=$!
  PIDS+=("$pid")
  echo "supervisor: started $prog (pid $pid)" >&2
}

for prog in /opt/ebpf/programs/*.bt; do
  [ -f "$prog" ] && start_program "$prog"
done

socat UNIX-LISTEN:"$SOCKET_PATH",fork,reuseaddr - < "$PIPE_PATH" &
SOCAT_PID=$!
PIDS+=("$SOCAT_PID")
echo "supervisor: socket listening at $SOCKET_PATH" >&2

# Monitor and restart crashed programs
while true; do
  sleep 30
  new_pids=()
  for pid in "${PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null && new_pids+=("$pid")
  done
  # Restart any bt programs that died
  for prog in /opt/ebpf/programs/*.bt; do
    [ -f "$prog" ] || continue
    still_running=false
    for pid in "${new_pids[@]}"; do
      kill -0 "$pid" 2>/dev/null && still_running=true && break
    done
    if ! $still_running; then
      echo "supervisor: restarting $prog" >&2
      start_program "$prog"
    fi
  done
  PIDS=("${new_pids[@]}")
done
