#!/usr/bin/env bash
set -e

echo "=== Preparing End-to-End Acceptance Journey ==="

# 1. Run migrations and seed database
.venv/bin/python backend/manage.py migrate --noinput
.venv/bin/python backend/manage.py seed

# 2. Build frontend production assets
npm --prefix frontend run build

# 3. Start Django server
echo "Starting Django server on http://127.0.0.1:8000..."
.venv/bin/python backend/manage.py runserver 8000 > /tmp/django_e2e.log 2>&1 &
SERVER_PID=$!

cleanup() {
  echo "Cleaning up Django server (PID: $SERVER_PID)..."
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for server to become responsive
echo "Waiting for server to respond..."
for i in {1..30}; do
  if curl -s http://127.0.0.1:8000/api/v1/session/ > /dev/null 2>&1; then
    echo "Django server is ready!"
    break
  fi
  sleep 1
done

# 4. Run Playwright E2E journey
echo "Executing Playwright tests in separate browser contexts..."
cd e2e
npx playwright test

echo "=== E2E Acceptance Journey Completed Successfully ==="
