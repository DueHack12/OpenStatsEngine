#!/bin/bash
# Double-click this file to start StatPop on a Mac.
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Node.js is not installed - get the LTS build from https://nodejs.org"; read -n1; exit 1; fi
(sleep 1; open http://localhost:8090) &
node server.js "$@"
