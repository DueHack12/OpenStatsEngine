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

# A git checkout can update itself. Ask, and start anyway after 15 seconds so a
# machine left unattended before a game still comes up on the version it had.
if [ -d .git ] && command -v git >/dev/null 2>&1 && git fetch --quiet 2>/dev/null; then
  BEHIND=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
  if [ "$BEHIND" -gt 0 ]; then
    echo ""
    echo "  An update is available ($BEHIND new commit(s))."
    read -r -t 15 -p "  Update now? [y/N] " ANSWER
    echo ""
    if [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ]; then
      git pull --ff-only || echo "  Update failed — starting the current version."
    fi
  fi
fi

echo "Starting OpenStatsEngine…"
node server.js "$@"
echo ""
read -r -p "Server stopped. Press Return to close this window."
