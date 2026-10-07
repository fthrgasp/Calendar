#!/bin/bash
# Builds calendar-deploy.zip: exactly the files the website needs (no SQL, no secrets, no docs).
# Run from the project folder:  bash scripts/build_zip.sh
# Before a release: bump the ?v=NN numbers in index.html (and the cache name in sw.js) so phones pick up changes.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -f calendar-deploy.zip
zip -q -r calendar-deploy.zip index.html app.js config.js motd.js quickadd.js style.css sw.js manifest.webmanifest \
  icons/icon-180.png icons/icon-192.png icons/icon-512.png vendor/chrono-2.5.0.js vendor/chrono-LICENSE.txt vendor/supabase-js-2.117.2.js vendor/supabase-js-LICENSE.txt
unzip -l calendar-deploy.zip | tail -1
