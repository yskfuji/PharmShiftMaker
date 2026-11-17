#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=${APP_ROOT:-/app}
cd "$APP_ROOT"

if [ "${SKIP_PIP_INSTALL:-0}" != "1" ]; then
  if [ -f requirements.txt ]; then
    pip install --no-cache-dir --upgrade pip
    pip install --no-cache-dir -r requirements.txt
  fi

  if [ -f pyproject.toml ]; then
    pip install --no-cache-dir -e .
  fi
fi

UVICORN_HOST=${API_HOST:-0.0.0.0}
UVICORN_PORT=${API_PORT:-8000}
RELOAD_FLAG=${UVICORN_RELOAD:-true}
UVICORN_SSL_CERTFILE=${UVICORN_SSL_CERTFILE:-}
UVICORN_SSL_KEYFILE=${UVICORN_SSL_KEYFILE:-}

EXTRA_ARGS=()
if [ "$RELOAD_FLAG" = "true" ]; then
  EXTRA_ARGS+=("--reload")
fi

if [ -n "$UVICORN_SSL_CERTFILE" ] && [ -n "$UVICORN_SSL_KEYFILE" ]; then
  EXTRA_ARGS+=("--ssl-certfile" "$UVICORN_SSL_CERTFILE" "--ssl-keyfile" "$UVICORN_SSL_KEYFILE")
  if [ -n "${UVICORN_SSL_KEYFILE_PASSWORD:-}" ]; then
    EXTRA_ARGS+=("--ssl-keyfile-password" "$UVICORN_SSL_KEYFILE_PASSWORD")
  fi
fi

exec uvicorn shift_scheduler.api.main:app --host "$UVICORN_HOST" --port "$UVICORN_PORT" "${EXTRA_ARGS[@]}"
