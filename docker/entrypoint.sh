#!/bin/sh
set -eu

export NODE_ENV="${NODE_ENV:-production}"
export API_PORT="${API_PORT:-4000}"
export DATABASE_URL="${DATABASE_URL:-postgres://shearly:shearly@127.0.0.1:5432/shearly}"
export GEOCODER_URL="${GEOCODER_URL:-http://127.0.0.1:3001}"
export SMTP_URL="${SMTP_URL:-smtp://127.0.0.1:1025}"
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

node /app/api.cjs &
api_pid=$!

node /app/apps/web/server.js &
web_pid=$!

term() {
  kill "$api_pid" "$web_pid" 2>/dev/null || true
}
trap term INT TERM

# Exit if either process dies.
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done

term
wait "$api_pid" || api_status=$?
wait "$web_pid" || web_status=$?
exit "${api_status:-${web_status:-1}}"
