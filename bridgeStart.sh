#!/bin/sh
# Linux Mint: run this file in a terminal, or use ./bridgeStart.sh.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
if ! command -v node >/dev/null 2>&1; then
  echo "Nova Bridge needs Node.js 22 or newer. Install Node.js, then run npm ci in $ROOT." >&2
  exit 1
fi
if [ ! -x "$ROOT/node_modules/electron/dist/electron" ]; then
  echo "Nova Bridge dependencies are missing. Run npm ci in $ROOT first." >&2
  exit 1
fi
# Electron must start as an application, even when invoked from a Node tool.
unset ELECTRON_RUN_AS_NODE
exec "$ROOT/node_modules/electron/dist/electron" "$ROOT/bridge/app" "$@"
