#!/bin/bash
# Daily backup of the family calendar. Upload to the hosting account's home folder (NOT public_html),
# set the BACKUP_SECRET below, chmod 700, and run it from a cPanel cron job. Prints only on failure when cron output is discarded.
set -u
URL="${CAL_URL:-https://aaejevsvmmhrmykozzic.supabase.co}"
KEY="sb_publishable_VkcdrcQTzFMj-kxdRlkm9w_oLDAAFc4"
SECRET="${CAL_SECRET:-__BACKUP_SECRET__}"
DIR="${CAL_DIR:-$HOME/calendar-backups}"
KEEP_DAYS=60

mkdir -p "$DIR" && chmod 700 "$DIR"
STAMP=$(date +%Y-%m-%d_%H%M)
TMP="$DIR/.incoming.$$"

curl -sS --fail --max-time 60 -X POST "$URL/rest/v1/rpc/backup_export" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"secret\":\"$SECRET\"}" -o "$TMP" \
  || { echo "BACKUP FAILED: could not fetch the export" >&2; rm -f "$TMP"; exit 1; }

# Only keep it if it looks like a real export (an error message would also come back as "success").
if ! grep -q '"events"' "$TMP" || ! grep -q '"exported_at"' "$TMP"; then
  echo "BACKUP FAILED: unexpected response: $(head -c 300 "$TMP")" >&2
  rm -f "$TMP"; exit 1
fi

mv "$TMP" "$DIR/calendar-$STAMP.json" && chmod 600 "$DIR/calendar-$STAMP.json"
find "$DIR" -name 'calendar-*.json' -mtime +$KEEP_DAYS -delete
echo "backup ok: calendar-$STAMP.json ($(wc -c < "$DIR/calendar-$STAMP.json") bytes)"
