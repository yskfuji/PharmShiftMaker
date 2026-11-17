#!/bin/sh
set -eu
case "${E2E_RUN:-}" in *[!A-Za-z0-9_-]*|"") echo 'Unique E2E_RUN required' >&2; exit 2;; esac
mkdir "/repo/audit/continuation-2026-09-22/browser-$E2E_RUN"
export PHARMSHIFT_EVIDENCE_RESERVED="$E2E_RUN"
node /repo/scripts/remediation_visual_proxy.mjs &
relay_pid=$!
trap 'kill "$relay_pid"' EXIT INT TERM
cd /repo/frontend
node node_modules/playwright/cli.js test -c playwright.continuation.config.ts "$@"
