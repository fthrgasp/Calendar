#!/bin/bash
# Deploys both Supabase edge functions with "Verify JWT" OFF (see supabase/config.toml).
# One-time setup: install the Supabase CLI (macOS: brew install supabase/tap/supabase), then run `supabase login`.
# Run from the project folder:  bash scripts/deploy_functions.sh
# Function secrets (VAPID keys, CRON_SECRET) live in Supabase and aren't touched by this.
set -euo pipefail
cd "$(dirname "$0")/.."
for fn in send-reminders calendar-feed; do
  supabase functions deploy "$fn" --project-ref aaejevsvmmhrmykozzic --no-verify-jwt
done
echo "Deployed. In Supabase > Edge Functions, both should show Verify JWT: off."
