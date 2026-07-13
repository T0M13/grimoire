#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE=""
for candidate in "$ROOT"/vendor/node-v22*-linux-*/bin/node; do
  if [[ -x "$candidate" ]]; then NODE="$candidate"; break; fi
done
[[ -n "$NODE" ]] || NODE="$(command -v node)"
exec "$NODE" "$ROOT/tools/host/stop.mjs" "$ROOT"
