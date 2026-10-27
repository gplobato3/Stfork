#!/bin/bash
# dev/ui-b/shot.sh — screenshot helper for the UI-B preview harness (dev only).
#
# Usage: dev/ui-b/shot.sh "<query>|<width>|<height>|<out.png>|[js to eval]|[page]" ...
#   page defaults to preview.html (also: st-shell.html)
#
# Serves the workspace root (/projects/sandbox by default, override with
# HOI_SERVE_ROOT) with `python3 -m http.server 8766` for the duration of the
# call and drives the `agent-browser` CLI. Override the browser binary with
# AGENT_BROWSER_EXECUTABLE_PATH and the writable state dirs with HOI_SHOT_TMP.
TMPBASE=${HOI_SHOT_TMP:-/tmp/uib}
export HOME="$TMPBASE/home" XDG_RUNTIME_DIR="$TMPBASE/xdg" AGENT_BROWSER_SESSION=${AGENT_BROWSER_SESSION:-uib}
export AGENT_BROWSER_EXECUTABLE_PATH=${AGENT_BROWSER_EXECUTABLE_PATH:-/inner_container/opt/playwright/chromium-1232/chrome-linux64/chrome}
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
ROOT=${HOI_SERVE_ROOT:-/projects/sandbox}
cd "$ROOT" || exit 1
python3 -m http.server 8766 --bind 127.0.0.1 >"$TMPBASE/http.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for _ in $(seq 1 30); do
  curl -s -o /dev/null http://127.0.0.1:8766/ && break
  sleep 0.2
done
for spec in "$@"; do
  IFS='|' read -r query w h out js page <<< "$spec"
  page=${page:-preview.html}
  agent-browser set viewport "$w" "$h" >/dev/null 2>&1
  agent-browser open "http://127.0.0.1:8766/Stfork/dev/ui-b/${page}?${query}" >/dev/null 2>&1
  sleep 1.2
  if [ -n "$js" ]; then agent-browser eval "$js" 2>&1 | tail -3; sleep 0.7; fi
  agent-browser screenshot "$out" >/dev/null 2>&1 && echo "shot $out"
  agent-browser errors 2>&1 | grep -v '^$' | tail -5
done
agent-browser console 2>&1 | grep -i 'error\|fail' | grep -v 'warroom.css\|map.css' | tail -8
# Fresh browser (and HTTP cache) for every run, so edited modules are never stale.
agent-browser close >/dev/null 2>&1
