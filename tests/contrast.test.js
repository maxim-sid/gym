'use strict';
// 1.7: WCAG contrast of the colours actually in style.css (text ≥ 4.5:1, field borders/UI ≥ 3:1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const V = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*#([0-9a-f]{6})/gi)].map(([, k, v]) => [k, v]));
const rgb = h => h.match(/\w\w/g).map(x => parseInt(x, 16));
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = c.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const c = k => rgb(V[k]);
// The done-row background is var(--ok) at the alpha in .setgrid input.d, over --card2.
const alpha = +css.match(/\.setgrid input\.d \{ background: rgba\(56,217,122,([\d.]+)\)/)[1];
const doneBg = c('ok').map((v, i) => Math.round(v * alpha + c('card2')[i] * (1 - alpha)));

const pairs = [
  ['text on card2 (typed values)', c('text'), c('card2'), 4.5],
  ['placeholder (suggested values) on card2', c('ph'), c('card2'), 4.5],
  ['ok on the done-row background (done values)', c('ok'), doneBg, 4.5],
  ['muted on card (Last line, labels)', c('muted'), c('card'), 4.5],
  ['muted on card2', c('muted'), c('card2'), 4.5],
  ['muted on bg', c('muted'), c('bg'), 4.5],
  ['acc on card (eyebrow, links)', c('acc'), c('card'), 4.5],
  ['on-acc on acc (primary buttons)', c('on-acc'), c('acc'), 4.5],
  ['bad on card2 (refusal outline/text)', c('bad'), c('card2'), 4.5],
  ['field border on card (inputs, ✓ boxes)', c('field'), c('card'), 3],
  ['field border on card2', c('field'), c('card2'), 3],
];

test('contrast ratios from style.css meet WCAG AA', () => {
  const rows = pairs.map(([name, a, b, min]) => ({ name, ratio: +ratio(a, b).toFixed(2), min }));
  console.log(rows.map(r => `  ${r.ratio.toFixed(2)}:1 (min ${r.min})  ${r.name}`).join('\n'));
  console.log(`  ${ratio(c('line'), c('card')).toFixed(2)}:1  --line on card (decorative dividers, no minimum)`);
  for (const r of rows) assert.ok(r.ratio >= r.min, `${r.name}: ${r.ratio} < ${r.min}`);
});
