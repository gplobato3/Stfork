#!/usr/bin/env sh
# DEV ONLY: screenshot the UI-A preview with agent-browser.
#
# Usage: dev/ui-a/shot.sh < shots.txt
#   each line: <width> <height> <query-string|-> <out.png> [extra wait ms] [js to eval before the shot]
#
# Starts `python3 -m http.server 8765` (serving /projects/sandbox) in the background when it
# is not already up, takes every screenshot in one browser session, then stops the server.
set -u
mkdir -p /tmp/abhome /tmp/abrt /tmp/abprofile
export HOME=/tmp/abhome
export XDG_RUNTIME_DIR=/tmp/abrt
export AGENT_BROWSER_EXECUTABLE_PATH="${AGENT_BROWSER_EXECUTABLE_PATH:-/usr/local/bin/chrome}"
export AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage,--disable-crash-reporter,--disable-gpu-sandbox"
export AGENT_BROWSER_PROFILE=/tmp/abprofile
AB="agent-browser --session uia"

SERVER_PID=""
if ! curl -s -o /dev/null http://127.0.0.1:8765/; then
    (cd /projects/sandbox && python3 -m http.server 8765 --bind 127.0.0.1 >/tmp/hoi-ui-a-server.log 2>&1) &
    SERVER_PID=$!
    for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null http://127.0.0.1:8765/ && break; sleep 0.3; done
fi

while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    W=$(echo "$line" | awk '{print $1}')
    H=$(echo "$line" | awk '{print $2}')
    Q=$(echo "$line" | awk '{print $3}')
    OUT=$(echo "$line" | awk '{print $4}')
    EXTRA=$(echo "$line" | awk '{print $5}')
    JS=$(echo "$line" | cut -d' ' -f6-)
    [ "$Q" = "-" ] && Q=""
    [ -z "$EXTRA" ] && EXTRA=600
    $AB set viewport "$W" "$H" >/dev/null 2>&1
    $AB open "http://127.0.0.1:8765/Stfork/dev/ui-a/preview.html?$Q" >/dev/null 2>&1
    R=""
    i=0
    while [ $i -lt 80 ]; do
        R=$($AB eval "document.documentElement.dataset.ready || ''" 2>/dev/null | tr -d '"\n ')
        [ "$R" = "1" ] && break
        [ "$R" = "error" ] && break
        i=$((i+1)); sleep 0.25
    done
    if [ -n "$JS" ] && [ "$JS" != "$line" ]; then $AB eval "$JS" >/dev/null 2>&1; fi
    $AB wait "$EXTRA" >/dev/null 2>&1
    $AB screenshot "$OUT" >/dev/null 2>&1
    echo "ready=$R ${W}x${H} -> $OUT"
done

$AB errors 2>/dev/null | head -20
$AB close >/dev/null 2>&1
if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null; fi
exit 0
