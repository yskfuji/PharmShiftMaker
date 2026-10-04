#!/bin/sh
set -eu
node /repo/scripts/visual_proxy.mjs &
relay_pid=$!
trap 'kill "$relay_pid"' EXIT INT TERM
cd /repo/frontend
node node_modules/playwright/cli.js test -c playwright.completion-linux.config.ts --max-failures=1
