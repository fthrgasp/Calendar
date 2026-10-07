chrono-2.5.0.js: chrono-node 2.5.0 browser bundle (https://github.com/wanasit/chrono), MIT license (see chrono-LICENSE.txt).
Used by Quick add to read dates and times from text. Served from this site; loaded only when Quick add is first used.
supabase-js-2.117.2.js: @supabase/supabase-js 2.117.2 browser bundle (dist/umd/supabase.js from npm), MIT license (see supabase-js-LICENSE.txt).
The sign-in and database client. Served from this site at an exact version, so a new release can't change the app overnight.
To update it: download the new version's dist/umd/supabase.js, save it here under its version number, change the file name
in index.html, sw.js and scripts/build_zip.sh, test, then delete the old file.
