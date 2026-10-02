#!/usr/bin/env python3
"""Turn a backup file into SQL you can paste into Supabase's SQL Editor to restore data.

  python3 backup_to_sql.py calendar-2026-10-02_0300.json > restore.sql
  python3 backup_to_sql.py calendar-2026-10-02_0300.json --overwrite > restore.sql

Default: only adds rows that are missing (safe: brings back deleted events without touching anything else).
--overwrite: also resets existing rows to their backed-up values (use to undo edits).
Note: backups don't contain logins. Restoring into the SAME Supabase project works as-is; into a new project,
people must sign up again and their members.user_id values need re-linking.
"""
import json, sys

TABLES = [  # (table, primary key columns), in dependency order
    ('families', ['id']), ('members', ['id']), ('events', ['id']),
    ('event_members', ['event_id', 'member_id']), ('reminders', ['event_id', 'member_id']),
]

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    overwrite = '--overwrite' in sys.argv
    if len(args) != 1:
        sys.exit(__doc__)
    data = json.load(open(args[0]))
    print(f"-- Restore generated from backup taken {data.get('exported_at')}")
    print('begin;')
    for table, pk in TABLES:
        rows = data.get(table, [])
        if not rows:
            print(f'-- {table}: no rows')
            continue
        payload = json.dumps(rows, ensure_ascii=False)
        tag = 'bk'
        while f'${tag}$' in payload:  # pick a quote tag that can't collide with the data
            tag += 'x'
        cols = list(rows[0].keys())
        if overwrite:
            sets = ', '.join(f'{c} = excluded.{c}' for c in cols if c not in pk) or f'{pk[0]} = excluded.{pk[0]}'
            conflict = f"do update set {sets}"
        else:
            conflict = 'do nothing'
        print(f"insert into public.{table} select * from jsonb_populate_recordset(null::public.{table}, ${tag}${payload}${tag}$::jsonb)\n"
              f"  on conflict ({', '.join(pk)}) {conflict};  -- {len(rows)} rows")
    print('commit;')

main()
