#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PORT="${PORT:-10101}"
export APP_ROOT="$ROOT"
export FRONTEND_DIR="$ROOT/frontend/dist"
export UPLOAD_DIR="$ROOT/uploads/imgs"
export CORS_ORIGIN="${CORS_ORIGIN:-*}"

echo "Open http://localhost:${PORT}/AllocateAntivirus/"
cd "$ROOT"
exec "$ROOT/allocate-antivirus-backend"
