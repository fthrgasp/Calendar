// Family Calendar — shared via Supabase. Data lives on the server; the browser only caches `db` in memory.
'use strict';

const REMIND_OPTS = [
  [0, 'At time'], [10, '10 min'], [30, '30 min'], [60, '1 hour'],
  [120, '2 hours'], [1440, '1 day'], [2880, '2 days'], [10080, '1 week'],
];
const COLORS = ['#2b6cb0', '#d53f8c', '#2f855a', '#dd6b20', '#805ad5', '#319795'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TRASH_DAYS = 30;
const INVITE_KEY = 'famcal.invite';

// ---------- time zones ----------
// Events store wall-clock date/time plus the IANA zone they were entered in. Viewers see them converted
// to their own zone (members.tz, or the device's zone when unset). All-day events never convert.
const TZ_LIST = [
  ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona (no DST)'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'],
];
const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const tzLabel = tz => (TZ_LIST.find(([z]) => z === tz) || [, tz.split('/').pop().replace(/_/g, ' ')])[1];
function tzParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return Object.fromEntries(f.formatToParts(ms).map(p => [p.type, p.value]));
}
function tzOffsetMs(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}
function wallToMs(dateStr, timeStr, tz) { // wall-clock time in `tz` -> UTC milliseconds (handles DST)
  const [y, m, d] = dateStr.split('-').map(Number), [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
}
function msToWall(ms, tz) { const p = tzParts(ms, tz); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; }
function tzAbbr(ms, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms).find(p => p.type === 'timeZoneName').value;
}

// ---------- helpers ----------
const $ = (s, root = document) => root.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k === 'value') n.value = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) n.append(kid);
  return n;
};
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const uuid = () => crypto.randomUUID();
let hour24 = false; // display preference, set from the signed-in member's time_format
const fmtTime = t => {
  if (!t) return '';
  let [h, m] = t.split(':').map(Number);
  if (hour24) return `${pad(h)}:${pad(m)}`;
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m ? `${h}:${pad(m)}${ap}` : `${h}${ap}`;
};
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 4000);
}

// ---------- data layer ----------
let sb, db = null; // db = { me, familyId, members[], events[] }
const run = async q => { const { data, error } = await q; if (error) throw error; return data; };
const member = id => db.members.find(m => m.id === id);
const me = () => member(db.me);
const myTz = () => (db && me() && me().tz) || deviceTz;

const store = {
  async load(userId) {
    const mine = await run(sb.from('members').select('*').eq('user_id', userId));
    if (!mine.length) return false;
    const familyId = mine[0].family_id;
    const cutoff = new Date(Date.now() - TRASH_DAYS * 864e5).toISOString();
    await sb.from('events').delete().eq('family_id', familyId).lt('deleted_at', cutoff); // expire old trash
    const [members, events, rems] = await Promise.all([
      run(sb.from('members').select('*').eq('family_id', familyId).order('created_at')),
      run(sb.from('events').select('*, event_members(member_id)').eq('family_id', familyId)),
      run(sb.from('reminders').select('event_id, minutes').eq('member_id', mine[0].id)),
    ]);
    const remMap = Object.fromEntries(rems.map(r => [r.event_id, r.minutes]));
    db = {
      me: mine[0].id, familyId,
      members: members.map(m => ({ id: m.id, name: m.name, color: m.color, defaultReminders: m.default_reminders || [], user_id: m.user_id, tz: m.tz, time_format: m.time_format })),
      events: events.map(e => ({
        id: e.id, title: e.title, date: e.date, all_day: e.all_day,
        start_time: (e.start_time || '').slice(0, 5), end_time: (e.end_time || '').slice(0, 5),
        location: e.location, notes: e.notes, repeat: e.repeat, repeat_until: e.repeat_until || '', tz: e.tz, show_years: e.show_years, repeat_every: e.repeat_every, weekdays: e.weekdays,
        end_date: e.end_date === undefined ? undefined : e.end_date || '',
        created_by: e.created_by, deleted_at: e.deleted_at,
        who: e.event_members.map(x => x.member_id),
        // involved but never saved reminders -> the server uses your defaults, so show those
        reminders: { [mine[0].id]: remMap[e.id] ?? (e.event_members.some(x => x.member_id === mine[0].id) ? mine[0].default_reminders || [] : []) },
      })),
    };
    hour24 = me().time_format === '24';
    syncPushDevice(userId);
    return true;
  },
  async saveEvent(ev) {
    await run(sb.from('events').upsert({
      id: ev.id, family_id: db.familyId, title: ev.title, date: ev.date, all_day: ev.all_day,
      start_time: ev.all_day ? null : ev.start_time || null, end_time: ev.all_day ? null : ev.end_time || null,
      location: ev.location, notes: ev.notes, repeat: ev.repeat, repeat_until: ev.repeat_until || null, tz: ev.tz || null,
      ...(ev.show_years === undefined ? {} : { show_years: ev.show_years }), // omitted until the column exists
      ...(ev.repeat_every === undefined ? {} : { repeat_every: ev.repeat_every }), // same for repeat_every
      ...(ev.weekdays === undefined ? {} : { weekdays: ev.weekdays }), // and weekdays
      ...(ev.end_date === undefined ? {} : { end_date: ev.end_date || null }), // and end_date
      created_by: ev.created_by, deleted_at: ev.deleted_at,
    }));
    await run(sb.from('event_members').delete().eq('event_id', ev.id));
    if (ev.who.length) await run(sb.from('event_members').insert(ev.who.map(m => ({ event_id: ev.id, member_id: m }))));
    await run(sb.from('reminders').upsert({ event_id: ev.id, member_id: db.me, minutes: ev.reminders[db.me] || [] }));
  },
  setDeleted: (ev, when) => run(sb.from('events').update({ deleted_at: when }).eq('id', ev.id)),
  hardDelete: ev => run(sb.from('events').delete().eq('id', ev.id)),
  saveMember: m => run(sb.from('members').update({ name: m.name, color: m.color, default_reminders: m.defaultReminders, tz: m.tz || null, time_format: m.time_format || null }).eq('id', m.id)),
  async addMember(name, color) {
    const [row] = await run(sb.from('members').insert({ family_id: db.familyId, name, color }).select());
    return { id: row.id, name: row.name, color: row.color, defaultReminders: row.default_reminders || [], user_id: null, tz: null, time_format: null };
  },
};

// Run a server write; on failure tell the user and re-sync from the server so the screen never lies.
async function persist(fn) {
  try { await fn(); }
  catch (e) { console.error(e); toast('Could not save — check your connection. Reloading…'); await refresh(); }
}
async function refresh() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && await store.load(session.user.id)) render();
  } catch (e) { console.error(e); }
}

// ---------- counting years (birthdays / anniversaries) ----------
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
// "turns 36" / "5th anniversary" / "12 years", for yearly events whose date is the real start date. '' when not applicable.
function yearsLabel(ev, occDate) {
  if (!ev.show_years || ev.repeat !== 'yearly') return '';
  const n = +occDate.slice(0, 4) - +ev.date.slice(0, 4);
  if (n < 1) return '';
  if (/\b(birthday|bday|b-day)\b/i.test(ev.title)) return `turns ${n}`;
  if (/\banniversary\b/i.test(ev.title)) return `${ordinal(n)} anniversary`;
  return `${n} years`;
}

// "weekdays", "weekends", "Mon–Fri", "Mon, Wed, Fri"
function daysLabel(days) {
  const d = [...days].sort((a, b) => a - b), key = d.join();
  if (key === '1,2,3,4,5') return 'weekdays';
  if (key === '0,6') return 'weekends';
  const runs = [];
  for (const x of d) { const last = runs[runs.length - 1]; if (last && last[1] === x - 1) last[1] = x; else runs.push([x, x]); }
  return runs.map(([a, b]) => b - a >= 2 ? `${DOW[a]}–${DOW[b]}` : a === b ? DOW[a] : `${DOW[a]}, ${DOW[b]}`).join(', ');
}

// ---------- recurrence ----------
// Expands an event into occurrences falling on days within [from, to] (inclusive Dates).
function occurrenceStarts(ev, from, to) {
  const out = [];
  const start = parse(ev.date);
  const until = ev.repeat_until ? parse(ev.repeat_until) : null;
  const push = d => out.push({ ev, date: ymd(d) });
  if (ev.repeat === 'none') {
    if (start >= from && start <= to) push(start);
    return out;
  }
  if (ev.repeat === 'weekly' && ev.weekdays && ev.weekdays.length > 1) {
    // Several days per week: walk week by week (weeks start Sunday, counted from the start date's week).
    const every = ev.repeat_every || 1, week0 = addDays(start, -start.getDay()), days = [...ev.weekdays].sort((a, b) => a - b);
    const first = Math.max(0, Math.floor(Math.round((from - week0) / 864e5) / (7 * every)) - 1);
    for (let w = first; ; w++) {
      const ws = addDays(week0, 7 * every * w);
      if (ws > to || (until && ws > until)) break;
      for (const wd of days) {
        const d = addDays(ws, wd);
        if (d < start || d < from || d > to || (until && d > until)) continue;
        push(d);
      }
    }
    return out;
  }
  for (let i = 0; i < 5000; i++) {
    let d;
    if (ev.repeat === 'daily') d = addDays(start, i);
    else if (ev.repeat === 'weekly') d = addDays(start, 7 * (ev.repeat_every || 1) * i);
    else if (ev.repeat === 'yearly') { // same month/day each year; a Feb 29 date falls on Feb 28 in non-leap years
      d = new Date(start.getFullYear() + i, start.getMonth(), start.getDate());
      if (d.getMonth() !== start.getMonth()) d = new Date(start.getFullYear() + i, start.getMonth() + 1, 0);
    } else { // monthly: same day-of-month; months that lack that day (e.g. the 31st) are skipped
      d = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
      if (d.getDate() !== start.getDate()) { if (d > to) break; continue; }
    }
    if (d > to || (until && d > until)) break;
    if (d >= from) push(d);
  }
  return out;
}

// Days an event covers within [from, to]. A multi-day event (end_date after date) yields one entry per day,
// and repeating multi-day events expand every occurrence over its full length.
const spanDays = ev => ev.end_date && ev.end_date > ev.date ? Math.round((parse(ev.end_date) - parse(ev.date)) / 864e5) : 0;
function occurrences(ev, from, to) {
  const span = spanDays(ev);
  if (!span) return occurrenceStarts(ev, from, to);
  const out = [];
  for (const o of occurrenceStarts(ev, addDays(from, -span), to)) { // an occurrence starting before `from` may still reach into it
    for (let k = 0; k <= span; k++) {
      const d = addDays(parse(o.date), k);
      if (d >= from && d <= to) out.push({ ev, date: ymd(d), day: k, span, startDate: o.date });
    }
  }
  return out;
}

// ---------- state ----------
let view = 'month';
let cursor = new Date(); cursor.setDate(1);
let weekStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return addDays(d, -d.getDay()); })();
let agendaFrom = new Date(); agendaFrom.setHours(0, 0, 0, 0);
const hidden = new Set(); // member ids filtered out

// Convert one occurrence (dated in the event's own zone) into the viewer's zone.
// `from` is set only when the event started in a different zone, e.g. "1pm EDT".
// A multi-day event keeps the dates it was entered with (no zone shifting); each day shows the part that applies to it.
function multiDayView(ev, o) {
  const timed = !ev.all_day && ev.start_time;
  const zoneTag = timed && ev.tz && ev.tz !== myTz() ? tzAbbr(wallToMs(o.startDate, ev.start_time, ev.tz), ev.tz) : '';
  return {
    ev, date: o.date, src: o.startDate, startDate: o.startDate, day: o.day, span: o.span, zoneTag, from: null,
    start: o.day === 0 && timed ? ev.start_time : '',
    end: o.day === o.span && !ev.all_day && ev.end_time ? ev.end_time : '',
  };
}
function toViewer(ev, date, o) {
  if (o && o.span > 0) return multiDayView(ev, o);
  const same = { ev, date, src: date, start: ev.all_day ? '' : ev.start_time, end: ev.all_day ? '' : ev.end_time, from: null };
  const vz = myTz();
  if (!ev.tz || ev.all_day || !ev.start_time || ev.tz === vz) return same;
  const startMs = wallToMs(date, ev.start_time, ev.tz);
  const s = msToWall(startMs, vz);
  if (s.time === ev.start_time && s.date === date) return same; // zones happen to agree at this moment
  const end = ev.end_time ? msToWall(wallToMs(date, ev.end_time, ev.tz), vz).time : '';
  return { ev, date: s.date, src: date, start: s.time, end, from: `${fmtTime(ev.start_time)} ${tzAbbr(startMs, ev.tz)}` };
}

const visibleEvents = (from, to, ignoreFilter = false) => {
  const list = [];
  const fromKey = ymd(from), toKey = ymd(to);
  for (const ev of db.events) {
    if (ev.deleted_at) continue;
    if (!ignoreFilter && hidden.size && ev.who.length && ev.who.every(w => hidden.has(w))) continue;
    // widen by a day each side: a zone shift can move an occurrence across the range edge
    for (const o of occurrences(ev, addDays(from, -1), addDays(to, 1))) {
      const v = toViewer(ev, o.date, o);
      if (v.date >= fromKey && v.date <= toKey) list.push(v);
    }
  }
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
};
const colorOf = ev => (member(ev.who[0]) || { color: '#718096' }).color;

// ---------- rendering ----------
function render() {
  if (!db) return;
  renderChips();
  renderMotd();
  $('#main').replaceChildren(view === 'month' ? renderMonth() : view === 'week' ? renderWeek() : renderAgenda());
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
}

function renderChips() {
  $('#chips').replaceChildren(...db.members.map(m =>
    el('button', {
      class: 'chip' + (hidden.has(m.id) ? ' off' : ''),
      style: `--c:${m.color}; background: color-mix(in srgb, ${m.color} 18%, transparent);`,
      onclick: () => { hidden.has(m.id) ? hidden.delete(m.id) : hidden.add(m.id); render(); },
    }, el('span', { class: 'dot', style: `--c:${m.color}` }), m.name)));
}

function renderMonth() {
  $('#title').textContent = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const gridEnd = addDays(gridStart, 41);
  const byDay = {};
  for (const o of visibleEvents(gridStart, gridEnd)) (byDay[o.date] ||= []).push(o);
  const todayStr = ymd(new Date());
  const g = el('div', { class: 'grid' }, DOW.map(d => el('div', { class: 'dow' }, d)));
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i), key = ymd(d), items = byDay[key] || [];
    g.append(el('div', {
      class: 'cell' + (d.getMonth() !== cursor.getMonth() ? ' other' : '') + (key === todayStr ? ' today' : '') + (items.length ? ' has' : ''),
      // Empty days are deliberately inert: adding an event is only ever done via the + button.
      onclick: items.length ? () => { view = 'agenda'; agendaFrom = d; render(); window.scrollTo(0, 0); } : null,
    },
      el('span', { class: 'n' }, String(d.getDate())),
      items.slice(0, 3).map(o => el('div', { class: 'ev-mini' + (o.day > 0 ? ' cont' : ''), style: `--c:${colorOf(o.ev)}` }, (o.day > 0 ? '↳ ' : '') + o.ev.title)),
      items.length > 3 ? el('div', { class: 'more' }, `+${items.length - 3} more`) : ''));
  }
  return g;
}

function dayCard(d, items) {
  const key = ymd(d);
  return el('div', { class: 'day' + (key === ymd(new Date()) ? ' today' : '') },
    el('h3', {}, d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })),
    items.length ? items.map(eventRow) : el('div', { class: 'none' }, 'Nothing planned'));
}

function eventRow(o) {
  const ev = o.ev;
  let time = ev.all_day ? 'All day' : `${fmtTime(o.start)}${o.end ? '–' + fmtTime(o.end) : ''}${o.from ? ` (${o.from})` : ''}`;
  if (o.span > 0) { // multi-day: say which part of the run this day is
    const tag = o.zoneTag ? ` ${o.zoneTag}` : '';
    const part = ev.all_day || (o.day > 0 && o.day < o.span) ? 'All day'
      : o.day === 0 ? `from ${fmtTime(o.start)}${tag}` : o.end ? `until ${fmtTime(o.end)}${tag}` : 'last day';
    time = `${part} · day ${o.day + 1} of ${o.span + 1}`;
  }
  return el('div', { class: 'ev', style: `--c:${colorOf(ev)}`, onclick: () => openDetail(o) },
    el('div', { class: 'bar' }),
    el('div', {},
      el('div', { class: 't' }, ev.title,
        el('span', { class: 'who' }, ev.who.map(w => el('span', { class: 'dot', style: `--c:${(member(w) || {}).color}` })))),
      el('div', { class: 'm' }, [time, yearsLabel(ev, o.date), ev.location, ev.repeat !== 'none' ? '↻' : ''].filter(Boolean).join(' · '))));
}

function renderWeek() {
  const end = addDays(weekStart, 6);
  $('#title').textContent = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const byDay = {};
  for (const o of visibleEvents(weekStart, end)) (byDay[o.date] ||= []).push(o);
  return el('div', {}, Array.from({ length: 7 }, (_, i) => { const d = addDays(weekStart, i); return dayCard(d, byDay[ymd(d)] || []); }));
}

function renderAgenda() {
  $('#title').textContent = 'Upcoming';
  const end = addDays(agendaFrom, 59);
  const byDay = {};
  for (const o of visibleEvents(agendaFrom, end)) (byDay[o.date] ||= []).push(o);
  const days = Object.keys(byDay).sort();
  if (!days.length) return el('div', { class: 'empty' }, 'Nothing in the next 60 days. Tap + to add something.');
  return el('div', {}, days.map(k => dayCard(parse(k), byDay[k])));
}

// ---------- message of the day ----------
// Lines live in motd.js. One is chosen per day (same for everyone); "spicy" ones only appear on devices that opted in.
const SPICY_KEY = 'famcal.spicy';
const spicyOn = () => { try { return localStorage.getItem(SPICY_KEY) === '1'; } catch { return false; } };
const setSpicy = on => { try { localStorage.setItem(SPICY_KEY, on ? '1' : '0'); } catch { /* storage blocked: stays off */ } };
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const poolOf = (section, spicy) => section ? [...(section.clean || []), ...(spicy ? section.spicy || [] : [])] : [];
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function motdText() {
  const M = window.MOTD;
  if (!M || !db) return '';
  const spicy = spicyOn(), nowWall = msToWall(Date.now(), myTz()), today = nowWall.date;
  const todays = visibleEvents(parse(today), parse(today), true);

  // Something starting within the hour beats everything else.
  const soon = todays
    .filter(o => !o.ev.all_day && o.start && toMin(o.start) - toMin(nowWall.time) > 0 && toMin(o.start) - toMin(nowWall.time) <= 60)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const soonPool = soon && poolOf(M.soon, spicy);
  if (soonPool && soonPool.length) {
    return soonPool[hashStr(today + soon.ev.id) % soonPool.length]
      .replace('{title}', soon.ev.title).replace('{mins}', toMin(soon.start) - toMin(nowWall.time));
  }

  const dow = parse(today).getDay();
  const applies = { busy: todays.length >= 4, empty: todays.length === 0, friday: dow === 5, monday: dow === 1, weekend: dow === 0 || dow === 6 };
  const keys = Object.keys(applies).filter(k => applies[k] && poolOf(M[k], spicy).length);
  if (keys.length && hashStr(today + 'roll') % 10 < 4) {
    const key = keys[hashStr(today + 'key') % keys.length], pool = poolOf(M[key], spicy);
    return pool[hashStr(today + key) % pool.length];
  }
  const pool = poolOf(M.general, spicy);
  return pool.length ? pool[hashStr(today) % pool.length] : '';
}
function renderMotd() { $('#motd').textContent = motdText(); }
setInterval(() => { if (db) renderMotd(); }, 60000); // keeps "starts in N min" fresh

// ---------- navigation ----------
function nav(dir) {
  if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
  else if (view === 'week') weekStart = addDays(weekStart, 7 * dir);
  else agendaFrom = addDays(agendaFrom, 30 * dir);
  render();
}
$('#prev').onclick = () => nav(-1);
$('#next').onclick = () => nav(1);
$('#today').onclick = () => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  cursor = new Date(t.getFullYear(), t.getMonth(), 1); weekStart = addDays(t, -t.getDay()); agendaFrom = t; render();
};
// Tap the title to jump straight to any date (stays in the current view).
const jumpDlg = $('#jumpDlg');
function openJump() {
  $('#jumpDate').value = ymd(view === 'month' ? cursor : view === 'week' ? weekStart : agendaFrom);
  jumpDlg.showModal();
}
$('#title').onclick = openJump;
$('#title').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJump(); } };
$('#jumpCancel').onclick = () => jumpDlg.close();
$('#jumpForm').onsubmit = e => {
  e.preventDefault();
  const v = $('#jumpDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
  const d = parse(v);
  cursor = new Date(d.getFullYear(), d.getMonth(), 1);
  weekStart = addDays(d, -d.getDay());
  agendaFrom = d;
  jumpDlg.close(); render(); window.scrollTo(0, 0);
};
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { view = b.dataset.view; render(); });

// ---------- event form ----------
const dlg = $('#eventDlg'), form = $('#eventForm');
let editing = null;

function pillSet(box, options, selected, colorFor) {
  box.replaceChildren(...options.map(([val, label]) => {
    const p = el('span', { class: 'pill' + (selected.has(val) ? ' on' : ''), style: colorFor ? `--c:${colorFor(val)}` : '' }, label);
    p.onclick = () => { selected.has(val) ? selected.delete(val) : selected.add(val); p.classList.toggle('on'); };
    return p;
  }));
}

let selWho = new Set(), selRemind = new Set(), selDays = new Set();

// Duplicate: opens the new-event form filled with a copy of this event (nothing saves until Save is pressed).
function duplicatePrefill(o) {
  const ev = o.ev;
  return {
    title: ev.title, date: o.src || ev.date, all_day: ev.all_day, start_time: ev.start_time, end_time: ev.end_time,
    location: ev.location, notes: ev.notes, repeat: ev.repeat, repeat_every: ev.repeat_every, repeat_until: ev.repeat_until,
    weekdays: ev.weekdays, end_date: ev.end_date, show_years: ev.show_years, who: ev.who, tz: ev.tz, remind: ev.reminders[db.me] || [],
    note: `Copied from “${ev.title}”. Change what's different, then press Save.`,
  };
}

// Read-only card: tapping an event only looks. Changing anything takes a deliberate press of Edit.
function openDetail(o) {
  const ev = o.ev, d = $('#detailDlg');
  const when = parse(o.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const time = ev.all_day ? 'All day' : `${fmtTime(o.start)}${o.end ? '–' + fmtTime(o.end) : ''}${o.from ? ` (${o.from})` : ''}`;
  const repeatBase = ev.repeat === 'weekly' && ev.repeat_every > 1 ? `Repeats every ${ev.repeat_every} weeks`
    : { daily: 'Repeats daily', weekly: 'Repeats weekly', monthly: 'Repeats monthly', yearly: 'Repeats yearly' }[ev.repeat];
  const repeatText = repeatBase && repeatBase + (ev.repeat === 'weekly' && ev.weekdays && ev.weekdays.length > 1 ? ' on ' + daysLabel(ev.weekdays) : '');
  const mins = ev.reminders[db.me] || [];
  const row = (label, value) => value ? el('div', { class: 'drow' }, el('span', { class: 'dlabel' }, label), el('span', {}, value)) : '';
  $('#detailBody').replaceChildren(
    el('h2', { class: 'dtitle', style: `--c:${colorOf(ev)}` }, ev.title),
    yearsLabel(ev, o.date) ? el('div', { class: 'dsub' }, yearsLabel(ev, o.date).replace(/^./, c => c.toUpperCase())) : '',
    row('When', (() => {
      if (!(o.span > 0)) return `${when} · ${time}`;
      const fmt = d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const sd = parse(o.startDate), ed = addDays(sd, o.span), tag = o.zoneTag ? ' ' + o.zoneTag : '';
      return `${fmt(sd)}${!ev.all_day && ev.start_time ? ' ' + fmtTime(ev.start_time) + tag : ''} → ${fmt(ed)}${!ev.all_day && ev.end_time ? ' ' + fmtTime(ev.end_time) + tag : ''} (${o.span + 1} days)`;
    })()),
    row('Who', ev.who.length ? ev.who.map(w => el('span', { class: 'dwho' }, el('span', { class: 'dot', style: `--c:${(member(w) || {}).color}` }), (member(w) || {}).name || '?')) : ''),
    row('Where', ev.location),
    row('Repeats', repeatText ? `${repeatText.replace('Repeats ', '')}${ev.repeat_until ? ' until ' + parse(ev.repeat_until).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''} · edits change the whole series` : ''),
    row('Reminders', mins.length ? mins.map(m => (REMIND_OPTS.find(r => r[0] === m) || [m, m + ' min'])[1] + (m ? ' before' : '')).join(', ') : ''),
    row('Notes', ev.notes));
  $('#detailEdit').onclick = () => { d.close(); openEvent(ev, o.date); };
  $('#detailDup').onclick = () => { d.close(); openEvent(null, null, duplicatePrefill(o)); };
  d.showModal();
}
$('#detailClose').onclick = () => $('#detailDlg').close();

function openEvent(ev, dateHint, prefill) {
  editing = ev || null;
  $('#dlgTitle').textContent = ev ? 'Edit event' : 'New event';
  $('#delBtn').style.display = ev ? '' : 'none';
  form.reset();
  const f = form.elements;
  f.title.value = ev ? ev.title : '';
  f.date.value = ev ? ev.date : (dateHint || ymd(new Date()));
  f.all_day.checked = ev ? ev.all_day : false;
  f.start_time.value = ev && ev.start_time || '09:00';
  f.end_time.value = ev && ev.end_time || '10:00';
  f.location.value = ev ? ev.location : '';
  setRepeatChoice(ev ? (ev.repeat === 'weekly' && ev.repeat_every > 1 ? `weekly:${ev.repeat_every}` : ev.repeat) : 'none');
  f.repeat_until.value = ev && ev.repeat_until || '';
  f.show_years.checked = ev ? !!ev.show_years : false;
  f.end_date.value = ev ? ev.end_date || '' : '';
  f.notes.value = ev ? ev.notes : '';
  // Quick add / link pre-fill: only fills the form. Nothing is saved until the person presses Save.
  const note = $('#prefillNote');
  note.hidden = !prefill;
  note.textContent = prefill ? prefill.note || '' : '';
  if (prefill) {
    if (prefill.title) f.title.value = prefill.title;
    if (prefill.date) f.date.value = prefill.date;
    if (prefill.all_day !== undefined) f.all_day.checked = prefill.all_day;
    if (prefill.start_time) f.start_time.value = prefill.start_time;
    if (prefill.end_time) f.end_time.value = prefill.end_time;
    if (prefill.location) f.location.value = prefill.location;
    if (prefill.repeat_until) f.repeat_until.value = prefill.repeat_until;
    if (prefill.end_date) f.end_date.value = prefill.end_date;
    if (prefill.repeat) setRepeatChoice(prefill.repeat === 'weekly' && prefill.repeat_every > 1 ? `weekly:${prefill.repeat_every}` : prefill.repeat);
    if (prefill.show_years) f.show_years.checked = true;
    if (prefill.notes) f.notes.value = prefill.notes;
  }
  selWho = new Set(ev ? ev.who : prefill && prefill.who ? prefill.who : [db.me]);
  selRemind = new Set(ev ? (ev.reminders[db.me] || []) : prefill && prefill.remind ? prefill.remind : me().defaultReminders);
  selDays = new Set(ev ? ev.weekdays || [] : prefill && prefill.weekdays || []);
  pillSet($('#whoBox'), db.members.map(m => [m.id, m.name]), selWho, id => member(id).color);
  pillSet($('#remindBox'), REMIND_OPTS, selRemind);
  $('#remindWho').textContent = `(for ${me().name})`;
  fillTzSelect(f.tz, ev && ev.tz || prefill && prefill.tz || myTz(), false);
  syncTimeFields();
  dlg.showModal();
}
function fillTzSelect(sel, current, withAuto) {
  const zones = TZ_LIST.map(([z]) => z);
  for (const z of [current, deviceTz]) if (z && !zones.includes(z)) zones.push(z);
  sel.replaceChildren(
    ...(withAuto ? [el('option', { value: '' }, `Automatic (this device: ${tzLabel(deviceTz)})`)] : []),
    ...zones.map(z => el('option', { value: z }, tzLabel(z))));
  sel.value = current || '';
}
// Shows what the entered time is in the viewer's own zone, e.g. "= 12pm–1pm for you (Central)".
function updateTzHint() {
  const f = form.elements, vz = myTz(), hint = $('#tzHint');
  hint.textContent = '';
  if (f.all_day.checked || !f.date.value || !f.start_time.value || f.tz.value === vz) return;
  const a = msToWall(wallToMs(f.date.value, f.start_time.value, f.tz.value), vz);
  let txt = fmtTime(a.time);
  if (f.end_time.value) txt += '–' + fmtTime(msToWall(wallToMs(f.date.value, f.end_time.value, f.tz.value), vz).time);
  if (a.date !== f.date.value) txt += ` (${parse(a.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })})`;
  hint.textContent = `= ${txt} for you (${tzLabel(vz)})`;
}
// The Repeats menu values are 'none' | 'daily' | 'weekly' | 'weekly:N' | 'monthly' | 'yearly'.
function setRepeatChoice(value) {
  const sel = form.elements.repeat;
  if (![...sel.options].some(o => o.value === value)) { // an interval saved some other way: show it rather than hide it
    const n = value.split(':')[1];
    sel.append(el('option', { value }, `Every ${n} weeks`));
  }
  sel.value = value;
}
// "Repeat on" day pills, for weekly repeats. The start date's own weekday is always part of the pattern (and locked),
// so the series always begins on the date that was picked.
function syncDays() {
  const rep = form.elements.repeat.value, row = $('#daysRow');
  // Not offered together with an end date: a multi-day stay repeats as a whole ("every other weekend"), not per chosen day.
  row.hidden = !(rep === 'weekly' || rep.startsWith('weekly:')) || !!form.elements.end_date.value;
  if (row.hidden) return;
  const dateStr = form.elements.date.value, dow = dateStr ? parse(dateStr).getDay() : -1;
  if (dow >= 0) selDays.add(dow);
  $('#daysBox').replaceChildren(...DOW.map((name, d) => {
    const locked = d === dow;
    const p = el('span', { class: 'pill' + (selDays.has(d) ? ' on' : '') + (locked ? ' locked' : ''), title: locked ? "The start date's weekday" : '' }, name);
    if (!locked) p.onclick = () => { selDays.has(d) ? selDays.delete(d) : selDays.add(d); p.classList.toggle('on'); };
    return p;
  }));
}
function syncYears() { $('#yearsRow').hidden = form.elements.repeat.value !== 'yearly'; }
form.elements.repeat.onchange = () => { syncYears(); syncDays(); };
// When the start date moves, the end date moves with it so a 3-day event stays 3 days. The end can never be before the start.
let lastDateValue = '';
function onDateChanged() {
  const f = form.elements, d = f.date.value;
  if (d && f.end_date.value && lastDateValue) {
    const span = Math.round((parse(f.end_date.value) - parse(lastDateValue)) / 864e5);
    if (span >= 0) f.end_date.value = ymd(addDays(parse(d), span));
  }
  if (d) lastDateValue = d;
  f.end_date.min = d || '';
}
function syncTimeFields() {
  lastDateValue = form.elements.date.value; form.elements.end_date.min = lastDateValue;
  syncYears();
  syncDays();
  const hide = form.elements.all_day.checked ? 'none' : '';
  $('#timeRow').style.display = hide; $('#tzRow').style.display = hide;
  updateTzHint();
}
form.elements.all_day.onchange = syncTimeFields;
form.addEventListener('input', e => { updateTzHint(); if (e.target.name === 'date') { onDateChanged(); syncDays(); } if (e.target.name === 'end_date') syncDays(); });
// + opens a small menu (not the form directly), so adding is always a deliberate two-step act.
$('#fab').onclick = () => $('#addMenu').showModal();
$('#addCancel').onclick = () => $('#addMenu').close();
$('#addNew').onclick = () => { $('#addMenu').close(); openEvent(null, view === 'week' ? ymd(weekStart) : null); };
$('#addQuick').onclick = () => { $('#addMenu').close(); $('#quickText').value = ''; $('#quickErr').textContent = ''; $('#quickDlg').showModal(); $('#quickText').focus(); };
$('#quickCancel').onclick = () => $('#quickDlg').close();
$('#quickPaste').onclick = async () => {
  try { $('#quickText').value = await navigator.clipboard.readText(); }
  catch { $('#quickErr').textContent = "Couldn't read the clipboard. Long-press in the box and choose Paste instead."; }
};
$('#quickForm').onsubmit = async e => {
  e.preventDefault();
  const text = $('#quickText').value.trim();
  if (!text) { $('#quickErr').textContent = 'Type or paste something first.'; return; }
  try { await runQuick(text); $('#quickDlg').close(); }
  catch (x) { console.error(x); $('#quickErr').textContent = "Couldn't load the date reader. Check your connection and try again."; }
};

// The date reader (about 200 KB) is only fetched the first time someone uses Quick add.
let chronoLoading = null;
function loadChrono() {
  if (window.chrono) return Promise.resolve();
  return chronoLoading ||= new Promise((resolve, reject) => {
    const s = el('script', { src: 'vendor/chrono-2.5.0.js?v=20' });
    s.onload = resolve;
    s.onerror = () => { chronoLoading = null; reject(new Error('chrono failed to load')); };
    document.head.append(s);
  });
}
async function runQuick(text) {
  await loadChrono();
  const r = parseQuick(text, new Date(), window.chrono);
  const warn = [];
  if (!r.found.date) warn.push('No date found, so today is filled in.');
  if (!r.found.time) warn.push('No time found, so this is set to all day.');
  if (r.end_date) warn.push(`Runs through ${parse(r.end_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}.`);
  if (r.weekdays) warn.push(`Set to repeat ${r.repeat_every > 1 ? `every ${r.repeat_every} weeks ` : ''}on ${daysLabel(r.weekdays)}.`);
  else if (r.repeat === 'weekly') warn.push(r.repeat_every > 1 ? `Set to repeat every ${r.repeat_every} weeks.` : 'Set to repeat weekly.');
  if (r.repeat === 'yearly') warn.push(r.show_years ? 'Set to repeat every year and count the years.' : 'Set to repeat every year.');
  openEvent(null, null, { ...r, note: 'Filled in from your text. ' + (warn.join(' ') || 'Check the date and time before saving.') });
}

// Links like /?quick=Dentist%20Thursday%202pm or /?title=Dentist&date=2026-10-08&time=14:00 open the form pre-filled
// (used by iPhone Shortcuts). Link contents are untrusted: they're validated, and they never save anything.
let pendingAdd = null;
function pendingFromParams(q) {
  const quick = (q.get('quick') || '').slice(0, 2000);
  if (quick.trim()) return { quick };
  const title = (q.get('title') || '').trim().slice(0, 200), date = q.get('date') || '', time = q.get('time') || '', end = q.get('end') || '';
  if (!title && !date && !time) return null;
  const okTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const p = { title, location: (q.get('location') || '').slice(0, 200), notes: (q.get('notes') || '').slice(0, 2000), note: 'Filled in from a link. Check everything before saving.' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) p.date = date;
  if (okTime(time)) {
    p.all_day = false; p.start_time = time;
    p.end_time = okTime(end) ? end : +time.slice(0, 2) >= 23 ? '23:59' : `${pad(+time.slice(0, 2) + 1)}:${time.slice(3)}`; // default one hour, never past midnight
  }
  return p;
}
async function consumePending() {
  const p = pendingAdd; pendingAdd = null;
  if (!p) return;
  try { if (p.quick) await runQuick(p.quick); else openEvent(null, null, p); }
  catch (e) { console.error(e); toast("Couldn't read that. Use + → Quick add instead."); }
}
$('#cancelBtn').onclick = () => dlg.close();

form.onsubmit = e => {
  e.preventDefault();
  const f = form.elements;
  const ev = editing || { id: uuid(), reminders: {}, created_by: db.me, deleted_at: null };
  Object.assign(ev, {
    title: f.title.value.trim(), date: f.date.value, all_day: f.all_day.checked,
    start_time: f.all_day.checked ? '' : f.start_time.value, end_time: f.all_day.checked ? '' : f.end_time.value,
    location: f.location.value.trim(), repeat: f.repeat.value.split(':')[0], repeat_until: f.repeat_until.value,
    notes: f.notes.value.trim(), who: [...selWho], tz: f.tz.value,
  });
  // Only ever send show_years once it's in play (ticked, or already stored), so saving works before the database column exists.
  // Same tolerance as show_years: only send repeat_every once it matters (above 1) or the column is known to exist.
  const every = f.repeat.value.startsWith('weekly:') ? +f.repeat.value.split(':')[1] : 1;
  if (every > 1 || ev.repeat_every !== undefined) ev.repeat_every = every;
  const endDate = f.end_date.value && f.end_date.value > f.date.value ? f.end_date.value : '';
  if (f.end_date.value && !endDate && f.end_date.value < f.date.value) toast('The end date was before the start, so it was ignored.');
  if (endDate || ev.end_date !== undefined) ev.end_date = endDate; // same tolerance as the columns above
  const weeklyRepeat = f.repeat.value === 'weekly' || f.repeat.value.startsWith('weekly:');
  if (weeklyRepeat) selDays.add(parse(f.date.value).getDay());
  const days = weeklyRepeat && !endDate && selDays.size > 1 ? [...selDays].sort((a, b) => a - b) : null; // one day = just the start date's weekday
  if (days || ev.weekdays !== undefined) ev.weekdays = days; // same tolerance as the columns above
  const wantYears = f.repeat.value === 'yearly' && f.show_years.checked;
  if (wantYears || ev.show_years !== undefined) ev.show_years = wantYears;
  ev.reminders[db.me] = [...selRemind].sort((a, b) => a - b);
  if (!editing) db.events.push(ev);
  dlg.close(); render();
  persist(() => store.saveEvent(ev));
};

$('#delBtn').onclick = () => {
  const msg = editing.repeat !== 'none' ? 'Delete this whole repeating series? (It goes to Trash for 30 days.)' : 'Delete this event? (It goes to Trash for 30 days.)';
  if (!confirm(msg)) return;
  const ev = editing;
  ev.deleted_at = new Date().toISOString();
  dlg.close(); render();
  persist(() => store.setDeleted(ev, ev.deleted_at));
};

// ---------- settings ----------
const menu = $('#menuDlg');
let defSel = new Set();

function renderMenu() {
  $('#meName').textContent = me().name;
  const tzSel = $('#myTz');
  fillTzSelect(tzSel, me().tz || '', true);
  const tfSel = $('#timeFmt');
  tfSel.value = me().time_format === '24' ? '24' : '12';
  tfSel.onchange = () => { me().time_format = tfSel.value; hour24 = tfSel.value === '24'; persist(() => store.saveMember(me())); render(); };
  const spicyBox = $('#spicyBox');
  spicyBox.checked = spicyOn();
  spicyBox.onchange = () => { setSpicy(spicyBox.checked); renderMotd(); };
  tzSel.onchange = () => { me().tz = tzSel.value || null; persist(() => store.saveMember(me())); render(); };

  defSel = new Set(me().defaultReminders);
  pillSet($('#defaultRemind'), REMIND_OPTS, defSel);
  $('#defaultRemind').onclick = () => { me().defaultReminders = [...defSel].sort((a, b) => a - b); persist(() => store.saveMember(me())); };

  $('#peopleList').replaceChildren(...db.members.map(m => el('div', { class: 'person' },
    el('input', { type: 'color', value: m.color, onchange: e => { m.color = e.target.value; persist(() => store.saveMember(m)); render(); } }),
    el('input', { type: 'text', value: m.name, onchange: e => { m.name = e.target.value.trim() || m.name; persist(() => store.saveMember(m)); renderMenu(); render(); } }))));

  const trashed = db.events.filter(e => e.deleted_at);
  $('#trashCount').textContent = trashed.length;
  $('#trashList').replaceChildren(...trashed.map(ev => el('div', { class: 'trash-row' },
    el('span', {}, `${ev.title} (${ev.date})`),
    el('span', {},
      el('button', { onclick: () => { ev.deleted_at = null; persist(() => store.setDeleted(ev, null)); renderMenu(); render(); } }, 'Restore'),
      el('button', { class: 'danger', onclick: () => {
        if (!confirm('Permanently delete?')) return;
        db.events = db.events.filter(x => x !== ev); persist(() => store.hardDelete(ev)); renderMenu();
      } }, 'Delete forever')))));
  $('#trashList').hidden = true;
  $('#inviteOut').hidden = true;
  renderPushStatus();
}
$('#menuBtn').onclick = () => { renderMenu(); menu.showModal(); };

// ---------- push notifications ----------
const b64ToBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
async function saveSub(sub, userId) {
  const j = sub.toJSON();
  await run(sb.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, tz: deviceTz }, { onConflict: 'endpoint' }));
}
// Keep this device's stored time zone current (it decides what local time reminders show).
async function syncPushDevice(userId) {
  try { const sub = await currentSub(); if (sub && Notification.permission === 'granted') await saveSub(sub, userId); }
  catch (e) { console.error(e); }
}
const APP_BUILD = 'v20';
// One line of plain-text device state, so "it doesn't work" can be diagnosed without guessing.
async function showPushDiag() {
  const parts = [`build ${APP_BUILD}`, `Home Screen app: ${isStandalone() ? 'yes' : 'no'}`];
  if (pushSupported()) {
    parts.push(`permission: ${Notification.permission}`);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      parts.push(`service worker: ${reg ? (reg.active ? 'active' : reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'none') : 'not registered'}`);
      parts.push(`subscribed: ${reg && await reg.pushManager.getSubscription() ? 'yes' : 'no'}`);
    } catch (e) { parts.push('check failed: ' + e.message); }
  } else parts.push('push not available here');
  $('#pushDiag').textContent = parts.join(' · ');
}
async function renderPushStatus() {
  const status = $('#pushStatus'), on = $('#pushOn'), test = $('#pushTest');
  on.hidden = true; test.hidden = true;
  showPushDiag();
  if (!pushSupported()) {
    status.textContent = isIOS && !isStandalone()
      ? 'On iPhone, first add this app to your Home Screen (Share → Add to Home Screen), then open it from there to turn on notifications.'
      : "This browser doesn't support notifications.";
    return;
  }
  if (Notification.permission === 'denied') { status.textContent = 'Notifications are blocked for this app. Re-enable them in your device settings.'; return; }
  const sub = await currentSub();
  if (sub && Notification.permission === 'granted') { status.textContent = '✓ On for this device.'; test.hidden = false; }
  else { status.textContent = 'Off for this device.'; on.hidden = false; }
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
$('#pushOn').onclick = async () => {
  let stage = 'asking permission';
  $('#pushStatus').textContent = 'Working…'; $('#pushOn').disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { await renderPushStatus(); $('#pushStatus').textContent += ` Permission result was "${perm}", so nothing was turned on.`; return; }
    stage = 'starting the background service';
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register('sw.js');
    await withTimeout(navigator.serviceWorker.ready, 8000, 'Background service');
    stage = 'registering with the push service';
    const sub = await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(FAMCAL_CONFIG.vapidPublicKey) }), 15000, 'Push registration');
    stage = 'saving this device to the calendar';
    try {
      const { data: { session } } = await sb.auth.getSession();
      await saveSub(sub, session.user.id);
    } catch (e) { await sub.unsubscribe(); throw e; } // don't leave a half-registered device that looks "on"
    toast('Notifications on');
    renderPushStatus();
  } catch (e) {
    console.error(e);
    await renderPushStatus();
    $('#pushStatus').textContent += ` ⚠ Failed while ${stage}: ${e.message || e}`;
  } finally { $('#pushOn').disabled = false; }
};
$('#pushTest').onclick = async () => {
  const status = $('#pushStatus');
  status.textContent = 'Sending test…';
  const { data, error } = await sb.functions.invoke('send-reminders', { body: { test: true } });
  if (error && error.name === 'FunctionsFetchError') {
    status.textContent = '✓ On for this device. The test was sent, but the reply was blocked by the browser. If a notification arrived, it worked.';
    return;
  }
  if (error) {
    let detail = error.message;
    try { const body = await error.context.json(); detail = body.error || body.message || JSON.stringify(body); } catch { /* keep generic message */ }
    status.textContent = `✓ On for this device. ⚠ Test failed: ${detail}`;
    return;
  }
  status.textContent = data.sent
    ? '✓ On for this device. Test sent — a notification should appear in a few seconds.'
    : `✓ On for this device. ⚠ The server found ${data.devices} device(s) but none accepted the message. Try turning notifications off and on again.`;
};
$('#closeMenu').onclick = () => { menu.close(); render(); };
$('#trashBtn').onclick = () => { $('#trashList').hidden = !$('#trashList').hidden; };
$('#addPerson').onclick = async () => {
  const name = prompt('Name? (For someone without their own login, like a young kid. To add a person with a phone, use "Invite someone".)');
  if (!name || !name.trim()) return;
  try {
    db.members.push(await store.addMember(name.trim(), COLORS[db.members.length % COLORS.length]));
    renderMenu(); render();
  } catch (e) { console.error(e); toast('Could not add person.'); }
};
$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `family-calendar-${ymd(new Date())}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};
$('#inviteBtn').onclick = async () => {
  try {
    const code = await run(sb.rpc('create_invite', { fid: db.familyId }));
    $('#inviteLink').value = `${location.origin}${location.pathname}?invite=${code}`;
    $('#inviteOut').hidden = false;
    if (navigator.share) navigator.share({ title: 'Join our family calendar', url: $('#inviteLink').value }).catch(() => {});
  } catch (e) { console.error(e); toast('Could not create invite.'); }
};
$('#copyInvite').onclick = async () => {
  try { await navigator.clipboard.writeText($('#inviteLink').value); toast('Link copied'); }
  catch { $('#inviteLink').select(); }
};
$('#signOut').onclick = async () => { if (confirm('Sign out on this device?')) { await sb.auth.signOut(); } };

// ---------- sign-in gate ----------
const gate = $('#gate');
function showGate(...nodes) {
  gate.replaceChildren(el('div', { class: 'box' }, ...nodes));
  gate.hidden = false;
  document.body.style.overflow = 'hidden';
}
function hideGate() { gate.hidden = true; document.body.style.overflow = ''; }
const errBox = () => el('div', { class: 'err', role: 'alert' });

function showLogin(mode = 'signin', email = '') {
  const invited = localStorage.getItem(INVITE_KEY);
  const creating = mode === 'signup';
  const err = errBox();
  const emailIn = el('input', { type: 'email', required: '', autocomplete: 'email', inputmode: 'email', value: email });
  const passIn = el('input', { type: 'password', required: '', minlength: '8', autocomplete: creating ? 'new-password' : 'current-password' });
  const f = el('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    const creds = { email: emailIn.value.trim(), password: passIn.value };
    const { data, error } = creating ? await sb.auth.signUp(creds) : await sb.auth.signInWithPassword(creds);
    if (error) { err.textContent = /invalid login/i.test(error.message) ? 'Wrong email or password.' : error.message; return; }
    if (creating && !data.session) err.textContent = 'Account created, but email confirmation is still turned on in Supabase. Confirm via the email, then sign in.';
    // otherwise onAuthStateChange takes it from here
  } },
    el('label', {}, 'Email', emailIn),
    el('label', {}, creating ? 'Choose a password (8+ characters)' : 'Password', passIn),
    err,
    el('button', { class: 'primary', type: 'submit' }, creating ? 'Create account' : 'Sign in'));
  showGate(
    el('h1', {}, 'Family Calendar'),
    el('p', {}, invited ? "You've been invited! Create an account (or sign in) to join." : creating ? 'Create your account.' : 'Sign in to see the family calendar.'),
    f,
    el('p', { class: 'alt' }, el('button', { class: 'link', onclick: () => showLogin(creating ? 'signin' : 'signup', emailIn.value) },
      creating ? 'I already have an account' : 'New here? Create an account')));
}

function showOnboarding() {
  const invite = localStorage.getItem(INVITE_KEY) || '';
  const err = errBox();
  const joinName = el('input', { required: '', autocomplete: 'given-name' });
  const joinCode = el('input', { required: '', autocomplete: 'off', value: invite, placeholder: 'Paste your invite code' });
  const joinForm = el('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try {
      await run(sb.rpc('join_family', { invite_code: joinCode.value.trim().replace(/.*invite=/, ''), my_name: joinName.value.trim(), my_color: COLORS[1] }));
      localStorage.removeItem(INVITE_KEY); await start();
    } catch (x) { err.textContent = /invalid|expired/.test(x.message) ? 'That invite is invalid or has expired. Ask for a new one.' : x.message; }
  } }, el('label', {}, 'Your name', joinName), el('label', {}, 'Invite code or link', joinCode), el('button', { class: 'primary', type: 'submit' }, 'Join family'));

  const err2 = errBox();
  const famName = el('input', { required: '', value: 'Our Family' });
  const myName = el('input', { required: '', autocomplete: 'given-name' });
  const createForm = el('form', { onsubmit: async e => {
    e.preventDefault(); err2.textContent = '';
    try {
      await run(sb.rpc('create_family', { family_name: famName.value.trim(), my_name: myName.value.trim(), my_color: COLORS[0] }));
      await start();
    } catch (x) { err2.textContent = x.message; }
  } }, el('label', {}, 'Family name', famName), el('label', {}, 'Your name', myName), err2, el('button', { class: 'primary', type: 'submit' }, 'Create family'));

  showGate(
    el('h1', {}, 'Welcome!'),
    invite ? [el('p', {}, 'You have an invite. Enter your name to join.'), joinForm, err] : [
      el('p', {}, 'Start a new family calendar:'), createForm,
      el('hr'),
      el('p', {}, 'Or join one you were invited to:'), joinForm, err]);
}

// ---------- boot ----------
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { db = null; return showLogin(localStorage.getItem(INVITE_KEY) ? "signup" : "signin"); }
  try {
    if (await store.load(session.user.id)) { hideGate(); render(); consumePending(); }
    else showOnboarding();
  } catch (e) {
    console.error(e);
    showGate(el('h1', {}, 'Can’t reach the calendar'), el('p', {}, 'Check your connection and try again.'), el('button', { class: 'primary', onclick: start }, 'Retry'));
  }
}

(function boot() {
  const params = new URLSearchParams(location.search);
  const code = params.get('invite');
  pendingAdd = pendingFromParams(params);
  if (code) localStorage.setItem(INVITE_KEY, code);
  if (code || pendingAdd) history.replaceState(null, '', location.pathname);
  if (!window.supabase || !window.FAMCAL_CONFIG) {
    showGate(el('h1', {}, 'Can’t load'), el('p', {}, 'The app couldn’t load its sign-in library. Check your connection and reload.'));
    return;
  }
  sb = supabase.createClient(FAMCAL_CONFIG.url, FAMCAL_CONFIG.key);
  sb.auth.onAuthStateChange((event) => {
    // Deferred: supabase must not be called from inside its own callback.
    // INITIAL_SESSION fires once on load; SIGNED_IN also re-fires on tab refocus, so only act on it before data is loaded.
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && !db)) setTimeout(start, 0);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && db) refresh(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
