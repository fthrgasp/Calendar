// Repeats, every-N-weeks, weekday picks, multi-day stays, and single-day exceptions (skip / change / move).
const { appCalendar, ok, done } = require('./_load');
const { occurrences, parse } = appCalendar();
const D = (ev, a, b) => occurrences(ev, parse(a), parse(b)).map(o => o.date + (o.exception ? '*' : '')).join(' ');
const X = (orig, o = {}) => ({ original_date: orig, skipped: false, new_date: null, title: null, start_time: null, end_time: null, all_day: null, location: null, notes: null, ...o });
const mk = (o = {}) => ({ repeat: 'none', repeat_every: 1, weekdays: null, end_date: '', repeat_until: '', all_day: false, start_time: '07:00', end_time: '15:00', title: 'Work', location: '', notes: '', id: 'w', exceptions: [], ...o });

// every N weeks
ok(D(mk({ date: '2026-10-05', repeat: 'weekly', repeat_every: 2 }), '2026-10-01', '2026-11-16') === '2026-10-05 2026-10-19 2026-11-02 2026-11-16', 'every 2 weeks');
ok(D(mk({ date: '2026-01-05', repeat: 'weekly', repeat_every: 4 }), '2026-10-01', '2026-12-31') === '2026-10-12 2026-11-09 2026-12-07', 'every 4 weeks, far from the start date');
// weekday picks
const work = mk({ date: '2026-10-05', repeat: 'weekly', repeat_every: 2, weekdays: [1, 2, 3, 4, 5] });
ok(D(work, '2026-10-01', '2026-10-31') === '2026-10-05 2026-10-06 2026-10-07 2026-10-08 2026-10-09 2026-10-19 2026-10-20 2026-10-21 2026-10-22 2026-10-23', 'Mon-Fri every 2 weeks');
ok(D(mk({ date: '2026-10-07', repeat: 'weekly', weekdays: [1, 3] }), '2026-10-01', '2026-10-21') === '2026-10-07 2026-10-12 2026-10-14 2026-10-19 2026-10-21', 'weekday picks starting mid-week skip the days before the start');
// multi-day stays
const stay = mk({ id: 's', date: '2026-10-09', end_date: '2026-10-11', all_day: true, repeat: 'weekly', repeat_every: 2, start_time: '', end_time: '' });
ok(D(stay, '2026-10-01', '2026-10-31') === '2026-10-09 2026-10-10 2026-10-11 2026-10-23 2026-10-24 2026-10-25', 'every other weekend, Fri-Sun');
ok(D(stay, '2026-10-24', '2026-10-26') === '2026-10-24 2026-10-25', 'a window opening mid-stay still shows the rest of it');
ok(D(mk({ date: '2026-12-30', end_date: '2027-01-02', all_day: true }), '2026-12-01', '2027-01-31') === '2026-12-30 2026-12-31 2027-01-01 2027-01-02', 'a stay across a year boundary');
// yearly + Feb 29
ok(D(mk({ date: '2024-02-29', repeat: 'yearly', all_day: true }), '2025-01-01', '2029-12-31') === '2025-02-28 2026-02-28 2027-02-28 2028-02-29 2029-02-28', 'Feb 29 lands on Feb 28 in non-leap years');
// exceptions
ok(D({ ...work, exceptions: [X('2026-10-07', { skipped: true })] }, '2026-10-05', '2026-10-09') === '2026-10-05 2026-10-06 2026-10-08 2026-10-09', 'skip one day');
let o = occurrences({ ...work, exceptions: [X('2026-10-08', { start_time: '10:00', title: 'Work (late)' })] }, parse('2026-10-08'), parse('2026-10-08'))[0];
ok(o.ev.start_time === '10:00' && o.ev.title === 'Work (late)' && o.series.start_time === '07:00' && o.ev.end_time === '15:00', 'changed day shows its own values, inherits the rest, leaves the series alone');
const moved = { ...work, exceptions: [X('2026-10-06', { new_date: '2026-10-10' })] };
ok(D(moved, '2026-10-05', '2026-10-12') === '2026-10-05 2026-10-07 2026-10-08 2026-10-09 2026-10-10*', 'moved day leaves the old date and appears on the new one, in date order');
ok(D(moved, '2026-10-10', '2026-10-12') === '2026-10-10*', 'a day moved INTO a window from outside it shows up');
ok(D(moved, '2026-10-05', '2026-10-07') === '2026-10-05 2026-10-07', 'a day moved OUT of the window disappears');
ok(D({ ...work, exceptions: [X('2026-10-10', { start_time: '09:00' }), X('2026-10-13', { skipped: true })] }, '2026-10-01', '2026-10-31') === D(work, '2026-10-01', '2026-10-31'), 'leftover changes for days the series does not have are ignored');
ok(D(mk({ date: '2026-10-09', exceptions: [X('2026-10-09', { skipped: true })] }), '2026-10-01', '2026-10-31') === '2026-10-09', 'exceptions on a non-repeating event are ignored');
ok(D({ ...stay, exceptions: [X('2026-10-09', { skipped: true })] }, '2026-10-01', '2026-10-31') === '2026-10-23 2026-10-24 2026-10-25', 'skipping a stay removes all its days');
ok(D({ ...stay, exceptions: [X('2026-10-09', { new_date: '2026-10-10' })] }, '2026-10-01', '2026-10-31') === '2026-10-10* 2026-10-11* 2026-10-12* 2026-10-23 2026-10-24 2026-10-25', 'moving a stay moves the whole run');
done('calendar logic');
