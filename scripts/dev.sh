#!/usr/bin/env bash

set -euo pipefail

# Job control puts each background child in its own process group, so cleanup
# can take down its whole tree: uvicorn's reloader spawns a worker that
# outlives a plain kill of the parent and then squats the backend port.
set -m

export BACKEND_PORT="${BACKEND_PORT:-8000}"

frontend_pid=""
backend_pid=""

kill_tree() {
  local pid=$1
  local attempt

  # Signal the group, not the pid: the job leader (npm, uv) exits before the
  # server it spawned, so the port stays held by a child whose leader is gone.
  kill -- -"${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true

  for attempt in 1 2 3 4 5 6; do
    kill -0 -- -"${pid}" 2>/dev/null || return 0
    sleep 0.5
  done

  kill -KILL -- -"${pid}" 2>/dev/null || true
}

cleanup() {
  local exit_code=${1:-0}

  trap - INT TERM EXIT

  if [[ -n "${frontend_pid}" ]]; then
    kill_tree "${frontend_pid}"
  fi

  if [[ -n "${backend_pid}" ]]; then
    kill_tree "${backend_pid}"
  fi

  if [[ -n "${frontend_pid}" ]]; then
    wait "${frontend_pid}" 2>/dev/null || true
  fi

  if [[ -n "${backend_pid}" ]]; then
    wait "${backend_pid}" 2>/dev/null || true
  fi

  exit "${exit_code}"
}

# Refuse to start a frontend that would proxy /api to whatever else owns the
# port: that server answers with its own errors and the app just shows
# "Project unavailable".
if lsof -nP -iTCP:"${BACKEND_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  printf '\n  Backend port %s is already in use:\n\n' "${BACKEND_PORT}" >&2
  lsof -nP -iTCP:"${BACKEND_PORT}" -sTCP:LISTEN >&2
  printf '\n  Stop that process, or run on another port:\n\n    BACKEND_PORT=%s make dev\n\n' "$((BACKEND_PORT + 1))" >&2
  exit 1
fi

trap 'cleanup 130' INT
trap 'cleanup 143' TERM
trap 'cleanup $?' EXIT

(cd frontend && VITE_PROJECT_API_MODE=http npm run dev) &
frontend_pid=$!

(cd backend && uv run backend) &
backend_pid=$!

while true; do
  if ! kill -0 "${frontend_pid}" 2>/dev/null; then
    wait "${frontend_pid}" || true
    printf '\n  Frontend exited; shutting down the backend too.\n\n' >&2
    cleanup 1
  fi

  if ! kill -0 "${backend_pid}" 2>/dev/null; then
    wait "${backend_pid}" || true
    printf '\n  Backend exited; shutting down the frontend too (see the backend error above).\n\n' >&2
    cleanup 1
  fi

  sleep 1
done
