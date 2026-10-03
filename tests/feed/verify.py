"""Checks the generated calendar feed against the app's own logic using independent libraries.
Needs: python-dateutil, icalendar, recurring-ical-events (see tests/README.md). Reads JSON on stdin from generate.js."""
import json, re, sys, datetime as dt
import icalendar, recurring_ical_events
d = json.load(sys.stdin); fails = 0
def ok(c, m):
    global fails
    print(('ok   ' if c else 'FAIL ') + m); fails += (not c)
raw = d['ics']
ok(raw.endswith('\r\n') and all(len(l.encode()) <= 75 for l in raw.split('\r\n')), 'CRLF endings and every line folded to 75 octets')
cal = icalendar.Calendar.from_ical(raw)
ok(len({str(c['UID']) for c in cal.walk('VEVENT')}) == len(d['expected']), 'parses cleanly, one UID per event')
start = dt.date.fromisoformat(d['window'][0]); end = dt.date.fromisoformat(d['window'][1])
for uid, exp in d['expected'].items():
    got = set()
    for occ in recurring_ical_events.of(cal).between(start, end + dt.timedelta(days=1)):
        if not str(occ['UID']).startswith(uid + '@'): continue
        s, e = occ['DTSTART'].dt, occ['DTEND'].dt
        title = re.sub(r' \([^)]*\)$', '', str(occ['SUMMARY']))
        if isinstance(s, dt.datetime):
            days = [(s.date(), s.strftime('%H:%M'))]; cur = s.date() + dt.timedelta(days=1); ed = e.date()
            while cur <= ed and not (cur == ed and e.hour == 0 and e.minute == 0): days.append((cur, '')); cur += dt.timedelta(days=1)
        else:
            days, cur = [], s
            while cur < e: days.append((cur, '')); cur += dt.timedelta(days=1)
        for day, tm in days:
            if start <= day <= end: got.add((day.isoformat(), tm, title))
    want = {tuple(x) for x in exp}
    ok(got == want, f'{uid:4s} feed expands to exactly what the app shows ({len(want)} entries)' + ('' if got == want else f'\n     only in app: {sorted(want-got)[:6]}\n     only in feed: {sorted(got-want)[:6]}'))
ok(raw.count('EXDATE') == 5 and raw.count('RECURRENCE-ID') == 6, 'skipped days are EXDATEs (5); moved/changed days are overrides (6); orphan and non-repeating leftovers are left out')
print('\nfeed: ALL PASSED' if not fails else f'\nfeed: {fails} FAILED'); sys.exit(1 if fails else 0)
