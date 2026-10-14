#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$ROOT/.runtime"
mkdir -p "$RUNTIME"

export PORT="${PORT:-10101}"

echo "Starting AllocateAntivirus backend on port ${PORT}..."
(cd "$ROOT/backend" && go run .) >"$RUNTIME/backend.log" 2>&1 &
echo $! >"$RUNTIME/backend.pid"

echo "Starting AllocateAntivirus frontend on port 3000..."
(cd "$ROOT/frontend" && npm run dev -- --host 0.0.0.0) >"$RUNTIME/frontend.log" 2>&1 &
echo $! >"$RUNTIME/frontend.pid"

echo
echo "Frontend: http://localhost:3000/AllocateAntivirus/"
echo "Backend : http://localhost:${PORT}"
echo "Use stop-linux.sh to stop both services."
