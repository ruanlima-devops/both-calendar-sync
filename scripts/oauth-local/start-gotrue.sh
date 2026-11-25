#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/scripts/oauth-local/.env.gotrue"
BIN="$ROOT/.tools/gotrue/auth"
LOG="/tmp/both-gotrue.log"
PIDFILE="/tmp/both-gotrue.pid"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE" >&2
  exit 1
fi
if [[ ! -x "$BIN" ]]; then
  echo "missing binary $BIN" >&2
  exit 1
fi

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PIDFILE")"
  exit 0
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

cd "$ROOT/.tools/gotrue"
nohup "$BIN" >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
sleep 1
if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "failed to start" >&2
  tail -30 "$LOG" >&2
  exit 1
fi
echo "started pid=$(cat "$PIDFILE") log=$LOG"
