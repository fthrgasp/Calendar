// Loads the pure logic out of the app and the Supabase functions so it can be tested without a browser or a database.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b));

// calendar logic from app.js: repeats, every-N-weeks, weekday picks, multi-day stays, single-day exceptions
exports.appCalendar = () => {
  const app = read('app.js');
  const helpers = ['pad', 'ymd', 'parse', 'addDays'].map(n => app.match(new RegExp(`const ${n} = .*\\n`))[0]).join('');
  const code = helpers + between(app, 'function occurrenceStarts', '// ---------- state ----------');
  return new Function(code + '; return { occurrences, occurrenceStarts, parse, ymd, addDays, spanDays };')();
};
// the reminder function's core
exports.reminderCore = () => {
  const src = read('supabase/functions/send-reminders/index.ts');
  const core = between(src, '// <core>', '// </core>');
  return new Function(core + '; return { computeDue, describe, occurrenceDates, effectiveStarts, wallToMs, parseD, fmtD };')();
};
// the calendar feed's core
exports.feedCore = () => {
  const src = read('supabase/functions/calendar-feed/index.ts');
  const core = between(src, '// <core>', '// </core>');
  return new Function(core + '; return { buildCalendar };')();
};
// the message-of-the-day deck
exports.motdDeck = () => {
  const app = read('app.js'), motd = read('motd.js');
  const hs = app.match(/function hashStr.*\n/)[0], po = app.match(/const poolOf = .*\n/)[0];
  const deck = between(app, 'const CUSTOM_BOOST', '// Returns { text, by }');
  return new Function('let db; const window = {};\n' + motd + '\n' + hs + po + deck +
    '; return { window, generalPool, cycleLine, poolOf, setDb: v => { db = v; } };')();
};
let failed = 0, passed = 0;
exports.ok = (cond, msg) => { cond ? passed++ : failed++; console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
exports.done = name => { console.log(`\n${name}: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); };
