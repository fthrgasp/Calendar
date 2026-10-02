// Quick add: turns free text ("Sam's game Oct 17 at 4") into event form values.
// Pure function around the vendored chrono date parser, so it can be tested outside the browser.
// The form always shows the result for the user to confirm; nothing is saved from here.
'use strict';

function parseQuick(text, now, chrono) {
  const original = String(text || '').trim();
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const result = { title: '', notes: '', date: '', all_day: true, start_time: '', end_time: '', repeat: 'none', show_years: false, repeat_every: 1, weekdays: null, end_date: '', found: { date: false, time: false } };
  if (/\b(birthday|bday|b-day|anniversary|every year|yearly|annually)\b/i.test(original)) result.repeat = 'yearly';
  if (!original) return result;

  // "every 2 weeks" / "biweekly" / "every other week": set the repeat, then blank the phrase so the date reader doesn't take it for a date.
  let work = original;
  const everyRe = /\b(?:every\s+(?:other|second|2|two|3|three|4|four)\s+weeks?|bi-?weekly|every\s+week|weekly)\b/i;
  const em = original.match(everyRe);
  if (em) {
    const t = em[0].toLowerCase();
    result.repeat = 'weekly';
    result.repeat_every = /other|second|\b2\b|two|bi-?weekly/.test(t) ? 2 : /\b3\b|three/.test(t) ? 3 : /\b4\b|four/.test(t) ? 4 : 1;
    work = work.slice(0, em.index) + ' '.repeat(em[0].length) + work.slice(em.index + em[0].length);
  }
  // "every other weekend" / "every weekend" / "alternate weekends": a weekly repeat of a Saturday-Sunday stay.
  const wkm = original.match(/\b(?:every\s+(other\s+)?weekend|alternate\s+weekends)\b/i);
  const weekendRepeat = !!wkm;
  if (wkm) {
    result.repeat = 'weekly';
    result.repeat_every = wkm[1] || /alternate/i.test(wkm[0]) ? 2 : 1;
    work = work.slice(0, wkm.index) + ' '.repeat(wkm[0].length) + work.slice(wkm.index + wkm[0].length);
  }
  // "weekdays" / "weekends": repeat weekly on those days.
  const wdm = work.match(/\b(weekdays|weekends)\b/i);
  if (wdm) {
    result.repeat = 'weekly';
    result.weekdays = /weekdays/i.test(wdm[1]) ? [1, 2, 3, 4, 5] : [0, 6];
    work = work.slice(0, wdm.index) + ' '.repeat(wdm[0].length) + work.slice(wdm.index + wdm[0].length);
  }
  // Blank out matched phrases as we use them, so what's left is the title.
  let rest = work;
  const cut = (index, length) => { rest = rest.slice(0, index) + ' '.repeat(length) + rest.slice(index + length); };

  const hits = chrono.parse(work, now, { forwardDate: true });
  let dateHit = null, timeHit = null;
  for (const h of hits) {
    const s = h.start;
    const hasDate = s.isCertain('day') || s.isCertain('weekday') || s.isCertain('month');
    if (hasDate && !dateHit) dateHit = h;
    if (s.isCertain('hour') && !timeHit) timeHit = h;
  }

  let date = null, endDate = null;
  if (dateHit) {
    date = new Date(dateHit.start.date()); cut(dateHit.index, dateHit.text.length);
    // "Fri to Sun", "Oct 9-11": the reader gives an end for these.
    const certainDate = c => c.isCertain('day') || c.isCertain('weekday') || c.isCertain('month');
    if (dateHit.end && certainDate(dateHit.end)) endDate = new Date(dateHit.end.date());
    // "July 4 through July 9" / "until": two separate dates joined by a range word.
    if (!endDate) {
      const second = hits.find(h => h !== dateHit && h.index > dateHit.index && (h.start.isCertain('day') || h.start.isCertain('weekday')) &&
        /^\s*(?:to|through|thru|until|till|-|–|—)\s*$/i.test(work.slice(dateHit.index + dateHit.text.length, h.index)));
      if (second) { endDate = new Date(second.start.date()); cut(dateHit.index + dateHit.text.length, second.index + second.text.length - dateHit.index - dateHit.text.length); }
    }
  }
  // "this weekend" / "next weekend": Saturday and Sunday (the reader doesn't know this phrase).
  if (!date) {
    const wm = rest.match(/\b(this|next)\s+weekend\b/i);
    if (wm || weekendRepeat) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let sat = new Date(today); sat.setDate(sat.getDate() + ((6 - today.getDay() + 7) % 7) - (today.getDay() === 0 ? 7 : 0));
      if (wm && /next/i.test(wm[1])) sat.setDate(sat.getDate() + 7);
      date = sat < today ? today : sat;                       // if it's already the weekend, start today
      endDate = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1);
      if (wm) cut(wm.index, wm[0].length);
    }
  } else if (weekendRepeat && !endDate && date.getDay() === 6) {
    endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1); // a Saturday start means Saturday-Sunday
  }

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
    const after = work.slice(dateHit.index + dateHit.text.length).match(/^\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?(?!\s*(?:st|nd|rd|th|\/|-|\d|%|:))\b/i);
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
  // The series has to begin on a day it actually occurs: slide forward to the first matching day.
  if (result.weekdays) for (let i = 0; i < 7 && !result.weekdays.includes(date.getDay()); i++) date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  result.date = ymd(date);
  if (endDate && ymd(endDate) > result.date) result.end_date = ymd(endDate);
  if (hour !== null) {
    result.all_day = false;
    result.start_time = hhmm(hour, minute);
    if (endHour !== null) result.end_time = hhmm(endHour, endMinute);
    else result.end_time = hour >= 23 ? '23:59' : hhmm(hour + 1, minute); // default one hour, never past midnight
  }

  // Title: what's left after the date/time phrases are removed.
  const tidyOnce = t => t.replace(/\s+/g, ' ').trim()
    .replace(/\s+(?:starting|starts?|beginning|begins)$/i, '')   // "...every 2 weeks starting Oct 5"
    .replace(/^(?:at|on|@|-|,|:|from|by)\s+/i, '').replace(/\s+(?:at|on|@|-|,|:|from|by)$/i, '')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '');
  const tidy = t => { let prev; do { prev = t; t = tidyOnce(t); } while (t !== prev); return t; }; // repeat until nothing more comes off
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
