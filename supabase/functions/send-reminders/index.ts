// @ts-nocheck
// Supabase Edge Function: sends web-push reminders. Called every minute by pg_cron (see migrations/004_push_schedule.sql),
// and by the app's "Send test notification" button ({"test": true} + the user's login token).
//
// Secrets (Edge Functions > Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically. Turn OFF "Verify JWT" for this
// function: the cron call has no login token, so the function checks CRON_SECRET itself.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// <core> — pure logic (no network); unit-tested locally in node
const DAY = 864e5;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmtD = ms => new Date(ms).toISOString().slice(0, 10);

function tzParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return Object.fromEntries(f.formatToParts(ms).map(p => [p.type, p.value]));
}
function tzOffsetMs(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}
function wallToMs(dateStr, timeStr, tz) { // wall-clock time in `tz` -> UTC ms (handles DST)
  const [y, m, d] = dateStr.split('-').map(Number), [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
}

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

// All-day events anchor to 9:00 in the device's zone; timed events use their own zone (falling back to the device's).
function startInstant(ev, dateStr, deviceTz) {
  const allDay = ev.all_day || !ev.start_time;
  const tz = allDay ? deviceTz : (ev.tz || deviceTz);
  return wallToMs(dateStr, allDay ? '09:00' : ev.start_time.slice(0, 5), tz);
}

// Skipped / changed days of a repeating event ("exceptions"): the occurrences that really happen.
// null fields in an exception mean "same as the series".
function withException(ev, x) {
  const p = { ...ev };
  for (const k of ['title', 'start_time', 'end_time', 'all_day', 'location', 'notes']) if (x[k] !== null && x[k] !== undefined) p[k] = x[k];
  return p;
}
function effectiveStarts(ev, exceptions, fromMs, toMs) {
  const mine = ev.repeat && ev.repeat !== 'none' ? exceptions.filter(x => x.event_id === ev.id) : [];   // only repeating events can have single-day changes
  if (!mine.length) return occurrenceDates(ev, fromMs, toMs).map(date => ({ date, ev }));
  const touched = new Set(mine.map(x => x.original_date));
  const out = occurrenceDates(ev, fromMs, toMs).filter(d => !touched.has(d)).map(date => ({ date, ev }));
  for (const x of mine) {
    if (x.skipped) continue;
    const target = x.new_date || x.original_date, t = parseD(target);
    if (t < fromMs || t > toMs) continue;                    // also lets a day moved INTO the window count
    const o = parseD(x.original_date);
    if (!occurrenceDates(ev, o, o).length) continue;         // the series no longer has that day
    out.push({ date: target, ev: withException(ev, x) });
  }
  return out;
}

// Which reminders should fire now? A reminder is due if its fire time is within the last `windowMs`.
// People involved in an event but with no saved reminder row fall back to their default reminders.
function computeDue({ events, eventMembers, reminders, members, subs, now, windowMs, exceptions = [] }) {
  const memberById = Object.fromEntries(members.map(m => [m.id, m]));
  const deviceTz = {};
  for (const s of subs) if (!deviceTz[s.user_id]) deviceTz[s.user_id] = s.tz || 'UTC';
  const remRow = {}, involved = {};
  for (const r of reminders) remRow[r.event_id + '|' + r.member_id] = r.minutes;
  for (const em of eventMembers) (involved[em.event_id] ||= new Set()).add(em.member_id);
  for (const r of reminders) (involved[r.event_id] ||= new Set()).add(r.member_id);
  const today = parseD(fmtD(now)), from = today - 3 * DAY, to = today + 10 * DAY;
  const out = [];
  for (const ev of events) {
    const people = involved[ev.id];
    if (!people) continue;
    const starts = effectiveStarts(ev, exceptions, from, to);
    for (const mid of people) {
      const m = memberById[mid];
      if (!m || !m.user_id || !deviceTz[m.user_id]) continue; // nobody to notify
      const minutesList = remRow[ev.id + '|' + mid] ?? m.default_reminders ?? [];
      for (const { date, ev: e2 } of starts) {                 // e2 = the series, or the series with this day's changes
        const occ = startInstant(e2, date, deviceTz[m.user_id]);
        for (const minutes of minutesList) {
          const fire = occ - minutes * 60000;
          if (fire <= now && fire > now - windowMs) out.push({ ev: e2, member: m, minutes, occ, date, tz: deviceTz[m.user_id] });
        }
      }
    }
  }
  return out;
}

function describe(d) {
  const { ev, minutes, occ, tz, member } = d;
  const lead = minutes === 0 ? 'Starting now'
    : minutes < 60 ? `In ${minutes} min`
    : minutes < 1440 ? `In ${minutes / 60} hour${minutes === 60 ? '' : 's'}`
    : `In ${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  const allDay = ev.all_day || !ev.start_time;
  const when = allDay
    ? 'All day, ' + new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(occ)
    : new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: member.time_format === '24' ? 'h23' : 'h12' }).format(occ).toLowerCase().replace(' ', '');
  return { title: ev.title, body: [lead, when, ev.location].filter(Boolean).join(' · '), tag: `${ev.id}-${d.date}-${minutes}` };
}
// </core>

// CORS: without these headers the browser hides the reply from the app (the test button would look like it failed).
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

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

async function pushTo(sb, subs, payload) {
  let sent = 0, failed = 0, lastError = '';
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await sb.from('push_subscriptions').delete().eq('id', s.id); // device unsubscribed
      else { failed++; lastError = e.statusCode ? `HTTP ${e.statusCode}` : String(e.message || e); console.error('push failed', e.statusCode, e.body); }
    }
  }));
  return { sent, failed, lastError };
}

const setVapid = () => webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com', Deno.env.get('VAPID_PUBLIC_KEY'), Deno.env.get('VAPID_PRIVATE_KEY'));

// Heartbeat for the app's Settings (red dot on the gear when something's wrong). 'reminders' is stamped when a run FINISHES,
// with detail = what went wrong if it didn't, so a run that crashes partway never looks healthy. Failure to write it is not fatal.
const beat = (sb, detail) => sb.from('system_status').upsert({ key: 'reminders', last_run: new Date().toISOString(), detail });

async function scheduledRun(sb) {
  setVapid();
  const now = Date.now();
  // Who's involved and their saved reminders ride along with each event, so only rows for events that matter are read.
  const [events, members, subs] = await Promise.all([
    fetchAll(() => sb.from('events').select('*, event_members(member_id), reminders(member_id, minutes)').is('deleted_at', null)
      .or(`repeat.neq.none,and(date.gte.${fmtD(now - 3 * DAY)},date.lte.${fmtD(now + 10 * DAY)})`).order('id')),
    fetchAll(() => sb.from('members').select('*').order('id')),
    fetchAll(() => sb.from('push_subscriptions').select('*').order('id')),
  ]);
  for (const r of [events, members, subs]) if (r.error) { await beat(sb, r.error.message); return json({ error: r.error.message }, 500); }
  const exceptions = await fetchAll(() => sb.from('event_exceptions').select('*').order('id'));   // single-day changes; if that table doesn't exist yet, carry on without them
  const eventMembers = events.data.flatMap(e => e.event_members.map(x => ({ event_id: e.id, member_id: x.member_id })));
  const reminders = events.data.flatMap(e => e.reminders.map(r => ({ event_id: e.id, member_id: r.member_id, minutes: r.minutes })));

  const due = computeDue({ events: events.data, eventMembers, reminders, members: members.data, subs: subs.data, now, windowMs: 5 * 60000, exceptions: exceptions.error ? [] : exceptions.data });
  let delivered = 0, failed = 0, lastError = '';
  for (const d of due) {
    // claim it first so overlapping runs can't double-send
    const { data: claimed } = await sb.from('sent_reminders')
      .upsert({ event_id: d.ev.id, member_id: d.member.id, occ_start: new Date(d.occ).toISOString(), minutes: d.minutes },
        { onConflict: 'event_id,member_id,occ_start,minutes', ignoreDuplicates: true }).select();
    if (!claimed || !claimed.length) continue;
    const r = await pushTo(sb, subs.data.filter(s => s.user_id === d.member.user_id), describe(d));
    delivered += r.sent; failed += r.failed; lastError = r.lastError || lastError;
  }
  await sb.from('sent_reminders').delete().lt('sent_at', new Date(now - 14 * DAY).toISOString()); // tidy up
  // Delivery failures stay on show ('push') until a later notification goes through, so a broken setup can't hide between runs.
  if (failed) await sb.from('system_status').upsert({ key: 'push', last_run: new Date().toISOString(), detail: `${failed} notification${failed === 1 ? '' : 's'} could not be delivered: ${lastError}` });
  else if (delivered) await sb.from('system_status').delete().eq('key', 'push');
  await beat(sb, null);
  return json({ due: due.length, delivered, failed });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const body = await req.json().catch(() => ({}));

  // --- test button: the signed-in user sends a notification to their own devices ---
  if (body.test) {
    setVapid();
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /i, '');
    const { data: { user } } = await sb.auth.getUser(jwt);
    if (!user) return json({ error: 'not signed in' }, 401);
    const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', user.id);
    const { sent } = await pushTo(sb, subs || [], { title: 'Notifications are working 🎉', body: 'Reminders from the family calendar will show up like this.', tag: 'test' });
    return json({ devices: (subs || []).length, sent });
  }

  // --- scheduled run ---
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'forbidden' }, 403);
  try { return await scheduledRun(sb); }
  catch (e) { console.error(e); await beat(sb, `crashed: ${e.message || e}`); return json({ error: String(e.message || e) }, 500); }
});
