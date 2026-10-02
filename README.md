# Trying My Best (the family calendar)

A shared family calendar as an installable web app (PWA). Plain HTML/CSS/JS, no build step.
Live at https://cal.tryingmybest.org (Spaceship cPanel hosting). Backend: Supabase (login, Postgres with row-level security, scheduled reminders).

## What it does
Month / week / agenda views · per-person colors and who's-involved · repeats (daily, weekly on chosen days, every N weeks, monthly, yearly) · multi-day events · Duplicate event · "turns 36" age counting ·
time zones (everyone sees times in their own zone) · per-person reminders with web push · read-only event cards (edit is a separate, deliberate button) ·
Quick add from pasted text (+ iPhone Shortcut, see `docs/SHORTCUT.md`) · jump-to-date · 12/24-hour display · soft-delete Trash (30 days) ·
message of the day with a per-device "spicy" switch (`motd.js`: add your own lines) · invite links · daily backups.

## Files
- `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest`, `icons/` — the app. `motd.js` — messages. `quickadd.js` + `vendor/` — text-to-event reading.
- `config.js` — Supabase URL + publishable key (public by design; access is enforced by RLS).
- `schema.sql` — full database for a fresh Supabase project. `migrations/` — incremental SQL for the existing project, applied in order (001–010).
- `supabase/functions/send-reminders/` — the reminder/push function. `scripts/` — `build_zip.sh`, `backup.sh`, `backup_to_sql.py` (restore).
- `icons/` — Home Screen icons, generated from `source-puffin-transparent.webp` by `python3 scripts/make_icons.py "#1C3D54"` (any tile color).
- `secrets/` — **never committed.** VAPID keys, CRON_SECRET, backup password, and "READY" SQL/scripts with secrets filled in.

## Deploying an update
1. Bump the `?v=NN` numbers in `index.html` and the cache name in `sw.js`; bump `APP_BUILD` in `app.js` (shown in Settings → Notifications).
2. `bash scripts/build_zip.sh`, upload `calendar-deploy.zip` in cPanel File Manager, Extract over the old files.
   Check the `icons/` and `vendor/` folders arrived (a missing icon once broke notifications).
3. Fully close the app on the phone and reopen from the Home Screen icon.

## Supabase setup notes
- Run `schema.sql` on a fresh project. Existing project: run any `migrations/` not yet applied, in order.
- Auth: email + password, "Confirm email" OFF. New sign-ups can be switched off once everyone is in (re-enable to invite someone new).
- Edge function `send-reminders`: paste `index.ts`, set secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`.
  **Turn "Verify JWT" OFF, and re-check it after every redeploy** (the dashboard tends to flip it back on, which silently stops reminders).
- Reminders run from pg_cron every minute (`migrations/004_push_schedule.sql`, with the secret filled in).
- Backups: `migrations/005_backup.sql` + `secrets/005_backup_READY.sql`; `scripts/backup.sh` runs daily from a cPanel cron job
  (`bash $HOME/calendar-backup.sh > /dev/null`), keeping 60 days in `~/calendar-backups`. Restore: `scripts/backup_to_sql.py`. Test a restore occasionally.

## Ideas not built yet
Forgot-password flow · "turns 36" in push notifications (needs a function redeploy) · per-occurrence edits on repeating events · iCal feed into Apple Calendar.
