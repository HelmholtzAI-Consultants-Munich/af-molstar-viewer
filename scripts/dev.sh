#!/usr/bin/env bash

set -euo pipefail

frontend_pid=""
backend_pid=""

cleanup() {
  local exit_code=${1:-0}

  trap - INT TERM EXIT

  if [[ -n "${frontend_pid}" ]] && kill -0 "${frontend_pid}" 2>/dev/null; then
    kill "${frontend_pid}" 2>/dev/null || true
  fi

  if [[ -n "${backend_pid}" ]] && kill -0 "${backend_pid}" 2>/dev/null; then
    kill "${backend_pid}" 2>/dev/null || true
  fi

  if [[ -n "${frontend_pid}" ]]; then
    wait "${frontend_pid}" 2>/dev/null || true
  fi

  if [[ -n "${backend_pid}" ]]; then
    wait "${backend_pid}" 2>/dev/null || true
  fi

  exit "${exit_code}"
}

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
    cleanup 1
  fi

  if ! kill -0 "${backend_pid}" 2>/dev/null; then
    wait "${backend_pid}" || true
    cleanup 1
  fi

  sleep 1
done
