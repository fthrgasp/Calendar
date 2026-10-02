// Quick add: turns free text ("Sam's game Oct 17 at 4") into event form values.
// Pure function around the vendored chrono date parser, so it can be tested outside the browser.
// The form always shows the result for the user to confirm; nothing is saved from here.
'use strict';

function parseQuick(text, now, chrono) {
  const original = String(text || '').trim();
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const result = { title: '', notes: '', date: '', all_day: true, start_time: '', end_time: '', repeat: 'none', show_years: false, found: { date: false, time: false } };
  if (/\b(birthday|bday|b-day|anniversary|every year|yearly|annually)\b/i.test(original)) result.repeat = 'yearly';
  if (!original) return result;

  // Blank out matched phrases as we use them, so what's left is the title.
  let rest = original;
  const cut = (index, length) => { rest = rest.slice(0, index) + ' '.repeat(length) + rest.slice(index + length); };

  const hits = chrono.parse(original, now, { forwardDate: true });
  let dateHit = null, timeHit = null;
  for (const h of hits) {
    const s = h.start;
    const hasDate = s.isCertain('day') || s.isCertain('weekday') || s.isCertain('month');
    if (hasDate && !dateHit) dateHit = h;
    if (s.isCertain('hour') && !timeHit) timeHit = h;
  }

  let date = null;
  if (dateHit) { date = new Date(dateHit.start.date()); cut(dateHit.index, dateHit.text.length); }

  // "on the 14th": chrono ignores a bare day-of-month, so handle it here.
  if (!date) {
    const m = rest.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i);
    if (m && +m[1] >= 1 && +m[1] <= 31) {
      let d = new Date(now.getFullYear(), now.getMonth(), +m[1]);
      if (d.getDate() !== +m[1] || d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        d = new Date(now.getFullYear(), now.getMonth() + 1, +m[1]);
        if (d.getDate() !== +m[1]) d = null; // next month is too short for that day
      }
      if (d) { date = d; cut(m.index, m[0].length); }
    }
  }

  // Time of day.
  let hour = null, minute = 0, endHour = null, endMinute = 0;
  if (timeHit) {
    const s = timeHit.start;
    hour = s.get('hour'); minute = s.get('minute') || 0;
    if (!s.isCertain('meridiem') && hour >= 1 && hour <= 12) hour = hour === 12 ? 12 : hour <= 7 ? hour + 12 : hour; // bare "at 4" means 4pm, "at 9" means 9am
    if (timeHit.end && timeHit.end.isCertain('hour')) {
      endHour = timeHit.end.get('hour'); endMinute = timeHit.end.get('minute') || 0;
      if (!timeHit.end.isCertain('meridiem') && endHour >= 1 && endHour <= 7) endHour += 12;
    }
    // If the time came from a different phrase than the date, remove it too.
    if (timeHit !== dateHit) cut(timeHit.index, timeHit.text.length);
  } else if (/\bnoon\b/i.test(original)) { hour = 12; rest = rest.replace(/\bnoon\b/i, ' '); }
  else if (/\bmidnight\b/i.test(original)) { hour = 0; rest = rest.replace(/\bmidnight\b/i, ' '); }

  // "saturday 7": a bare number straight after the date phrase.
  if (hour === null && dateHit) {
    const after = original.slice(dateHit.index + dateHit.text.length).match(/^\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?(?!\s*(?:st|nd|rd|th|\/|-|\d|%|:))\b/i);
    if (after && +after[1] >= 1 && +after[1] <= 12) {
      hour = +after[1]; minute = after[2] ? +after[2] : 0;
      if (hour <= 7) hour += 12;
      const at = dateHit.index + dateHit.text.length;
      cut(at, after[0].length);
    }
  }

  // A birthday/anniversary typed with its real past year ("Gabby birthday 10/5/1990") counts the years.
  if (result.repeat === 'yearly' && dateHit && dateHit.start.isCertain('year') && date.getFullYear() < now.getFullYear()) result.show_years = true;
  result.found.date = !!date;
  result.found.time = hour !== null;
  if (!date) date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  result.date = ymd(date);
  if (hour !== null) {
    result.all_day = false;
    result.start_time = hhmm(hour, minute);
    if (endHour !== null) result.end_time = hhmm(endHour, endMinute);
    else result.end_time = hour >= 23 ? '23:59' : hhmm(hour + 1, minute); // default one hour, never past midnight
  }

  // Title: what's left after the date/time phrases are removed.
  const tidy = t => t.replace(/\s+/g, ' ').trim()
    .replace(/^(?:at|on|@|-|,|:|from|by)\s+/i, '').replace(/\s+(?:at|on|@|-|,|:|from|by)$/i, '')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '');
  let title = tidy(rest) || 'Event';
  if (original.includes('\n') || original.length > 80) {
    // A pasted message: keep it all in the notes and use its first meaningful line as a short title.
    const first = rest.split('\n').map(tidy).find(Boolean) || 'Event';
    title = first.length > 60 ? first.slice(0, 57).trimEnd() + '…' : first;
    result.notes = original;
  }
  result.title = title;
  return result;
}

if (typeof module !== 'undefined') module.exports = { parseQuick };
