// The message-of-the-day deck: no line twice in a row, everything gets a turn, custom lines get a gentle boost.
const { motdDeck, ok, done } = require('./_load');
const { window, generalPool, cycleLine, poolOf, setDb } = motdDeck();
const custom = (n, spicyEvery = 0) => Array.from({ length: n }, (_, i) => ({ id: 'id' + String(i).padStart(3, '0'), text: 'Custom line #' + (i + 1), spicy: spicyEvery > 0 && i % spicyEvery === 0, author_id: i % 2 ? 'g' : 'b' }));
const day0 = Math.floor(Date.UTC(2026, 0, 1) / 864e5);
const seq = (pool, days) => Array.from({ length: days }, (_, i) => cycleLine(pool, day0 + i));
for (const spicy of [false, true]) for (const n of [0, 1, 3, 10, 20]) {
  setDb({ customMotds: custom(n) });
  const pool = generalPool(spicy), base = poolOf(window.MOTD.general, spicy).length, s = seq(pool, 4000);
  ok(s.every((x, i) => i === 0 || x.text !== s[i - 1].text), `spicy=${spicy} custom=${n}: never the same line two days running (4000 days)`);
  const cyc = Array.from({ length: pool.length }, (_, i) => cycleLine(pool, day0 - (day0 % pool.length) + i).text).sort();
  ok(JSON.stringify(cyc) === JSON.stringify(pool.map(p => p.text).sort()), `spicy=${spicy} custom=${n}: a full cycle plays every card exactly its share of times`);
  ok((pool.length - base) / pool.length <= 0.5, `spicy=${spicy} custom=${n}: custom lines never take over the deck`);
}
setDb({ customMotds: custom(6, 2) });
ok(!generalPool(false).some(p => /Custom line #(1|3|5)$/.test(p.text)) && generalPool(true).some(p => p.text === 'Custom line #1'), 'spicy custom lines only enter the deck when spicy is on');
setDb({ customMotds: [{ id: 'a', text: 'Hi', spicy: false, author_id: 'g' }] });
ok(generalPool(false).filter(p => p.text === 'Hi').every(p => p.by === 'g'), 'custom lines carry their author');
setDb({ customMotds: custom(4) }); const A = generalPool(false); setDb({ customMotds: custom(4).reverse() }); const B = generalPool(false);
ok(JSON.stringify(seq(A, 400).map(x => x.text)) === JSON.stringify(seq(B, 400).map(x => x.text)), 'same lines = same message every day, whatever order the database returns them in');
let bad = 0; for (let n = 3; n <= 90; n++) for (const dv of [1, 2, 3]) { const pool = Array.from({ length: n }, (_, i) => ({ text: 'L' + (i % Math.max(2, Math.ceil(n / dv))) })); for (let c = 1; c <= 20; c++) if (cycleLine(pool, c * n - 1).text === cycleLine(pool, c * n).text && new Set(pool.map(p => p.text)).size > 1) bad++; }
ok(bad === 0, 'no repeat across cycle seams, and no hang, in duplicate-heavy decks');
done('message of the day');
