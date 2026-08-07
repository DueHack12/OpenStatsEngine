#!/bin/bash
# Double-click this file in Finder to start OpenStatsEngine on macOS.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed."
  echo "  Download the LTS installer from https://nodejs.org and run it, then"
  echo "  double-click this file again."
  echo ""
  read -r -p "  Press Return to close."
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 18 ]; then
  echo "  Node $(node -v) is too old — OpenStatsEngine needs Node 18 or newer."
  read -r -p "  Press Return to close."
  exit 1
fi

echo "Starting OpenStatsEngine…"
node server.js "$@"
echo ""
read -r -p "Server stopped. Press Return to close this window."
