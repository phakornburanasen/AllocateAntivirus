#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/dist/linux"

echo "Building frontend..."
cd "$ROOT/frontend"
if [[ ! -d node_modules ]]; then
  npm install
fi
npm run build

echo "Building Linux backend executable..."
cd "$ROOT/backend"
mkdir -p "$OUT"
go build -ldflags "-s -w" -o "$OUT/allocate-antivirus-backend" .

echo "Copying frontend dist..."
rm -rf "$OUT/frontend/dist"
mkdir -p "$OUT/frontend"
cp -R "$ROOT/frontend/dist" "$OUT/frontend/dist"
mkdir -p "$OUT/uploads/imgs"

cat > "$OUT/start-production.sh" <<'SCRIPT'
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
SCRIPT
chmod +x "$OUT/start-production.sh"

echo
echo "Build complete:"
echo "$OUT/allocate-antivirus-backend"
echo "$OUT/start-production.sh"
