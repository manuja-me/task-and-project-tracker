#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"

echo "=== Preparing End-to-End Acceptance Journey ==="

# 1. Run migrations and seed database
"$PYTHON_BIN" backend/manage.py migrate --noinput
"$PYTHON_BIN" backend/manage.py seed

# 2. Build frontend production assets
npm --prefix frontend run build

# 3. Start Django server
echo "Starting Django server on http://127.0.0.1:8000..."
"$PYTHON_BIN" backend/manage.py runserver --noreload 8000 > /tmp/django_e2e.log 2>&1 &
SERVER_PID=$!

cleanup() {
  echo "Cleaning up Django server (PID: $SERVER_PID)..."
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for server to become responsive
echo "Waiting for server to respond..."
READY=0
for _ in {1..30}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Django server exited prematurely. Logs:" >&2
    cat /tmp/django_e2e.log >&2 || true
    exit 1
  fi
  if curl -fsS http://127.0.0.1:8000/api/v1/session/ > /dev/null 2>&1; then
    echo "Django server is ready!"
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "Django server failed to respond within 30s. Logs:" >&2
  cat /tmp/django_e2e.log >&2 || true
  exit 1
fi

# 4. Run Playwright E2E journey
echo "Executing Playwright tests in separate browser contexts..."
cd "$ROOT_DIR/e2e"
npx playwright test

echo "=== E2E Acceptance Journey Completed Successfully ==="
