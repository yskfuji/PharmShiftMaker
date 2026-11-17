#!/bin/sh
set -eu
case "${E2E_RUN:-}" in *[!A-Za-z0-9_-]*|"") echo 'Unique E2E_RUN required' >&2; exit 2;; esac
export PHARMSHIFT_VISUAL_OUTPUT="${E2E_OUTPUT_ROOT:-/repo/audit/implementation-2026-09-23}/browser-$E2E_RUN"
mkdir "$PHARMSHIFT_VISUAL_OUTPUT"
node /repo/scripts/remediation_visual_proxy.mjs &
relay_pid=$!
trap 'kill "$relay_pid"' EXIT INT TERM
cd /repo/frontend
node node_modules/playwright/cli.js test -c playwright.remediation-linux.config.ts "$@"
