// Builds a sample .ics from the feed function plus what the app's own logic says each event should be.
// tests/feed/verify.py then checks the two agree, using an independent calendar library.
const { appCalendar, feedCore } = require('../_load');
const app = appCalendar(), feed = feedCore();
const M = [{ id: 'b', name: 'b.' }, { id: 'g', name: 'Gabby' }];
const base = { repeat: 'none', repeat_every: 1, weekdays: null, end_date: '', repeat_until: '', all_day: false, start_time: '', end_time: '', location: '', notes: '', tz: null, who: ['b', 'g'], created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T12:00:00Z' };
const X = (event_id, orig, o = {}) => ({ event_id, original_date: orig, skipped: false, new_date: null, title: null, start_time: null, end_time: null, all_day: null, location: null, notes: null, ...o });
const E = [
  { ...base, id: 'e1', title: 'Work', date: '2026-10-05', start_time: '07:00:00', end_time: '15:00:00', tz: 'America/New_York', repeat: 'weekly', repeat_every: 2, weekdays: [1, 2, 3, 4, 5], who: ['g'], location: 'Plant 2' },
  { ...base, id: 'e2', title: 'Trash day', date: '2026-10-06', all_day: true, repeat: 'weekly' },
  { ...base, id: 'e6', title: "Kid at dad's", date: '2026-10-09', end_date: '2026-10-11', all_day: true, repeat: 'weekly', repeat_every: 2, who: ['g'] },
  { ...base, id: 'e8', title: 'Standup', date: '2026-10-05', start_time: '09:00:00', end_time: '09:15:00', tz: 'America/Chicago', repeat: 'daily', repeat_until: '2026-10-16' },
  { ...base, id: 'e9', title: 'Floating', date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00', repeat: 'weekly' },
  { ...base, id: 'e10', title: 'Plain', date: '2026-10-07', start_time: '12:00:00', end_time: '13:00:00', tz: 'America/Chicago', repeat: 'weekly' },
  { ...base, id: 'e11', title: 'One-off', date: '2026-10-09', start_time: '12:00:00', end_time: '13:00:00', tz: 'America/Chicago' },
  { ...base, id: 'e12', title: 'Yearly', date: '2024-02-29', all_day: true, repeat: 'yearly' },
];
const EX = [
  X('e1', '2026-10-07', { skipped: true }), X('e1', '2026-10-08', { start_time: '10:00:00', end_time: '18:00:00', title: 'Work late', location: 'Plant 5' }),
  X('e1', '2026-10-06', { new_date: '2026-10-10', start_time: '08:00:00' }), X('e1', '2026-10-10', { start_time: '09:00:00' }),
  X('e2', '2026-10-13', { skipped: true }), X('e2', '2026-10-20', { title: 'Trash day HOLIDAY' }),
  X('e6', '2026-10-23', { skipped: true }), X('e6', '2026-10-09', { new_date: '2026-10-10' }),
  X('e8', '2026-10-08', { skipped: true }), X('e8', '2026-10-12', { start_time: '14:00:00', end_time: '14:15:00' }),
  X('e9', '2026-10-13', { skipped: true }), X('e9', '2026-10-20', { all_day: true }), X('e11', '2026-10-09', { skipped: true }),
];
const win = ['2026-10-01', '2029-03-31'];
const expected = {};
for (const e of E) expected[e.id] = app.occurrences({ ...e, exceptions: EX.filter(x => x.event_id === e.id) }, app.parse(win[0]), app.parse(win[1]))
  .map(o => [o.date, (o.span ? o.day === 0 : true) && !o.ev.all_day ? (o.ev.start_time || '').slice(0, 5) : '', o.ev.title]);
process.stdout.write(JSON.stringify({ ics: feed.buildCalendar(E, M, EX), expected, window: win }));
