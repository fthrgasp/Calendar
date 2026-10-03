#!/bin/bash
# Runs every check. Usage:  bash tests/run.sh            (logic tests only)
#                           ICS_VENV=/path/to/venv bash tests/run.sh   (also verifies the calendar feed; see tests/README.md)
set -u -o pipefail; cd "$(dirname "$0")/.."; status=0
for t in calendar reminders motd; do echo "== $t"; node "tests/$t.test.js" | tail -3 || status=1; done
for f in app.js sw.js quickadd.js motd.js; do node --check "$f" || status=1; done; echo "== syntax: ok"
if [ -n "${ICS_VENV:-}" ]; then echo "== feed"; node tests/feed/generate.js | "$ICS_VENV/bin/python" tests/feed/verify.py | tail -4 || status=1; else echo "== feed: skipped (set ICS_VENV to run it)"; fi
[ $status -eq 0 ] && echo "ALL GOOD" || echo "SOMETHING FAILED"; exit $status
