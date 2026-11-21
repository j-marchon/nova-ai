#!/bin/sh
# Checks the Gemini app route against your own Google account, start to finish:
# gets your Google sign-in from your own browser (a Google sign-in already in
# Firefox is used as it is; otherwise Chrome / Edge / Brave opens for you to sign
# in), runs bridge/tools/probe-gemini-web.mjs with those cookies, then deletes them.
# Needs only Node.js 22 or newer. Extra arguments go to the probe, e.g.
#   ./geminiProbe.sh --models <hash> --long 200000
# Choose the browser:  ./geminiProbe.sh --browser firefox   (or chromium)
# Forget the saved browser sign-in afterwards:  ./geminiProbe.sh --forget
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is needed and was not found. Install it (https://nodejs.org), then run this again." >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then
  echo "Node.js is too old: Nova needs version 22 or newer." >&2
  exit 1
fi

if [ "${1:-}" = "--forget" ]; then
  exec node gemini-cookies-cli.mjs --forget
fi

# --browser <x> belongs to the cookie step, everything else to the probe
BROWSER=""
if [ "${1:-}" = "--browser" ]; then BROWSER="${2:-}"; shift 2 || shift; fi

JAR=$(mktemp "${TMPDIR:-/tmp}/nova-gemini-cookies.XXXXXX")
trap 'rm -f "$JAR"' EXIT INT TERM
echo
node gemini-cookies-cli.mjs --out "$JAR" ${BROWSER:+--browser "$BROWSER"} || { echo "Could not get a Google sign-in." >&2; exit 1; }

echo
CODE=0
node probe-gemini-web.mjs --cookies-file "$JAR" --delete "$@" || CODE=$?
echo
echo "Done (exit code $CODE). The folder named above holds your session: delete it when finished."
exit "$CODE"
