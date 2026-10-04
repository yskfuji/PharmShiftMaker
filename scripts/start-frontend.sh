#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=${APP_ROOT:-/app}
FRONTEND_DIR=${FRONTEND_DIR:-frontend}
cd "$APP_ROOT/$FRONTEND_DIR"

if [ "${SKIP_NPM_INSTALL:-0}" != "1" ]; then
	npm install
fi

NEXT_DEV_HOST=${NEXT_DEV_HOST:-0.0.0.0}
NEXT_DEV_PORT=${NEXT_DEV_PORT:-3000}
NEXT_EXTRA_ARGS=${NEXT_EXTRA_ARGS:-}

exec npm run dev -- --hostname "$NEXT_DEV_HOST" --port "$NEXT_DEV_PORT" $NEXT_EXTRA_ARGS
