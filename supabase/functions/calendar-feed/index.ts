// @ts-nocheck
// Supabase Edge Function: serves the family calendar as an .ics subscription feed (Google/Apple Calendar "from URL").
// URL: https://<project>.supabase.co/functions/v1/calendar-feed/trying-my-best.ics?t=<token>
// The token (Settings > Calendar feed) is the only credential. Turn OFF "Verify JWT" for this function: calendar apps
// fetch it without a login, and the function checks the token itself. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are automatic.
import { createClient } from 'npm:@supabase/supabase-js@2';

// <core> — pure logic (no network); unit-tested locally in node
const DAY = 864e5;
const pad = n => String(n).padStart(2, '0');
const icsDate = d => d.replace(/-/g, '');                       // 2026-10-05 -> 20261005
const icsTime = t => t.slice(0, 2) + t.slice(3, 5) + '00';      // 07:00[:00] -> 070000
const addDaysStr = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * DAY).toISOString().slice(0, 10);
const utcStamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');   // 20261005T120000Z
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmtD = ms => new Date(ms).toISOString().slice(0, 10);

// Dates (YYYY-MM-DD, in the event's own wall calendar) on which an event occurs within [fromMs, toMs] (UTC midnights).
function occurrenceDates(ev, fromMs, toMs) {
  const start = parseD(ev.date), until = ev.repeat_until ? parseD(ev.repeat_until) : null, out = [];
  if (!ev.repeat || ev.repeat === 'none') {
    if (start >= fromMs && start <= toMs) out.push(fmtD(start));
    return out;
  }
  const s = new Date(start);
  if (ev.repeat === 'weekly' && ev.weekdays && ev.weekdays.length > 1) {
    // Several days per week: weeks start Sunday, counted from the start date's week (same rule as the app).
    const every = ev.repeat_every || 1, week0 = start - s.getUTCDay() * DAY, step = 7 * every * DAY;
    const days = [...ev.weekdays].sort((a, b) => a - b);
    for (let w = Math.max(0, Math.floor((fromMs - week0) / step) - 1); ; w++) {
      const ws = week0 + w * step;
      if (ws > toMs || (until !== null && ws > until)) break;
      for (const wd of days) {
        const d = ws + wd * DAY;
        if (d < start || d < fromMs || d > toMs || (until !== null && d > until)) continue;
        out.push(fmtD(d));
      }
    }
    return out;
  }
  for (let i = 0; i < 5000; i++) {
    let d;
    if (ev.repeat === 'daily') d = start + i * DAY;
    else if (ev.repeat === 'weekly') d = start + 7 * (ev.repeat_every || 1) * i * DAY;
    else if (ev.repeat === 'yearly') { // a Feb 29 date falls on Feb 28 in non-leap years
      d = Date.UTC(s.getUTCFullYear() + i, s.getUTCMonth(), s.getUTCDate());
      if (new Date(d).getUTCMonth() !== s.getUTCMonth()) d = Date.UTC(s.getUTCFullYear() + i, s.getUTCMonth() + 1, 0);
    } else { // monthly: months lacking that day-of-month are skipped, matching the app
      d = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i, s.getUTCDate());
      if (new Date(d).getUTCDate() !== s.getUTCDate()) { if (d > toMs) break; continue; }
    }
    if (d > toMs || (until !== null && d > until)) break;
    if (d >= fromMs) out.push(fmtD(d));
  }
  return out;
}


function tzParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return Object.fromEntries(f.formatToParts(ms).map(p => [p.type, p.value]));
}
function tzOffsetMs(ms, tz) { const p = tzParts(ms, tz); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms; }
function wallToMs(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number), [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
}

// RFC 5545 text escaping and line folding (75 octets per line, continuation lines start with a space)
const esc = t => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

// One VEVENT. `skips` become EXDATE lines; `rid` (the original start) marks this as the override for one day of a series.
function veventLines(ev, nameOf, memberCount, skips = [], rid = null) {
  const allDay = ev.all_day || !ev.start_time;
  const lastDate = ev.end_date && ev.end_date > ev.date ? ev.end_date : ev.date;
  const stamp = utcStamp(Date.parse(ev.updated_at || ev.created_at || '2026-01-01T00:00:00Z') || 0);
  const names = (ev.who || []).map(nameOf).filter(Boolean);
  const suffix = names.length && names.length < memberCount ? ` (${names.join(', ')})` : '';   // say whose it is unless it's everyone's
  const L = ['BEGIN:VEVENT', `UID:${ev.id}@trying-my-best`];
  if (rid) L.push(rid(allDay, ev));
  L.push(`DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`);
  let tzp = '';
  if (allDay) {
    L.push(`DTSTART;VALUE=DATE:${icsDate(ev.date)}`, `DTEND;VALUE=DATE:${icsDate(addDaysStr(lastDate, 1))}`);   // DTEND is exclusive for all-day
  } else {
    tzp = ev.tz ? `;TZID=${ev.tz}` : '';                         // no zone saved = floating time (shown as entered)
    const st = icsTime(ev.start_time);
    let endT = ev.end_time ? icsTime(ev.end_time) : null;
    if (!endT || (lastDate === ev.date && endT <= st)) endT = +st.slice(0, 2) >= 23 ? st : pad(+st.slice(0, 2) + 1) + st.slice(2);   // default one hour
    L.push(`DTSTART${tzp}:${icsDate(ev.date)}T${st}`, `DTEND${tzp}:${icsDate(lastDate)}T${endT}`);
  }
  // repeats
  if (ev.repeat && ev.repeat !== 'none') {
    const parts = [];
    if (ev.repeat === 'daily') parts.push('FREQ=DAILY');
    else if (ev.repeat === 'weekly') {
      parts.push('FREQ=WEEKLY');
      if (ev.repeat_every > 1) parts.push(`INTERVAL=${ev.repeat_every}`);
      parts.push('WKST=SU');                                     // weeks start Sunday, as in the app
      if (ev.weekdays && ev.weekdays.length > 1) parts.push('BYDAY=' + [...ev.weekdays].sort((a, b) => a - b).map(d => BYDAY[d]).join(','));
    } else if (ev.repeat === 'monthly') parts.push('FREQ=MONTHLY');   // months without that day are skipped, as in the app
    else if (ev.repeat === 'yearly') {
      if (ev.date.slice(5) === '02-29') parts.push('FREQ=YEARLY', 'BYMONTH=2', 'BYMONTHDAY=28,29', 'BYSETPOS=-1');   // Feb 29 -> Feb 28 in non-leap years
      else parts.push('FREQ=YEARLY');
    }
    if (ev.repeat_until) {
      if (allDay) parts.push(`UNTIL=${icsDate(ev.repeat_until)}`);
      else if (ev.tz) parts.push(`UNTIL=${utcStamp(wallToMs(ev.repeat_until, '23:59', ev.tz) + 59000)}`);   // UNTIL must be UTC when DTSTART has a zone
      else parts.push(`UNTIL=${icsDate(ev.repeat_until)}T235959`);
    }
    L.push('RRULE:' + parts.join(';'));
    for (const x of skips) L.push(allDay ? `EXDATE;VALUE=DATE:${icsDate(x.original_date)}` : `EXDATE${tzp}:${icsDate(x.original_date)}T${icsTime(ev.start_time)}`);
  }
  L.push(`SUMMARY:${esc(ev.title + suffix)}`);
  if (ev.location) L.push(`LOCATION:${esc(ev.location)}`);
  const desc = [ev.notes, names.length ? 'With: ' + names.join(', ') : ''].filter(Boolean).join('\n');
  if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
  L.push('TRANSP:' + (allDay ? 'TRANSPARENT' : 'OPAQUE'), 'END:VEVENT');
  return L;
}

// A series with its single-day changes: skipped days become EXDATEs on the series; moved/changed days become override VEVENTs.
function withException(ev, x) {
  const p = { ...ev };
  for (const k of ['title', 'start_time', 'end_time', 'all_day', 'location', 'notes']) if (x[k] !== null && x[k] !== undefined) p[k] = x[k];
  return p;
}
function buildEvent(ev, nameOf, memberCount, exceptions = []) {
  const repeating = ev.repeat && ev.repeat !== 'none';
  const valid = x => repeating && occurrenceDates(ev, parseD(x.original_date), parseD(x.original_date)).length > 0;   // ignore leftovers the series no longer has
  const mine = exceptions.filter(valid);
  const lines = veventLines(ev, nameOf, memberCount, mine.filter(x => x.skipped));
  const span = ev.end_date && ev.end_date > ev.date ? Math.round((parseD(ev.end_date) - parseD(ev.date)) / DAY) : 0;
  const origAllDay = ev.all_day || !ev.start_time, tzp = origAllDay ? '' : (ev.tz ? `;TZID=${ev.tz}` : '');
  for (const x of mine.filter(x => !x.skipped)) {
    const date = x.new_date || x.original_date;
    const p = { ...withException(ev, x), repeat: 'none', repeat_every: 1, weekdays: null, repeat_until: null, date, end_date: span ? addDaysStr(date, span) : null };
    const rid = () => origAllDay ? `RECURRENCE-ID;VALUE=DATE:${icsDate(x.original_date)}` : `RECURRENCE-ID${tzp}:${icsDate(x.original_date)}T${icsTime(ev.start_time)}`;
    lines.push(...veventLines(p, nameOf, memberCount, [], rid));
  }
  return lines;
}

function buildCalendar(events, members, exceptions = []) {
  const nameOf = id => (members.find(m => m.id === id) || {}).name;
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trying My Best//Family Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Trying My Best', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const ev of events) L.push(...buildEvent(ev, nameOf, members.length, exceptions.filter(x => x.event_id === ev.id)));
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
// </core>

const notFound = () => new Response('Not found', { status: 404 });

// Supabase hands back at most 1000 rows per request (its "Max rows" API setting) and says nothing about the rest,
// so anything that grows over time is read a page at a time. `build` makes a fresh, ordered query for each page.
const PAGE = 1000;
async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...data);
    if (data.length < PAGE) return { data: rows, error: null };
  }
}

Deno.serve(async req => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const token = new URL(req.url).searchParams.get('t') || '';
  if (!/^[0-9a-f]{32,128}$/.test(token)) return notFound();
  const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: tok } = await sb.from('feed_tokens').select('family_id').eq('token', token).maybeSingle();
  if (!tok) return notFound();                                    // wrong or regenerated link: reveal nothing

  const [events, members] = await Promise.all([
    fetchAll(() => sb.from('events').select('*, event_members(member_id)').eq('family_id', tok.family_id).is('deleted_at', null).order('date').order('id')),
    sb.from('members').select('id, name').eq('family_id', tok.family_id),
  ]);
  if (events.error || members.error) return new Response('Server error', { status: 500 });
  const evs = events.data.map(e => ({ ...e, who: e.event_members.map(x => x.member_id) }));
  // Single-day changes, matched to this family through their event (a list of every event id would make the URL too long).
  // If that table doesn't exist yet, carry on without them.
  const ex = await fetchAll(() => sb.from('event_exceptions').select('*, events!inner(family_id)').eq('events.family_id', tok.family_id).order('id'));
  const body = buildCalendar(evs, members.data, ex.error ? [] : ex.data);
  return new Response(req.method === 'HEAD' ? null : body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': 'inline; filename="trying-my-best.ics"' },
  });
});
