#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_PORT="${GRIMOIRE_GAME_PORT:-8786}"
FOREGROUND=0 PERSISTENT=0 SKIP_SETUP=0
for argument in "$@"; do
  case "$argument" in
    --foreground) FOREGROUND=1 ;;
    --persistent) PERSISTENT=1 ;;
    --skip-setup) SKIP_SETUP=1 ;;
    *) echo "Unknown argument: $argument" >&2; exit 2 ;;
  esac
done

((SKIP_SETUP)) || "$ROOT/setup.sh"
NODE=""
for candidate in "$ROOT"/vendor/node-v22*-linux-*/bin/node; do
  if [[ -x "$candidate" ]]; then NODE="$candidate"; break; fi
done
[[ -n "$NODE" ]] || NODE="$(command -v node)"

STATE="$ROOT/var/grimoire-host.json"
if [[ -f "$STATE" ]] && "$NODE" -e 'const s=require(process.argv[1]);try{process.kill(s.supervisorPid,0);process.exit(0)}catch{process.exit(1)}' "$STATE"; then
  echo "Grimoire is already running. Open http://localhost:5173"
  exit 0
fi
rm -f "$STATE"
mkdir -p "$ROOT/var/logs"
((PERSISTENT)) && export GRIMOIRE_AUTO_SHUTDOWN=0

if ((FOREGROUND)); then
  exec "$NODE" "$ROOT/tools/host/supervisor.mjs" "$ROOT"
fi

nohup "$NODE" "$ROOT/tools/host/supervisor.mjs" "$ROOT" \
  >"$ROOT/var/logs/supervisor.log" 2>"$ROOT/var/logs/supervisor.error.log" </dev/null &
SUPERVISOR_PID=$!
for _ in {1..120}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:$GAME_PORT/health" >/dev/null 2>&1 && \
     curl -fsS --max-time 2 http://127.0.0.1:5173 >/dev/null 2>&1; then
    ADDRESS="$(hostname -I 2>/dev/null | awk '{print $1}')"
    echo "Grimoire is running in the background."
    echo "Local:  http://localhost:5173"
    [[ -n "$ADDRESS" ]] && echo "Remote: http://$ADDRESS:5173"
    ((PERSISTENT)) && echo "Persistent mode enabled; use ./stop.sh to stop it."
    exit 0
  fi
  kill -0 "$SUPERVISOR_PID" 2>/dev/null || break
  sleep 1
done
echo "Grimoire failed to start. See var/logs/supervisor.error.log" >&2
tail -n 20 "$ROOT/var/logs/supervisor.error.log" >&2 || true
exit 1
