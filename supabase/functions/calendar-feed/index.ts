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

function buildEvent(ev, nameOf, memberCount) {
  const allDay = ev.all_day || !ev.start_time;
  const lastDate = ev.end_date && ev.end_date > ev.date ? ev.end_date : ev.date;
  const stamp = utcStamp(Date.parse(ev.updated_at || ev.created_at || '2026-01-01T00:00:00Z') || 0);
  const names = (ev.who || []).map(nameOf).filter(Boolean);
  const suffix = names.length && names.length < memberCount ? ` (${names.join(', ')})` : '';   // say whose it is unless it's everyone's
  const L = ['BEGIN:VEVENT', `UID:${ev.id}@trying-my-best`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`];
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
  }
  L.push(`SUMMARY:${esc(ev.title + suffix)}`);
  if (ev.location) L.push(`LOCATION:${esc(ev.location)}`);
  const desc = [ev.notes, names.length ? 'With: ' + names.join(', ') : ''].filter(Boolean).join('\n');
  if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
  L.push('TRANSP:' + (allDay ? 'TRANSPARENT' : 'OPAQUE'), 'END:VEVENT');
  return L;
}

function buildCalendar(events, members) {
  const nameOf = id => (members.find(m => m.id === id) || {}).name;
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trying My Best//Family Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Trying My Best', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const ev of events) L.push(...buildEvent(ev, nameOf, members.length));
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
// </core>

const notFound = () => new Response('Not found', { status: 404 });

Deno.serve(async req => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const token = new URL(req.url).searchParams.get('t') || '';
  if (!/^[0-9a-f]{32,128}$/.test(token)) return notFound();
  const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: tok } = await sb.from('feed_tokens').select('family_id').eq('token', token).maybeSingle();
  if (!tok) return notFound();                                    // wrong or regenerated link: reveal nothing

  const [events, members] = await Promise.all([
    sb.from('events').select('*, event_members(member_id)').eq('family_id', tok.family_id).is('deleted_at', null).order('date'),
    sb.from('members').select('id, name').eq('family_id', tok.family_id),
  ]);
  if (events.error || members.error) return new Response('Server error', { status: 500 });
  const evs = events.data.map(e => ({ ...e, who: e.event_members.map(x => x.member_id) }));
  const body = buildCalendar(evs, members.data);
  return new Response(req.method === 'HEAD' ? null : body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': 'inline; filename="trying-my-best.ics"' },
  });
});
