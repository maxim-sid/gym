'use strict';

/* ---------- reference data ---------- */

const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Traps', 'Forearms'];

const DEFAULT_EX = [
  ['Barbell Bench Press', 'Chest'], ['Incline Dumbbell Press', 'Chest'], ['Machine Chest Press', 'Chest'], ['Cable Fly', 'Chest'], ['Dip', 'Chest'],
  ['Pull-up', 'Back'], ['Lat Pulldown', 'Back'], ['Barbell Row', 'Back'], ['Seated Cable Row', 'Back'], ['Chest-Supported Row', 'Back'], ['Deadlift', 'Back'],
  ['Overhead Press', 'Shoulders'], ['Dumbbell Lateral Raise', 'Shoulders'], ['Cable Lateral Raise', 'Shoulders'], ['Rear Delt Fly', 'Shoulders'],
  ['Barbell Curl', 'Biceps'], ['Incline Dumbbell Curl', 'Biceps'], ['Hammer Curl', 'Biceps'], ['Cable Curl', 'Biceps'],
  ['Triceps Pushdown', 'Triceps'], ['Overhead Cable Extension', 'Triceps'], ['Skull Crusher', 'Triceps'],
  ['Back Squat', 'Quads'], ['Hack Squat', 'Quads'], ['Leg Press', 'Quads'], ['Leg Extension', 'Quads'], ['Bulgarian Split Squat', 'Quads'],
  ['Romanian Deadlift', 'Hamstrings'], ['Lying Leg Curl', 'Hamstrings'], ['Seated Leg Curl', 'Hamstrings'],
  ['Hip Thrust', 'Glutes'], ['Standing Calf Raise', 'Calves'], ['Seated Calf Raise', 'Calves'],
  ['Cable Crunch', 'Abs'], ['Hanging Leg Raise', 'Abs'], ['Barbell Shrug', 'Traps'], ['Wrist Curl', 'Forearms'],
];

const TEMPLATES = {
  'Full Body · 3 days': [
    ['Full Body A', ['Back Squat', 'Barbell Bench Press', 'Barbell Row', 'Dumbbell Lateral Raise', 'Barbell Curl']],
    ['Full Body B', ['Romanian Deadlift', 'Overhead Press', 'Lat Pulldown', 'Cable Fly', 'Triceps Pushdown']],
    ['Full Body C', ['Leg Press', 'Incline Dumbbell Press', 'Seated Cable Row', 'Lying Leg Curl', 'Standing Calf Raise']],
  ],
  'Upper / Lower · 4 days': [
    ['Upper A', ['Barbell Bench Press', 'Barbell Row', 'Overhead Press', 'Lat Pulldown', 'Barbell Curl', 'Triceps Pushdown']],
    ['Lower A', ['Back Squat', 'Romanian Deadlift', 'Leg Extension', 'Standing Calf Raise', 'Cable Crunch']],
    ['Upper B', ['Incline Dumbbell Press', 'Pull-up', 'Dumbbell Lateral Raise', 'Seated Cable Row', 'Incline Dumbbell Curl', 'Overhead Cable Extension']],
    ['Lower B', ['Hack Squat', 'Lying Leg Curl', 'Hip Thrust', 'Seated Calf Raise', 'Hanging Leg Raise']],
  ],
  'Push / Pull / Legs · 3 days': [
    ['Push', ['Barbell Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Dumbbell Lateral Raise', 'Triceps Pushdown']],
    ['Pull', ['Pull-up', 'Barbell Row', 'Rear Delt Fly', 'Barbell Curl', 'Hammer Curl']],
    ['Legs', ['Back Squat', 'Romanian Deadlift', 'Leg Extension', 'Lying Leg Curl', 'Standing Calf Raise']],
  ],
};

// Answer index is stored per question; setDelta() turns answers into a set change for next week.
const FEEDBACK = [
  { k: 'sore', q: 'Soreness going in (from last time)?', opts: ['None', 'Healed a while ago', 'Healed just in time', 'Still sore'] },
  { k: 'pump', q: 'Pump?', opts: ['Low', 'Moderate', 'Amazing'] },
  { k: 'work', q: 'Workload?', opts: ['Easy', 'Pretty good', 'Pushed my limits', 'Too much'] },
  { k: 'joint', q: 'Joint pain?', opts: ['None', 'Some', 'A lot'] },
];

function setDelta(fb) {
  if (!Object.keys(fb).length) return 0;
  const { sore = 1, pump = 1, work = 1, joint = 0 } = fb;
  let d;
  if (sore === 3 || work === 3) d = -1;            // not recovering: back off
  else if (sore === 2 || work === 2) d = 0;        // right at the edge: hold
  else if (pump === 0 && sore === 0 && work === 0) d = 2; // way under-stimulated
  else d = 1;                                      // recovering fine: add a set
  if (joint === 1) d = Math.min(d, 0);
  if (joint === 2) d = -1;
  return d;
}

/* ---------- state ---------- */

const KEY = 'liftbook-v1';
const uid = () => Math.random().toString(36).slice(2, 10);

function freshState() {
  return {
    v: 1,
    settings: { unit: 'kg', restMain: 180, restAcc: 90 },
    exercises: DEFAULT_EX.map(([name, muscle]) => ({ id: uid(), name, muscle })),
    mesos: [],
    activeId: null,
  };
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) {
      s.settings.restMain ??= 180;
      s.settings.restAcc ??= s.settings.rest ?? 90;
      return s;
    }
  } catch (e) { /* fall through */ }
  return freshState();
}

let S = loadState();
const ui = { tab: 'today', at: null, draft: null, progEx: null };

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Could not save — storage full?'); }
}
navigator.storage?.persist?.();

/* ---------- helpers ---------- */

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const exById = id => S.exercises.find(e => e.id === id);
const byName = (a, b) => a.name.localeCompare(b.name);
const unit = () => S.settings.unit;
const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const doneSets = sl => sl.sets.filter(x => x.done);
const fmtSets = sets => sets.map(x => (+x.w ? `${+x.w}×${x.r}` : `${x.r} reps`)).join(', ');
const e1rm = (w, r) => w * (1 + r / 30);
const blankSets = n => Array.from({ length: n }, () => ({ w: '', r: '', done: false }));
const roundLoad = w => { const step = unit() === 'kg' ? 2.5 : 5; return Math.round(w / step) * step; };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const repsTxt = (r, timed) => (r ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`) + (timed ? ' s' : '') : '');
function parseReps(str) {
  const m = String(str).match(/(\d+)\s*(?:[-–]\s*(\d+))?/);
  if (!m) return null;
  const a = +m[1], b = +(m[2] ?? m[1]);
  return [Math.min(a, b), Math.max(a, b)];
}

function ensureExercise(name, muscle) {
  let ex = S.exercises.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (!ex) { ex = { id: uid(), name, muscle }; S.exercises.push(ex); }
  return ex;
}

const activeMeso = () => S.mesos.find(m => m.id === S.activeId);
const totalWeeks = m => m.weeks + (m.deload ? 1 : 0);
const isDeload = (m, w) => m.deload && w === m.weeks;
const isFixed = m => m.style === 'fixed';

// Training order within a week: by weekday, starting from Day 1's weekday (e.g. Sat, Sun, Wed).
function dayOrder(m) {
  const idx = m.days.map((_, i) => i);
  const start = m.days[0]?.weekday;
  if (start == null || m.days.some(d => d.weekday == null)) return idx;
  return idx.sort((a, b) => ((m.days[a].weekday - start + 7) % 7) - ((m.days[b].weekday - start + 7) % 7));
}

function targetRIR(m, w) {
  if (m.weeks === 1) return 2;
  return Math.round(3 - (3 * w) / (m.weeks - 1));
}

function plannedSets(m, d, i, w) {
  const plan = m.days[d].exercises[i].plan;
  if (isDeload(m, w)) return Math.max(1, Math.round(plan[0] / 2));
  for (let k = w; k >= 0; k--) if (plan[k] != null) return plan[k];
  return plan[0];
}

function session(m, w, d, create) {
  const k = `${w}-${d}`;
  if (!m.log[k] && create) {
    m.log[k] = {
      date: null, done: false,
      slots: m.days[d].exercises.map((sl, i) => ({ exId: sl.exId, sets: blankSets(plannedSets(m, d, i, w)), fb: {} })),
    };
  }
  return m.log[k];
}

function prevSlot(m, w, d, i) {
  if (w === 0) return null;
  const sl = m.log[`${w - 1}-${d}`]?.slots[i];
  return sl && doneSets(sl).length ? sl : null;
}

function advance(m) {
  for (let w = 0; w < totalWeeks(m); w++) {
    for (const d of dayOrder(m)) {
      if (!m.log[`${w}-${d}`]?.done) { m.pos = { w, d }; m.complete = false; return; }
    }
  }
  m.complete = true;
}

function cur() {
  const m = activeMeso();
  return { m, s: session(m, ui.at.w, ui.at.d), w: ui.at.w, d: ui.at.d };
}

function used(exId) {
  return S.mesos.some(m => m.days.some(d => d.exercises.some(s => s.exId === exId)));
}

function exerciseOptions() {
  return MUSCLES.map(mu => {
    const exs = S.exercises.filter(e => e.muscle === mu).sort(byName);
    return exs.length ? `<optgroup label="${mu}">${exs.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}

/* ---------- views ---------- */

function viewToday() {
  const m = activeMeso();
  if (!m) {
    return `<section class="empty"><h1>No active plan</h1>
      <p>Build a mesocycle: choose exercises for each training day, then log weights and reps.
      Each week the app tells you how hard to push (RIR) and adjusts your sets based on how you recovered.</p>
      <button class="btn primary block" data-act="newMeso" data-t="${esc(MY_PLAN.name)}">Start my 3-day plan</button>
      <button class="btn block" data-act="newMeso">Build a different plan</button></section>`;
  }
  if (!ui.at || ui.at.meso !== m.id) ui.at = { meso: m.id, ...m.pos };
  const { w, d } = ui.at;
  const day = m.days[d];
  const tw = totalWeeks(m);
  const deload = isDeload(m, w);
  const isNext = !m.complete && m.pos.w === w && m.pos.d === d;
  const s = session(m, w, d, isNext);
  if (isNext) save();

  const rir = targetRIR(m, w);
  const effort = deload ? '<b>Deload</b> — half the sets, about half the weight'
    : isFixed(m) ? '' : ` · Leave <b>${rir} rep${rir === 1 ? '' : 's'}</b> in reserve`;
  let h = `<header class="top"><div class="eyebrow">${esc(m.name)}</div><h1>${esc(day.name)}</h1>
    <div class="meta">Week ${w + 1} of ${tw}${day.weekday != null ? ` · ${WEEKDAYS[day.weekday]}` : ''}${deload ? ' · ' + effort : effort}</div>
    ${day.notes ? `<p class="hint">${esc(day.notes)}</p>` : ''}</header>`;

  h += '<div class="picker">';
  for (let ww = 0; ww < tw; ww++) {
    h += `<div class="wk"><span>${isDeload(m, ww) ? 'Deload' : `W${ww + 1}`}</span>`;
    dayOrder(m).forEach(di => {
      const ss = m.log[`${ww}-${di}`];
      const cls = [ww === w && di === d ? 'cur' : '', ss?.done ? 'done' : '', ss && !ss.done ? 'started' : ''].join(' ');
      const wd = m.days[di].weekday;
      h += `<button class="dot ${cls}" data-act="goto" data-w="${ww}" data-d="${di}" aria-label="Week ${ww + 1} ${esc(m.days[di].name)}">${wd != null ? WEEKDAYS[wd].slice(0, 2) : di + 1}</button>`;
    });
    h += '</div>';
  }
  h += '</div>';

  if (m.complete) h += `<div class="banner">Mesocycle complete 🎉 Start a new one from the Plan tab.</div>`;

  if (!s) {
    h += `<div class="card"><div class="sub">Planned</div>${day.exercises.map((sl, i) =>
      `<div class="line"><span>${esc(exById(sl.exId)?.name)}</span><span class="muted">${plannedSets(m, d, i, w)} sets</span></div>`).join('')}
      ${w > m.pos.w && !m.complete ? '<p class="hint">Set counts can still change based on your feedback in earlier workouts.</p>' : ''}</div>
      <button class="btn primary block" data-act="start">Start this workout</button>`;
    if (!m.complete) {
      h += `<p class="hint">Next up: Week ${m.pos.w + 1}, ${esc(m.days[m.pos.d].name)}.
        <button class="link" data-act="goto" data-w="${m.pos.w}" data-d="${m.pos.d}">Go there</button></p>`;
    }
    return h;
  }

  if (s.done) h += `<div class="banner">Completed ${fmtDate(s.date)}</div>`;

  s.slots.forEach((sl, i) => {
    const ex = exById(sl.exId);
    const meta = day.exercises[i];
    const prev = prevSlot(m, w, d, i);
    const prevDone = prev ? doneSets(prev) : [];
    // Double progression: every set at the top of the range last time → suggest more weight, reps back to the bottom.
    const hitTop = !deload && meta.reps && prevDone.length && prevDone.every(x => +x.r >= meta.reps[1]);
    const weighted = prevDone.some(x => +x.w > 0);
    h += `<div class="card"><div class="exhead"><div><h2>${esc(ex?.name)}</h2>
      <div class="tags"><span class="tag">${esc(ex?.muscle)}</span>${meta.type === 'main' ? '<span class="tag main">Main</span>' : ''}
      ${meta.reps ? `<span class="muted">${sl.sets.length} × ${repsTxt(meta.reps, meta.timed)}</span>` : ''}</div></div>
      ${prev ? `<div class="prev">Last week<br>${fmtSets(prevDone)}</div>` : ''}</div>
      ${meta.notes ? `<div class="note">${esc(meta.notes)}</div>` : ''}
      ${hitTop ? `<div class="up">↑ Top of the range on every set last week: ${weighted ? 'add weight' : 'add weight or reps'}</div>` : ''}
      <div class="setgrid"><span></span><span class="h">${unit()}</span><span class="h">${meta.timed ? 'Sec' : 'Reps'}</span><span></span>`;
    sl.sets.forEach((st, j) => {
      const p = prevDone[j] || prevDone[prevDone.length - 1];
      const pw = !p ? '' : deload ? roundLoad(+p.w / 2) : hitTop && +p.w > 0 ? roundLoad(+p.w + (unit() === 'kg' ? 2.5 : 5)) : +p.w;
      const pr = !p ? '' : hitTop && weighted ? meta.reps[0] : p.r;
      const dc = st.done ? 'd' : '';
      h += `<span class="n">${j + 1}</span>
        <input class="${dc}" inputmode="decimal" data-i="${i}" data-j="${j}" data-f="w" value="${esc(st.w)}" placeholder="${pw}" aria-label="Set ${j + 1} weight">
        <input class="${dc}" inputmode="numeric" data-i="${i}" data-j="${j}" data-f="r" value="${esc(st.r)}" placeholder="${pr}" aria-label="Set ${j + 1} reps">
        <button class="chk ${st.done ? 'on' : ''}" data-act="set" data-i="${i}" data-j="${j}" aria-label="Done">✓</button>`;
    });
    h += `</div><div class="row"><button class="btn sm" data-act="addSet" data-i="${i}">+ Set</button>
      <button class="btn sm" data-act="rmSet" data-i="${i}">− Set</button></div>`;
    if (sl.sets.length && sl.sets.every(x => x.done) && !deload && !isFixed(m)) h += fbHtml(sl, i);
    h += '</div>';
  });

  if (!s.done) h += `<button class="btn primary block" data-act="finish">Finish workout</button>`;
  return h;
}

function fbHtml(sl, i) {
  return `<div class="fb"><div class="fbtitle">How did that go?</div>${FEEDBACK.map(q =>
    `<div class="q">${q.q}</div><div class="chips">${q.opts.map((o, v) =>
      `<button class="chip ${sl.fb[q.k] === v ? 'on' : ''}" data-act="fb" data-i="${i}" data-k="${q.k}" data-v="${v}">${o}</button>`).join('')}</div>`).join('')}
    ${sl.fb.joint >= 1 ? '<div class="warn">Consider swapping this exercise for something that feels better next block.</div>' : ''}</div>`;
}

function viewPlan() {
  if (ui.draft) return viewBuilder();
  let h = `<header class="top"><h1>Mesocycles</h1><div class="meta">A block of 3–6 hard weeks, then a deload week.</div></header>
    <button class="btn primary block" data-act="newMeso">+ New mesocycle</button>`;
  S.mesos.slice().reverse().forEach(m => {
    const done = Object.values(m.log).filter(x => x.done).length;
    const total = totalWeeks(m) * m.days.length;
    h += `<div class="card"><div class="row between"><div><h2>${esc(m.name)}</h2>
      <div class="meta">${m.days.length} days/week · ${m.weeks} weeks${m.deload ? ' + deload' : ''} · ${isFixed(m) ? 'fixed sets' : 'auto sets'} · ${done}/${total} workouts</div></div>
      ${m.id === S.activeId ? '<span class="tag acc">Active</span>' : ''}</div>
      <div class="bar"><i style="width:${(done / total) * 100}%"></i></div>
      <div class="row">
        ${m.id !== S.activeId ? `<button class="btn sm" data-act="activate" data-id="${m.id}">Make active</button>` : ''}
        ${Object.keys(m.log).length ? '' : `<button class="btn sm" data-act="editMeso" data-id="${m.id}">Edit</button>`}
        <button class="btn sm" data-act="copyMeso" data-id="${m.id}">Copy</button>
        <button class="btn sm danger" data-act="delMeso" data-id="${m.id}">Delete</button>
      </div></div>`;
  });
  return h;
}

function viewBuilder() {
  const D = ui.draft;
  const opts = exerciseOptions();
  let h = `<header class="top"><div class="eyebrow">${D.editId ? 'Edit' : 'New'} mesocycle</div><h1>Build your block</h1></header>
    <div class="card"><label class="fl">Name<input data-bind="name" value="${esc(D.name)}"></label>
      <div class="row"><label class="fl grow">Hard weeks<select data-bind="weeks">${[3, 4, 5, 6].map(n => `<option ${n === D.weeks ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" data-bind="deload" ${D.deload ? 'checked' : ''}> + Deload week</label></div>
      <div class="row"><div class="seg">${[['rp', 'Auto sets'], ['fixed', 'Fixed sets']].map(([v, l]) =>
        `<button class="${D.style === v ? 'on' : ''}" data-act="style" data-v="${v}">${l}</button>`).join('')}</div></div>
      <p class="hint">${D.style === 'fixed'
        ? 'Sets stay as planned. Work up through each rep range, and the app tells you when to add weight.'
        : 'Reps in reserve (RIR) drops from 3 to 0 across the hard weeks. Sets go up or down based on your feedback after each exercise.'}</p></div>
    <div class="sub">Start from a template</div>
    <div class="chips">${[MY_PLAN.name, ...Object.keys(TEMPLATES)].map(t => `<button class="chip" data-act="template" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="sub">Training days</div>`;
  D.days.forEach((day, d) => {
    h += `<div class="card"><div class="row between"><input class="dayname" data-bind="dayName" data-d="${d}" value="${esc(day.name)}" aria-label="Day name">
      <button class="icon" data-act="rmDay" data-d="${d}" aria-label="Remove day">✕</button></div>
      <select class="daywd" data-bind="weekday" data-d="${d}" aria-label="Weekday"><option value="">Any day</option>${WEEKDAYS.map((n, k) =>
        `<option value="${k}" ${day.weekday === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    day.exercises.forEach((sl, i) => {
      const ex = exById(sl.exId);
      h += `<div class="bex"><div class="grow"><div>${esc(ex?.name)}</div>
        <div class="mini"><input data-bind="reps" data-d="${d}" data-i="${i}" value="${esc(repsTxt(sl.reps))}" placeholder="reps" aria-label="Rep range">
        <button class="chip ${sl.type === 'main' ? 'on' : ''}" data-act="type" data-d="${d}" data-i="${i}">${sl.type === 'main' ? 'Main' : 'Accessory'}</button></div></div>
        <div class="stepper"><button data-act="sets" data-d="${d}" data-i="${i}" data-v="-1" aria-label="Fewer sets">−</button><b>${sl.plan[0]}</b><button data-act="sets" data-d="${d}" data-i="${i}" data-v="1" aria-label="More sets">+</button></div>
        <button class="icon" data-act="rmEx" data-d="${d}" data-i="${i}" aria-label="Remove exercise">✕</button></div>`;
    });
    h += `<select class="addex" data-bind="addEx" data-d="${d}"><option value="">+ Add exercise…</option>${opts}</select></div>`;
  });
  h += `<button class="btn block" data-act="addDay">+ Add day</button>`;

  const vol = {};
  D.days.forEach(day => day.exercises.forEach(sl => {
    const mu = exById(sl.exId)?.muscle;
    if (mu) vol[mu] = (vol[mu] || 0) + sl.plan[0];
  }));
  if (Object.keys(vol).length) {
    h += `<div class="card"><div class="sub">Week 1 sets per muscle</div><div class="vol">${MUSCLES.filter(mu => vol[mu]).map(mu => `<span>${mu} <b>${vol[mu]}</b></span>`).join('')}</div>
      <p class="hint">Starting low (around 2 sets per exercise) is fine. The app adds sets as you go.</p></div>`;
  }
  h += `<div class="row"><button class="btn grow" data-act="cancelDraft">Cancel</button><button class="btn primary grow" data-act="saveDraft">${D.editId ? 'Save' : 'Save & start'}</button></div>`;
  return h;
}

function allSessions() {
  const out = [];
  S.mesos.forEach(m => Object.entries(m.log).forEach(([k, s]) => {
    if (!s.done) return;
    const [w, d] = k.split('-').map(Number);
    out.push({ m, w, d, s });
  }));
  return out.sort((a, b) => b.s.date - a.s.date);
}

function perfFor(exId) {
  const out = [];
  allSessions().forEach(({ s }) => s.slots.forEach(sl => {
    if (sl.exId !== exId) return;
    const sets = doneSets(sl).filter(x => +x.r > 0);
    if (sets.length) out.push({ date: s.date, sets });
  }));
  return out.sort((a, b) => a.date - b.date);
}

function chart(points) {
  if (points.length < 2) return '<p class="hint">Log this exercise in at least two workouts to see a trend.</p>';
  const W = 320, H = 150, P = 26;
  const ys = points.map(p => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi === lo) { hi += 1; lo -= 1; }
  const X = i => P + ((W - 2 * P) * i) / (points.length - 1);
  const Y = v => H - P - ((H - 2 * P) * (v - lo)) / (hi - lo);
  const pts = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">
    <line class="grid" x1="${P}" x2="${W - P}" y1="${Y(hi)}" y2="${Y(hi)}"/><line class="grid" x1="${P}" x2="${W - P}" y1="${Y(lo)}" y2="${Y(lo)}"/>
    <text x="0" y="${Y(hi) + 4}">${Math.round(hi)}</text><text x="0" y="${Y(lo) + 4}">${Math.round(lo)}</text>
    <polyline points="${pts}"/>${points.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.5"/>`).join('')}
    <text x="${P}" y="${H - 6}">${fmtDate(points[0].x)}</text><text x="${W - P}" y="${H - 6}" text-anchor="end">${fmtDate(points[points.length - 1].x)}</text></svg>`;
}

function viewProgress() {
  const sessions = allSessions();
  const weekAgo = Date.now() - 7 * 864e5;
  const totalSets = sessions.reduce((n, { s }) => n + s.slots.reduce((k, sl) => k + doneSets(sl).length, 0), 0);
  let h = `<header class="top"><h1>Progress</h1></header>
    <div class="stats"><div class="stat"><b>${sessions.length}</b><span>Workouts</span></div>
    <div class="stat"><b>${sessions.filter(x => x.s.date > weekAgo).length}</b><span>Last 7 days</span></div>
    <div class="stat"><b>${totalSets}</b><span>Total sets</span></div></div>`;

  const logged = S.exercises.filter(e => perfFor(e.id).length).sort(byName);
  if (!logged.length) return h + '<p class="hint">Finish a workout and your progress shows up here.</p>';
  if (!logged.some(e => e.id === ui.progEx)) ui.progEx = logged[0].id;

  const perf = perfFor(ui.progEx);
  const weighted = perf.some(p => p.sets.some(x => +x.w > 0));
  const points = perf.map(p => ({ x: p.date, y: weighted ? Math.max(...p.sets.map(x => e1rm(+x.w, +x.r))) : Math.max(...p.sets.map(x => +x.r)) }));
  h += `<div class="card"><select data-bind="progEx">${logged.map(e => `<option value="${e.id}" ${e.id === ui.progEx ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
    <div class="sub">${weighted ? `Estimated 1-rep max (${unit()})` : 'Best reps'}</div>${chart(points)}</div>
    <div class="card list">${perf.slice().reverse().slice(0, 12).map(p => `<div class="line"><span class="muted">${fmtDate(p.date)}</span><span>${fmtSets(p.sets)}</span></div>`).join('')}</div>`;

  h += `<div class="sub">Recent workouts</div><div class="card list">${sessions.slice(0, 10).map(({ m, w, d, s }) => {
    const sets = s.slots.reduce((k, sl) => k + doneSets(sl).length, 0);
    return `<div class="line"><div><div>${esc(m.days[d]?.name)}</div><div class="muted">${esc(m.name)} · W${w + 1}</div></div><div class="muted">${fmtDate(s.date)}<br>${sets} sets</div></div>`;
  }).join('')}</div>`;
  return h;
}

function viewExercises() {
  let h = `<header class="top"><h1>Exercises</h1></header>
    <div class="card"><div class="sub">Add your own</div>
      <div class="row"><input id="newExName" class="grow" placeholder="e.g. Pendulum Squat" aria-label="Exercise name">
      <select id="newExMuscle" style="width:auto" aria-label="Muscle">${MUSCLES.map(mu => `<option>${mu}</option>`).join('')}</select></div>
      <div class="row"><button class="btn primary grow" data-act="addExercise">Add exercise</button></div></div>`;
  MUSCLES.forEach(mu => {
    const exs = S.exercises.filter(e => e.muscle === mu).sort(byName);
    if (!exs.length) return;
    h += `<div class="sub">${mu}</div><div class="card list">${exs.map(e => `<div class="line"><span>${esc(e.name)}</span>
      ${used(e.id) ? '<span class="muted">in a plan</span>' : `<button class="icon" data-act="delExercise" data-id="${e.id}" aria-label="Delete ${esc(e.name)}">✕</button>`}</div>`).join('')}</div>`;
  });
  return h;
}

function viewSettings() {
  return `<header class="top"><h1>Settings</h1></header>
    <div class="card list">
      <div class="line"><span>Units</span><div class="seg">${['kg', 'lb'].map(u => `<button class="${unit() === u ? 'on' : ''}" data-act="unit" data-v="${u}">${u}</button>`).join('')}</div></div>
      ${[['restMain', 'Rest · main lifts'], ['restAcc', 'Rest · accessories']].map(([k, label]) =>
        `<div class="line"><span>${label}</span><select data-bind="${k}">${[45, 60, 90, 120, 150, 180, 240, 300].map(s =>
          `<option value="${s}" ${S.settings[k] === s ? 'selected' : ''}>${fmtTime(s)}</option>`).join('')}</select></div>`).join('')}
    </div>
    <p class="hint" style="margin:-4px 2px 12px">Changing units only changes the label. Numbers you already logged stay the same.</p>
    <div class="card"><div class="sub">Backup</div>
      <p class="hint">Your data is stored only on this phone. Export a backup now and then (save it to Files or iCloud Drive).</p>
      <div class="row"><button class="btn grow" data-act="exportData">Export</button><button class="btn grow" data-act="importData">Import</button></div></div>
    <div class="card"><div class="sub">Install on iPhone</div>
      <ol class="hint"><li>Open this page in Safari</li><li>Tap the Share button</li><li>Choose <b>Add to Home Screen</b></li></ol></div>
    <button class="btn danger block" data-act="reset">Erase all data</button>`;
}

const VIEWS = { today: viewToday, plan: viewPlan, progress: viewProgress, exercises: viewExercises, settings: viewSettings };

function render() {
  $('#main').innerHTML = VIEWS[ui.tab]();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ---------- rest timer ---------- */

let rest = null, audio;

function startRest(type) {
  stopRest();
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch (e) { /* no audio */ }
  const secs = type === 'main' ? S.settings.restMain : S.settings.restAcc;
  rest = { end: Date.now() + secs * 1000, fired: false };
  rest.iv = setInterval(tickRest, 250);
  tickRest();
}

function tickRest() {
  const el = $('#rest');
  const left = Math.ceil((rest.end - Date.now()) / 1000);
  el.hidden = false;
  if (left > 0) {
    el.querySelector('.t').textContent = fmtTime(left);
    el.classList.remove('go');
    return;
  }
  el.querySelector('.t').textContent = 'Go!';
  el.classList.add('go');
  if (!rest.fired) { rest.fired = true; beep(); navigator.vibrate?.(300); }
  if (left < -30) stopRest();
}

function stopRest() {
  if (rest) clearInterval(rest.iv);
  rest = null;
  $('#rest').hidden = true;
}

function beep() {
  try {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.25, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.5);
  } catch (e) { /* ignore */ }
}

/* ---------- actions ---------- */

function newDraft() {
  return { name: `Block ${S.mesos.length + 1}`, weeks: 4, deload: true, style: 'rp', days: [{ name: 'Day 1', exercises: [] }] };
}

const copySlot = s => ({ exId: s.exId, plan: [s.plan[0]], reps: s.reps ?? null, type: s.type ?? 'accessory', notes: s.notes ?? '', timed: !!s.timed });
const copyDay = d => ({ name: d.name, weekday: d.weekday ?? null, notes: d.notes ?? '', exercises: d.exercises.map(copySlot) });

function draftFrom(m, editId) {
  return {
    editId, name: editId ? m.name : `${m.name} (copy)`, weeks: m.weeks, deload: m.deload, style: m.style ?? 'rp',
    days: m.days.map(copyDay),
  };
}

function applyTemplate(D, t) {
  if (t === MY_PLAN.name) {
    Object.assign(D, { name: 'My 3-day plan', style: 'fixed', weeks: 6, deload: false });
    D.days = MY_PLAN.days.map(day => ({
      name: day.name, weekday: day.weekday, notes: day.notes ?? '',
      exercises: day.exercises.map(e => ({
        exId: ensureExercise(e.name, e.muscle).id, plan: [e.sets], reps: e.reps, type: e.type, notes: e.notes ?? '', timed: !!e.timed,
      })),
    }));
    return;
  }
  D.days = TEMPLATES[t].map(([name, list]) => ({
    name, weekday: null, notes: '',
    exercises: list.map(n => S.exercises.find(e => e.name === n)).filter(Boolean)
      .map((e, i) => ({ exId: e.id, plan: [2], reps: null, type: i < 2 ? 'main' : 'accessory', notes: '', timed: false })),
  }));
}

const A = {
  tab: el => { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  goto: el => { ui.at = { meso: S.activeId, w: +el.dataset.w, d: +el.dataset.d }; render(); },
  start: () => { const { m, w, d } = { m: activeMeso(), ...ui.at }; session(m, w, d, true); save(); render(); },

  set: el => {
    const { m, s, d } = cur();
    const i = +el.dataset.i, j = +el.dataset.j;
    const st = s.slots[i].sets[j];
    if (st.done) { st.done = false; save(); render(); return; }
    const wi = $(`input[data-i="${i}"][data-j="${j}"][data-f="w"]`);
    const ri = $(`input[data-i="${i}"][data-j="${j}"][data-f="r"]`);
    if (st.w === '') st.w = wi.placeholder;
    if (st.r === '') st.r = ri.placeholder;
    if (st.r === '' || !(+st.r >= 0)) { toast('Enter your reps first'); return; }
    if (st.w === '' || isNaN(+st.w)) st.w = '0';
    st.done = true;
    save();
    startRest(m.days[d].exercises[i].type);
    render();
  },
  addSet: el => { const { s } = cur(); s.slots[+el.dataset.i].sets.push(...blankSets(1)); save(); render(); },
  rmSet: el => {
    const sets = cur().s.slots[+el.dataset.i].sets;
    if (sets.length > 1) { sets.pop(); save(); render(); }
  },
  fb: el => { const { s } = cur(); s.slots[+el.dataset.i].fb[el.dataset.k] = +el.dataset.v; save(); render(); },

  finish: () => {
    const { m, s, w, d } = cur();
    if (s.slots.some(sl => sl.sets.some(x => !x.done)) &&
      !confirm('Some sets aren’t checked off. Finish anyway? Unchecked sets will be dropped.')) return;
    const base = s.slots.map(sl => sl.sets.length);
    s.slots.forEach(sl => { sl.sets = doneSets(sl); });
    const changes = [];
    if (!isFixed(m) && !isDeload(m, w) && w + 1 < m.weeks) {
      m.days[d].exercises.forEach((slot, i) => {
        const n = Math.max(1, Math.min(12, base[i] + setDelta(s.slots[i].fb)));
        slot.plan[w + 1] = n;
        if (n !== base[i]) changes.push(`${exById(slot.exId)?.name} ${base[i]}→${n}`);
        const next = m.log[`${w + 1}-${d}`];
        if (next && !next.done && !next.slots[i].sets.some(x => x.done)) next.slots[i].sets = blankSets(n);
      });
    }
    s.done = true;
    s.date = Date.now();
    advance(m);
    ui.at = null;
    stopRest();
    save();
    render();
    window.scrollTo(0, 0);
    toast(changes.length ? `Saved. Next week: ${changes.join(', ')}` : 'Workout saved 💪');
  },

  newMeso: el => {
    ui.tab = 'plan';
    ui.draft = newDraft();
    if (el.dataset.t) { applyTemplate(ui.draft, el.dataset.t); save(); }
    render();
    window.scrollTo(0, 0);
  },
  editMeso: el => { ui.draft = draftFrom(S.mesos.find(m => m.id === el.dataset.id), el.dataset.id); render(); window.scrollTo(0, 0); },
  copyMeso: el => { ui.draft = draftFrom(S.mesos.find(m => m.id === el.dataset.id)); render(); window.scrollTo(0, 0); },
  activate: el => { S.activeId = el.dataset.id; ui.at = null; save(); render(); },
  delMeso: el => {
    const m = S.mesos.find(x => x.id === el.dataset.id);
    if (!confirm(`Delete “${m.name}” and all its logged workouts?`)) return;
    S.mesos = S.mesos.filter(x => x !== m);
    if (S.activeId === m.id) S.activeId = S.mesos[S.mesos.length - 1]?.id ?? null;
    ui.at = null;
    save();
    render();
  },

  template: el => { applyTemplate(ui.draft, el.dataset.t); save(); render(); },
  style: el => { ui.draft.style = el.dataset.v; render(); },
  type: el => {
    const sl = ui.draft.days[+el.dataset.d].exercises[+el.dataset.i];
    sl.type = sl.type === 'main' ? 'accessory' : 'main';
    render();
  },
  addDay: () => { ui.draft.days.push({ name: `Day ${ui.draft.days.length + 1}`, weekday: null, notes: '', exercises: [] }); render(); },
  rmDay: el => { ui.draft.days.splice(+el.dataset.d, 1); render(); },
  rmEx: el => { ui.draft.days[+el.dataset.d].exercises.splice(+el.dataset.i, 1); render(); },
  sets: el => {
    const sl = ui.draft.days[+el.dataset.d].exercises[+el.dataset.i];
    sl.plan[0] = Math.max(1, Math.min(10, sl.plan[0] + +el.dataset.v));
    render();
  },
  cancelDraft: () => { ui.draft = null; render(); },
  saveDraft: () => {
    const D = ui.draft;
    if (!D.days.length || D.days.some(d => !d.exercises.length)) { toast('Every day needs at least one exercise'); return; }
    const fields = {
      name: D.name.trim() || 'Mesocycle', weeks: D.weeks, deload: D.deload, style: D.style,
      days: D.days.map(d => ({ ...copyDay(d), name: d.name.trim() || 'Day' })),
    };
    if (D.editId) {
      Object.assign(S.mesos.find(m => m.id === D.editId), fields);
    } else {
      const m = { id: uid(), ...fields, log: {}, pos: { w: 0, d: 0 }, complete: false, created: Date.now() };
      S.mesos.push(m);
      S.activeId = m.id;
    }
    ui.draft = null;
    ui.at = null;
    ui.tab = 'today';
    save();
    render();
    window.scrollTo(0, 0);
    toast('Plan saved. Let’s train.');
  },

  addExercise: () => {
    const name = $('#newExName').value.trim();
    if (!name) { toast('Give it a name'); return; }
    if (S.exercises.some(e => e.name.toLowerCase() === name.toLowerCase())) { toast('That exercise already exists'); return; }
    S.exercises.push({ id: uid(), name, muscle: $('#newExMuscle').value });
    save();
    render();
    toast(`Added ${name}`);
  },
  delExercise: el => { S.exercises = S.exercises.filter(e => e.id !== el.dataset.id); save(); render(); },

  unit: el => { S.settings.unit = el.dataset.v; save(); render(); },
  exportData: async () => {
    const name = `liftbook-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  importData: () => $('#importFile').click(),
  reset: () => {
    if (!confirm('Erase all plans, workouts and custom exercises? This cannot be undone.')) return;
    S = freshState();
    Object.assign(ui, { tab: 'today', at: null, draft: null, progEx: null });
    save();
    render();
  },

  restAdd: () => { if (rest) { rest.end += 30000; rest.fired = false; tickRest(); } },
  restSkip: () => stopRest(),
};

function onBind(t) {
  const b = t.dataset.bind;
  if (b === 'restMain' || b === 'restAcc') { S.settings[b] = +t.value; save(); return; }
  if (b === 'progEx') { ui.progEx = t.value; render(); return; }
  const D = ui.draft;
  if (!D) return;
  if (b === 'name') D.name = t.value;
  else if (b === 'weeks') D.weeks = +t.value;
  else if (b === 'deload') D.deload = t.checked;
  else if (b === 'dayName') D.days[+t.dataset.d].name = t.value;
  else if (b === 'weekday') D.days[+t.dataset.d].weekday = t.value === '' ? null : +t.value;
  else if (b === 'reps') D.days[+t.dataset.d].exercises[+t.dataset.i].reps = parseReps(t.value);
  else if (b === 'addEx' && t.value) {
    D.days[+t.dataset.d].exercises.push({ exId: t.value, plan: [2], reps: null, type: 'accessory', notes: '', timed: false });
    render();
  }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el) A[el.dataset.act]?.(el, e);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f) {
    const { s } = cur();
    s.slots[+t.dataset.i].sets[+t.dataset.j][t.dataset.f] = t.value.replace(',', '.');
    save();
  } else if (t.dataset.bind && t.tagName === 'INPUT' && t.type !== 'checkbox') {
    onBind(t);
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.bind && (t.tagName === 'SELECT' || t.type === 'checkbox')) onBind(t);
});

$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data?.v !== 1 || !Array.isArray(data.mesos) || !Array.isArray(data.exercises)) throw new Error('bad file');
    if (!confirm('Replace everything on this phone with this backup?')) return;
    S = data;
    Object.assign(ui, { at: null, draft: null, progEx: null });
    save();
    render();
    toast('Backup restored');
  } catch (err) {
    toast('That file isn’t a Liftbook backup');
  }
});

// The timer keeps an absolute end time, so it catches up after the phone sleeps.
document.addEventListener('visibilitychange', () => { if (rest && !document.hidden) tickRest(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js');
}

render();
