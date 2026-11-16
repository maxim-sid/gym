'use strict';

// Mixed-version launch (new app.js, old or missing core.js): stop before touching any data.
if (typeof loadFrom !== 'function' || typeof loadState !== 'function' || typeof importInto !== 'function' || typeof chartPoints !== 'function' || typeof draftUses !== 'function' || typeof canAutoUpdate !== 'function' || typeof stepChoices !== 'function' || typeof currentSlot !== 'function') {
  document.getElementById('main').textContent = 'Liftbook was just updated — close it (swipe it away) and open it again.';
  document.getElementById('tabs').style.display = 'none';
  throw new Error('core.js missing or outdated');
}

/* ---------- reference data ---------- */

const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Traps', 'Forearms'];

// DEFAULT_EX, FEEDBACK, uid, freshState, the load logic and the plan/progression math live in core.js.

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

/* ---------- state ---------- */

// KEY and the load rules (recovery copy, backup-auto) live in core.js.
// mode 'ok': normal. 'readOnly': written by a newer version, shown but never saved.
// 'recovery': stored data couldn't be read (or storage is unavailable) → only the recovery screen.
// Even reading the localStorage property can throw when storage is blocked; a stand-in that throws on
// every call lets loadState report 'storage' instead of the app going blank.
let store;
try { store = window.localStorage; }
catch (err) { const fail = () => { throw err; }; store = { getItem: fail, setItem: fail, key: fail, length: 0 }; }
const boot = loadState(store, Date.now());
let mode = boot.mode;
const readOnly = mode === 'readOnly';
let S = boot.state;
const ui = { tab: 'today', at: null, draft: null, progEx: null, edit: null, sheet: null, renaming: null, open: new Set(), openKey: null }; // edit: session key while editing a finished workout (not persisted)

function save() {
  if (mode !== 'ok') return;
  try { store.setItem(KEY, JSON.stringify(S)); }
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Finds by name, or creates it with the flags given (bw/timed from plan.js). Never changes an existing exercise.
function ensureExercise(name, muscle, { bw = false, timed = false, step } = {}) {
  let ex = S.exercises.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (!ex) {
    ex = { id: uid(), name, muscle, bw: !!bw, timed: !!timed };
    if (+step > 0) ex.step = +step;
    S.exercises.push(ex);
  }
  return ex;
}
// Timed: the exercise flag decides once set (it is seeded for every exercise); the plan slot is the fallback.
const isTimed = (ex, meta) => ex?.timed ?? !!meta?.timed;

// Everything the suggestions for slot i depend on, computed once per slot (view and ✓ use the same values).
function slotCtx(m, w, d, s, i) {
  const sl = s.slots[i];
  const ex = exById(sl.exId);
  const meta = m.days[d].exercises[i];
  const deload = isDeload(m, w);
  const occurrence = occurrenceOf(m, d, s, i);
  const last = lastPerf(S, sl.exId, { exclude: s, occurrence, before: s.done ? s.date : Infinity });
  const { hitTop, weighted } = slotHints(last, meta.reps, deload);
  const step = stepOf(ex, unit());
  return { sl, ex, meta, last, hitTop, weighted, step, suggest: j => prefill(sl, j, last, ex, { deload, step }) };
}

const activeMeso = () => S.mesos.find(m => m.id === S.activeId);

const sessKey = (m, w, d) => `${m.id}:${w}-${d}`;
// Editing a finished workout is on for this session only.
const editing = (m, w, d) => ui.edit === sessKey(m, w, d);
// Cards the user expanded (2.6), for the workout on screen only: another workout starts with none.
function openCards(key) {
  if (ui.openKey !== key) { ui.open = new Set(); ui.openKey = key; }
  return ui.open;
}

// The ONE entry for every write to the open workout: refuses a finished workout unless Edit is on for it,
// and stores the session first if it was only shown (virtual). → {m, s, w, d} | null
// For an Undo toast: the write guard for the CURRENT workout, captured now and checked when Undo is tapped.
function writeGuard() {
  const m = activeMeso(), { w, d } = ui.at, key = sessKey(m, w, d);
  return () => canWrite(m.log[`${w}-${d}`], key, ui.edit) && activeMeso() === m;
}

// Same rule as curW, without storing the session: for sheet actions that don't write the workout itself.
function cardWritable() {
  const m = activeMeso(), { w, d } = ui.at;
  if (canWrite(session(m, w, d), sessKey(m, w, d), ui.edit)) return true;
  toast(refusal(session(m, w, d)));
  return false;
}
const refusal = s => s?.skipped ? 'This workout was skipped — tap “Do it anyway” first' : 'Tap Edit to change a finished workout';

function curW() {
  const m = activeMeso();
  const { w, d } = ui.at;
  if (!canWrite(session(m, w, d), sessKey(m, w, d), ui.edit)) { toast(refusal(session(m, w, d))); return null; }
  return { m, s: session(m, w, d, true), w, d };
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
  if (!m || !m.days.length) {
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
  // Shown from the plan until the first write (curW) stores it; viewing never creates or saves.
  const s = session(m, w, d) ?? (isNext ? blankSession(m, w, d) : undefined);

  const rir = targetRIR(m, w);
  const effort = deload ? '<b>Deload</b> — half the sets, about half the weight'
    : isFixed(m) ? '' : ` · Leave <b>${rir} rep${rir === 1 ? '' : 's'}</b> in reserve`;
  // Workout ⋯ (skip / discard / finish): an unfinished, unskipped workout only.
  const wkMore = s && !s.done && !s.skipped
    ? `<button class="icon more wkmore" data-act="wkMenu" aria-label="More for ${esc(day.name)}">⋯</button>` : '';
  let h = `<header class="top">${wkMore}<div class="eyebrow">${esc(m.name)}</div><h1>${esc(day.name)}</h1>
    <div class="meta"><button class="wkbtn" data-act="weekSheet" aria-haspopup="dialog">Week ${w + 1} of ${tw}${day.weekday != null ? ` · ${WEEKDAYS[day.weekday].slice(0, 3)}` : ''} <span aria-hidden="true">▾</span></button>${deload ? ' · ' + effort : effort}</div>
    ${day.notes ? `<p class="hint">${esc(day.notes)}</p>` : ''}</header>`;

  if (m.complete) h += `<div class="banner">Mesocycle complete 🎉 Start a new one from the Plan tab.</div>`;

  const preview = `<div class="card"><div class="sub">Planned</div>${day.exercises.map((sl, i) =>
      `<div class="line"><span>${esc(exById(sl.exId)?.name)}</span><span class="muted">${plannedSets(m, d, i, w)} sets</span></div>`).join('')}
      ${w > m.pos.w && !m.complete ? '<p class="hint">Set counts can still change based on your feedback in earlier workouts.</p>' : ''}</div>`;
  // Skipped: read-only preview; "Do it anyway" puts it back in the sequence (whatever was typed is kept).
  if (s?.skipped) {
    return h + `<div class="banner skipb row between"><span>Skipped ${fmtDate(s.skippedAt)}</span>
      <button class="btn sm" data-act="doAnyway">Do it anyway</button></div>${preview}`;
  }
  // Not next and not stored: a read-only preview. Logging it now asks first (it fixes its set counts early).
  if (!s) {
    h += `${preview}<button class="btn block" data-act="logNow">Log this one now</button>`;
    if (!m.complete) h += nextUpBtn(m);
    return h;
  }

  // Finished: read-only unless Edit is on for it. Editing never re-runs Finish/progression or touches the timer.
  const ro = !!s.done && !editing(m, w, d);
  if (s.done) {
    h += `<div class="banner row between"><span>${ro ? 'Completed' : 'Editing'} ${fmtDate(s.date)}</span>
      <button class="btn sm" data-act="${ro ? 'editOn' : 'editOff'}">${ro ? 'Edit' : 'Done editing'}</button></div>`;
  }

  // 2.6: only the current card (and cards the user opened) is expanded; the rest are one-line rows.
  // A finished workout starts all collapsed (also in Edit). Feedback still to answer keeps a card open.
  const cur = s.done ? -1 : currentSlot(s);
  const opened = openCards(sessKey(m, w, d));
  s.slots.forEach((sl, i) => {
    const { sl: _sl, ex, meta, last, hitTop, weighted, step, suggest } = slotCtx(m, w, d, s, i);
    // ↑ chip: explicit "+step" for the untouched sets (no longer baked into the suggestion, F15).
    const from = swappedFrom(m, d, s, i); // planned exercise when this slot does another one today
    if (sl.skip) { // skipped exercise: one line; done sets stay counted
      const nd = sl.sets.filter(x => x.done).length;
      h += `<div class="card skipcard"><div class="row between"><div class="skline"><span aria-hidden="true">⤼</span> <b>${esc(ex?.name)}</b> — skipped${
        nd ? ` <span class="muted">· ${nd} set${nd === 1 ? '' : 's'} done</span>` : ''}</div>
        ${ro ? '' : `<div class="row nowrap"><button class="lnk" data-act="unskipSlot" data-i="${i}" aria-label="Undo skip ${esc(ex?.name)}">Undo</button>
          <button class="icon more" data-act="cardMenu" data-i="${i}" aria-label="More for ${esc(ex?.name)}">⋯</button></div>`}</div></div>`;
      return;
    }
    const showFb = !ro && !from && sl.sets.some(x => x.done) && sl.sets.every(x => x.done || x.skip) && !deload && !isFixed(m);
    const fbPending = showFb && FEEDBACK.some(q => sl.fb[q.k] == null);
    const isCur = i === cur;
    if (!isCur && !fbPending && !opened.has(i)) { h += cardRow(sl, i, ex, meta, last); return; }
    const chip = hitTop && weighted && !ro
      ? `<button class="chip bump ${bumpOn(_sl) ? 'on' : ''}" data-act="bump" data-i="${i}">+${step} ${unit()}</button>` : '';
    // An expanded card that isn't current collapses again from its header.
    const title = isCur || fbPending ? esc(ex?.name)
      : `<button class="chead" data-act="cardToggle" data-i="${i}" aria-expanded="true">${esc(ex?.name)}</button>`;
    h += `<div class="card ${isCur ? 'cur' : ''}" data-slot="${i}"><div class="exhead"><div><h2>${title}</h2>
      ${from && (!s.done || editing(m, w, d)) ? `<div class="swapped">instead of ${esc(exById(from)?.name)}${ro || sl.sets.some(x => x.done) ? ''
        : ` · <button class="lnk" data-act="unswap" data-i="${i}">Undo swap</button>`}</div>` : ''}
      <div class="tags"><span class="tag">${esc(ex?.muscle)}</span>${meta.type === 'main' ? '<span class="tag main">Main</span>' : ''}
      ${meta.reps ? `<span class="muted">${sl.sets.length} × ${repsTxt(meta.reps, isTimed(ex, meta))}</span>` : ''}</div></div>
      ${ro ? '' : `<button class="icon more" data-act="cardMenu" data-i="${i}" aria-label="More for ${esc(ex?.name)}">⋯</button>`}
      </div>
      ${last ? `<div class="last">Last · ${fmtDate(last.date)}: ${fmtSets(last.sets, ex, unit())}</div>` : ''}
      ${meta.notes && !from ? `<div class="note">${esc(meta.notes)}</div>` : ''}
      ${hitTop ? `<div class="up"><span>↑ Top of the range on every set last time: ${weighted ? 'add weight' : 'add weight or reps'}</span>${chip}</div>` : ''}
      <div class="setgrid"><span></span><span class="h">${ex?.bw ? '+' : ''}${unit()}</span><span class="h">${isTimed(ex, meta) ? 'Sec' : 'Reps'}</span><span></span>`;
    sl.sets.forEach((st, j) => {
      const { w: pw, r: pr } = suggest(j);
      const dc = st.done ? 'd' : st.skip ? 'sk' : '';
      const sk = !st.done && st.skip;
      const roA = ro || sk ? 'readonly tabindex="-1"' : '';
      h += (ro ? `<span class="n ${st.done ? 'd' : ''}">${st.done ? '✓' : sk ? '–' : ''}${j + 1}</span>`
        : sk ? `<button class="n sk" data-act="unskipSet" data-i="${i}" data-j="${j}" aria-label="Set ${j + 1} skipped. Unskip">↺</button>`
        : `<button class="n ${st.done ? 'd' : ''}" data-act="setNum" data-i="${i}" data-j="${j}" aria-label="Set ${j + 1} options">${st.done ? '✓' : ''}${j + 1}</button>`)
        + `<input class="${dc}" inputmode="decimal" data-i="${i}" data-j="${j}" data-f="w" value="${esc(st.w)}" placeholder="${ro || sk ? '' : pw}" ${roA} enterkeyhint="next" aria-label="Set ${j + 1} weight">
        <input class="${dc}" inputmode="numeric" data-i="${i}" data-j="${j}" data-f="r" value="${esc(st.r)}" placeholder="${ro || sk ? '' : pr}" ${roA} enterkeyhint="done" aria-label="Set ${j + 1} reps">`
        + (ro || sk ? `<span class="chk static ${st.done ? 'on' : st.skip ? 'sk' : ''}" aria-label="${st.done ? 'Done' : st.skip ? 'Skipped' : 'Not done'}">${st.done ? '✓' : st.skip ? 'skipped' : ''}</span>`
          : `<button class="chk ${st.done ? 'on' : ''}" data-act="set" data-i="${i}" data-j="${j}" aria-label="Done">✓</button>`);
    });
    h += '</div>';
    if (!ro) h += `<div class="row"><button class="btn sm" data-act="addSet" data-i="${i}">+ Set</button>
      <button class="btn sm ${canRemoveLastSet(sl) ? '' : 'off'}" data-act="rmSet" data-i="${i}" aria-disabled="${!canRemoveLastSet(sl)}">− Set</button></div>`;
    // Feedback once every set is done or skipped (one done at least). Not for a swapped slot: it never changes
    // the planned exercise's set count. (A skipped exercise has no card body at all.)
    if (showFb) h += fbHtml(sl, i);
    h += '</div>';
  });

  if (!s.done) h += `<button class="btn primary block" data-act="finish">Finish workout</button>`;
  return h;
}

// A collapsed card: "✓ Name  summary ›" when its sets are done, else "Name  3×8–10 · last time ›". Tap to open.
function cardRow(sl, i, ex, meta, last) {
  const name = esc(ex?.name);
  const nd = sl.sets.filter(x => x.done).length;
  const finished = nd > 0 && !slotOpen(sl);
  let sum;
  if (finished) sum = esc(fmtSets(countedSets(sl), ex, unit()));
  else {
    const target = meta.reps ? `${sl.sets.length}×${repsTxt(meta.reps, isTimed(ex, meta))}` : `${sl.sets.length} sets`;
    const lastTxt = last ? fmtSets(last.sets, ex, unit()) : '';
    const typed = sl.sets.filter(x => !x.done && !x.skip && (String(x.w).trim() !== '' || String(x.r).trim() !== '')).length;
    const allSkipped = sl.sets.length > 0 && sl.sets.every(x => x.skip && !x.done);
    // a finished workout drops unused sets → "not done"
    sum = esc(allSkipped ? 'skipped' : nd ? `${nd}/${sl.sets.length} done` : sl.sets.length ? target : 'not done');
    if (typed) sum += ` · ${typed} typed`;
    // Last time only when the row still fits on one line at phone width.
    else if (!nd && !allSkipped && lastTxt && (ex?.name || '').length + target.length + lastTxt.length <= 34) sum += ` · ${esc(lastTxt)}`;
  }
  return `<div class="card crow ${finished ? 'cdone' : ''}" data-slot="${i}"><button class="ctoggle" data-act="cardToggle" data-i="${i}" aria-expanded="false"
    aria-label="${name}${finished ? ', done' : ''}: ${sum}. Show sets"><span class="cname">${finished ? '<span class="okmark" aria-hidden="true">✓</span>' : ''}${name}</span>
    <span class="csum">${sum}</span><span class="chev" aria-hidden="true">›</span></button></div>`;
}

const nextUpBtn = m => `<button class="btn block" data-act="goto" data-w="${m.pos.w}" data-d="${m.pos.d}">Next up: Week ${m.pos.w + 1}, ${esc(m.days[m.pos.d].name)}</button>`;

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
    const skipped = Object.values(m.log).filter(x => x.skipped).length;
    const total = totalWeeks(m) * m.days.length;
    h += `<div class="card"><div class="row between"><div><h2>${esc(m.name)}</h2>
      <div class="meta">${m.days.length} days/week · ${m.weeks} weeks${m.deload ? ' + deload' : ''} · ${isFixed(m) ? 'fixed sets' : 'auto sets'} · ${skipped ? `${done} done · ${skipped} skipped / ${total}` : `${done}/${total} workouts`}</div></div>
      ${m.id === S.activeId ? '<span class="tag acc">Active</span>' : ''}</div>
      <div class="bar"><i style="width:${((done + skipped) / total) * 100}%"></i></div>
      <div class="row">
        ${m.id !== S.activeId ? `<button class="btn sm" data-act="activate" data-id="${m.id}">Make active</button>` : ''}
        ${hasLogs(m) ? '' : `<button class="btn sm" data-act="editMeso" data-id="${m.id}">Edit</button>`}
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
  // Editing a block that got logs (editor left open across tabs) or was deleted: offer to keep the edits as a new block.
  const stale = D.editId && !canSaveEdit(S.mesos.find(m => m.id === D.editId));
  if (stale) h += `<p class="hint">This block can’t be changed any more. Your edits can be saved as a new block.</p>`;
  h += `<div class="row"><button class="btn grow" data-act="cancelDraft">Cancel</button>${stale
    ? '<button class="btn primary grow" data-act="saveCopy">Save as a copy</button>'
    : `<button class="btn primary grow" data-act="saveDraft">${D.editId ? 'Save' : 'Save & start'}</button>`}</div>`;
  return h;
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
  const sessions = allSessions(S);
  const weekAgo = Date.now() - 7 * 864e5;
  const totalSets = sessions.reduce((n, { s }) => n + s.slots.reduce((k, sl) => k + doneSets(sl).length, 0), 0);
  let h = `<header class="top"><h1>Progress</h1></header>
    <div class="stats"><div class="stat"><b>${sessions.length}</b><span>Workouts</span></div>
    <div class="stat"><b>${sessions.filter(x => x.s.date > weekAgo).length}</b><span>Last 7 days</span></div>
    <div class="stat"><b>${totalSets}</b><span>Total sets</span></div></div>`;

  const logged = S.exercises.filter(e => perfFor(S, e.id).length).sort(byName);
  if (!logged.length) return h + '<p class="hint">Finish a workout and your progress shows up here.</p>';
  if (!logged.some(e => e.id === ui.progEx)) ui.progEx = logged[0].id;

  const perf = perfFor(S, ui.progEx);
  const ex = exById(ui.progEx);
  const { metric, points } = chartPoints(S, ex);
  const label = {
    e1rm: `Estimated 1-rep max (${unit()}) · sets of 1–12 reps with a weight`,
    load: `Best added weight (${unit()})`,
    reps: 'Best reps',
    hold: 'Longest hold (seconds)',
  }[metric];
  h += `<div class="card"><select data-bind="progEx">${logged.map(e => `<option value="${e.id}" ${e.id === ui.progEx ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
    <div class="sub">${label}</div>${chart(points)}</div>
    <div class="card list">${perf.slice().reverse().slice(0, 12).map(p => `<div class="line"><span class="muted">${fmtDate(p.date)}</span><span>${fmtSets(p.sets, ex, unit())}</span></div>`).join('')}</div>`;

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
    h += `<div class="sub">${mu}</div><div class="card list">${exs.map(e => {
      const u = exerciseUse(S, e.id);
      const name = ui.renaming === e.id
        ? `<input class="grow exname" data-rename="${e.id}" value="${esc(e.name)}" enterkeyhint="done" aria-label="New name for ${esc(e.name)}">`
        : `<button class="grow exname" data-act="exRename" data-id="${e.id}" aria-label="Rename ${esc(e.name)}">${esc(e.name)}</button>`;
      // Line 1: name (tap to rename) + muscle. Line 2: BW, Timed, weight step, delete.
      return `<div class="exrow"><div class="row between">${name}
          <select class="stepsel" data-bind="exMuscle" data-id="${e.id}" aria-label="Muscle for ${esc(e.name)}">${MUSCLES.map(m => `<option ${m === e.muscle ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="row exctl">
          ${[['bw', 'BW', 'Bodyweight: log the added weight; blank means bodyweight only'], ['timed', 'Timed', 'Timed: log seconds']].map(([k, l, t]) =>
            `<button class="chip tog ${e[k] ? 'on' : ''}" data-act="exFlag" data-id="${e.id}" data-k="${k}" aria-pressed="${!!e[k]}" title="${t}">${l}</button>`).join('')}
          <select class="stepsel" data-bind="step" data-id="${e.id}" aria-label="Weight step for ${esc(e.name)}">
            <option value="">±${stepOf(null, unit())}</option>${stepChoices(e).map(v => `<option value="${v}" ${+e.step === v ? 'selected' : ''}>±${v}</option>`).join('')}</select>
          <button class="icon del ${canDeleteExercise(u) && !draftUses(ui.draft, e.id) ? '' : 'off'}" data-act="delExercise" data-id="${e.id}" aria-label="Delete ${esc(e.name)}">✕</button>
        </div></div>`;
    }).join('')}</div>`;
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
      <div class="row"><button class="btn grow" data-act="exportData">Export</button>${readOnly ? '' : '<button class="btn grow" data-act="importData">Import</button>'}</div></div>
    <div class="card"><div class="sub">Install on iPhone</div>
      <ol class="hint"><li>Open this page in Safari</li><li>Tap the Share button</li><li>Choose <b>Add to Home Screen</b></li></ol></div>
    ${readOnly ? '' : '<button class="btn danger block" data-act="reset">Erase all data</button>'}`;
}

function viewRecovery() {
  if (boot.reason === 'storage') {
    return `<section class="empty"><h1>Storage unavailable</h1>
      <p>Liftbook can’t open this phone’s storage right now (private browsing, or website data turned off). Nothing has been deleted.</p>
      <button class="btn primary block" data-act="reload">Try again</button></section>`;
  }
  return `<section class="empty"><h1>Couldn’t load your data</h1>
    <p>Your saved data couldn’t be read. Nothing has been deleted.</p>
    <button class="btn primary block" data-act="downloadRaw">Download raw data</button>
    <button class="btn danger block" data-act="startFresh">Start fresh</button></section>`;
}

const VIEWS = { today: viewToday, plan: viewPlan, progress: viewProgress, exercises: viewExercises, settings: viewSettings };

// After a tick moves the current card: bring the new one to the top, unless the user scrolled in the last 2 s.
let lastUserScroll = 0;
['touchmove', 'wheel'].forEach(ev => addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true }));
// ticked: the slot just ticked in (no scroll if it stays current). No scroll either when the card is already
// fully on screen (above the bottom bars).
function scrollToCurrent(before, after, ticked) {
  if (after < 0 || after === before || after === ticked || Date.now() - lastUserScroll < 2000) return;
  const el = $(`#main .card[data-slot="${after}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= viewBottom()) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}
// The lowest visible y of the page: the top of whatever is fixed at the bottom (tabs, bars).
const viewBottom = () => Math.min(innerHeight, ...['#tabs', '#rest'].map(sel => $(sel)).filter(e => e && !e.hidden).map(e => e.getBoundingClientRect().top));

/* ---------- bottom sheet ---------- */
// One sheet at a time, rendered from ui.sheet = {kind}. Built from the current data on every render.

function sheetFinish() {
  const m = activeMeso();
  const { w, d } = ui.at;
  const s = session(m, w, d) ?? blankSession(m, w, d);
  const rv = finishReview(s);
  const btn = (mode, label, primary) => `<button class="btn block ${primary ? 'primary' : ''}" data-act="finishGo" data-mode="${mode}">${label}</button>`;
  let h = `<p class="meta">${rv.exercises} of ${rv.of} exercises · ${rv.sets} set${rv.sets === 1 ? '' : 's'}</p>`;
  if (rv.nothing) {
    // Never a fake finished workout: skip it instead (or keep training).
    h += `<p class="warn">Nothing logged yet.</p><button class="btn block primary" data-act="wkSkip">Skip workout</button>`;
  } else if (rv.typed.length) {
    const n = rv.typed.length;
    h += `<p class="warn">⚠ ${n} set${n === 1 ? ' has' : 's have'} numbers but no ✓<br>
      <span class="muted">${rv.typed.map(({ i, j }) => `${esc(exById(s.slots[i].exId)?.name)} set ${j + 1}`).join(' · ')}</span></p>
      ${btn('log', 'Log them and finish', true)}${btn('skip', 'Skip them and finish')}`;
  } else {
    h += btn('plain', 'Finish', true);
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const tidy = [rv.skipped && `${plural(rv.skipped, 'exercise')} skipped`, rv.notStarted && `${plural(rv.notStarted, 'exercise')} not started`, rv.empty && `${plural(rv.empty, 'unused set')} removed`].filter(Boolean);
  if (tidy.length && !rv.nothing) h += `<p class="hint">${tidy.join(' · ')}</p>`;
  return { title: `Finish ${esc(m.days[d].name)}?`, body: h, cancel: 'Keep training', focus: '[data-act=finishGo]' };
}

// Card ⋯ sheet: actions for one exercise of the open workout. Later items add their rows here.
function sheetCard() {
  const m = activeMeso(), { w, d } = ui.at, { key, i } = ui.sheet;
  const s = session(m, w, d) ?? blankSession(m, w, d); // the next workout is shown before it's stored
  const ex = exById(s.slots[i]?.exId);
  if (key !== sessKey(m, w, d) || !ex) return null; // workout changed under the sheet
  const cur = stepOf(ex, unit());
  const sl = s.slots[i];
  const logged = sl.sets.some(x => x.done);
  // Skip: the whole exercise, or "the rest" once sets are logged (machine taken midway). Unskip when skipped.
  const skip = sl.skip ? `<button class="sact" data-act="unskipSlot" data-i="${i}">⤼ Unskip exercise</button>`
    : sl.sets.every(x => x.done) && logged ? ''
    : `<button class="sact" data-act="skipSlot">⤼ ${logged ? 'Skip the rest of this exercise' : 'Skip exercise'}</button>`;
  return {
    title: esc(ex.name),
    body: `<button class="sact ${logged ? 'off' : ''}" data-act="swapOpen" aria-disabled="${logged}">⇄ ${logged ? 'Swap — untick logged sets first' : 'Swap exercise'}</button>${skip}
    <div class="srow"><span>Weight step · ${unit()}</span><div class="chips">${stepChoices(ex).map(v =>
      `<button class="chip ${v === cur ? 'on' : ''}" data-act="cardStep" data-v="${v}" aria-pressed="${v === cur}">${v}</button>`).join('')}</div></div>`,
  };
}

// Week picker sheet (2.6): the weeks × days grid, plus Next up.
function sheetWeek() {
  const m = activeMeso(), { w, d } = ui.at;
  let h = '<div class="picker">';
  for (let ww = 0; ww < totalWeeks(m); ww++) {
    h += `<div class="wk"><span>${isDeload(m, ww) ? 'Deload' : `W${ww + 1}`}</span>`;
    dayOrder(m).forEach(di => {
      const ss = m.log[`${ww}-${di}`];
      // State is shown by a glyph and in the label too, not by colour alone: ✓ done, • started, – skipped.
      const state = ss?.done ? 'done' : ss?.skipped ? 'skipped' : hasContent(ss) ? 'started' : '';
      const here = ww === w && di === d;
      const wd = m.days[di].weekday;
      const label = `Week ${ww + 1} ${m.days[di].name}${state ? `, ${state}` : ''}${here ? ', shown' : ''}`;
      h += `<button class="dot ${here ? 'cur' : ''} ${state}" data-act="goto" data-w="${ww}" data-d="${di}" aria-label="${esc(label)}" ${here ? 'aria-current="true"' : ''}>${
        state === 'done' ? '✓' : state === 'started' ? '•' : state === 'skipped' ? '–' : ''}${wd != null ? WEEKDAYS[wd].slice(0, 2) : di + 1}</button>`;
    });
    h += '</div>';
  }
  h += '</div>';
  if (!m.complete) h += nextUpBtn(m);
  return { title: esc(m.name), body: h, focus: '.dot.cur' };
}

// "Log this one now" on a workout that isn't next: asks first.
function sheetLogNow() {
  const m = activeMeso(), { w, d } = ui.at;
  if (ui.sheet.key !== sessKey(m, w, d) || session(m, w, d)) return null;
  return {
    title: `Week ${w + 1} · ${esc(m.days[d].name)} isn't next`,
    body: `<p class="hint">Its set counts are fixed now; feedback from earlier workouts won't change them.</p>
      <button class="btn block primary" data-act="start">Log it now</button>`,
    focus: '[data-act=start]',
  };
}

// Workout ⋯ sheet (2.5): Skip (no set done) or Finish (sets done) · Discard (has content; asks first).
function sheetWorkout() {
  const m = activeMeso(), { w, d } = ui.at, { key, confirmDiscard } = ui.sheet;
  const s = session(m, w, d) ?? (m.pos.w === w && m.pos.d === d ? blankSession(m, w, d) : null);
  if (key !== sessKey(m, w, d) || !s || s.done || s.skipped) return null;
  const anyDone = s.slots.some(sl => sl.sets.some(x => x.done));
  let body = anyDone ? '<button class="sact" data-act="finish">✓ Finish workout…</button>'
    : '<button class="sact" data-act="wkSkip">⤼ Skip this workout</button>';
  if (m.log[`${w}-${d}`] && hasContent(s)) {
    const n = loggedSets(s);
    body += confirmDiscard
      ? `<p class="warn">${n ? `Delete ${n} logged set${n === 1 ? '' : 's'} from this workout?` : 'Clear this workout?'} It stays next up.</p>
        <button class="btn block danger" data-act="wkDiscard">Delete</button><button class="btn block" data-act="wkDiscardKeep">Keep</button>`
      : '<button class="sact" data-act="wkDiscard">Discard this workout</button>';
  }
  return { title: esc(m.days[d].name), body, focus: confirmDiscard ? '[data-act=wkDiscard]' : '' };
}

// Set-number sheet (2.4): Untick (done) · Skip/Unskip · Delete (asks first when numbers are typed).
function sheetSet() {
  const m = activeMeso(), { w, d } = ui.at, { key, i, j, confirmDel } = ui.sheet;
  const s = session(m, w, d) ?? blankSession(m, w, d);
  const sl = s.slots[i], st = sl?.sets[j];
  if (key !== sessKey(m, w, d) || !st) return null;
  const typed = String(st.w).trim() !== '' || String(st.r).trim() !== '';
  let body = st.done ? '<button class="sact" data-act="setUntick">Untick set</button>'
    : `<button class="sact" data-act="${st.skip ? 'setUnskip' : 'setSkip'}">⤼ ${st.skip ? 'Unskip set' : 'Skip set'}</button>`;
  if (!st.done && sl.sets.length > 1) {
    body += confirmDel
      ? `<p class="warn">Delete set ${j + 1} (${esc(st.w || '–')} × ${esc(st.r || '–')})?</p>
        <button class="btn block danger" data-act="setDelete">Delete set</button><button class="btn block" data-act="setDelKeep">Keep set</button>`
      : `<button class="sact" data-act="setDelete" data-typed="${typed}">Delete set</button>`;
  }
  return { title: `${esc(exById(sl.exId)?.name)} · set ${j + 1}`, body, focus: confirmDel ? '[data-act=setDelete]' : '' };
}
// The open set sheet's set, through the write guard (stores the session if it was only shown).
function sheetSetW() {
  const sh = ui.sheet;
  const c = sh?.kind === 'set' && curW();
  const st = c && sh.key === sessKey(c.m, c.w, c.d) && c.s.slots[sh.i]?.sets[sh.j];
  if (!st) { closeSheet(); return null; }
  return { ...c, i: sh.i, j: sh.j, sl: c.s.slots[sh.i], st };
}

// Swap sheet (2.2, today only): search, then same-muscle exercises (recent first), then other muscles.
function sheetSwap() {
  const m = activeMeso(), { w, d } = ui.at, { key, i } = ui.sheet;
  const s = session(m, w, d) ?? blankSession(m, w, d);
  const ex = exById(s.slots[i]?.exId);
  if (key !== sessKey(m, w, d) || !ex) return null;
  // Rest of block changes the plan, so it isn't offered from a finished workout (Edit mode).
  const seg = s.done ? '' : `<div class="seg swapmode" role="group" aria-label="Swap for">${[['today', 'Today only'], ['block', 'Rest of block']].map(([v, l]) =>
    `<button class="${ui.sheet.mode === v ? 'on' : ''}" data-act="swapMode" data-v="${v}" aria-pressed="${ui.sheet.mode === v}">${l}</button>`).join('')}</div>`;
  return {
    title: `Swap ${esc(ex.name)}`,
    body: `<input type="search" class="swapq" data-swapq value="${esc(ui.sheet.q)}" placeholder="Search or add new…" aria-label="Search exercises or add a new one" autocomplete="off" enterkeyhint="search">
      ${seg}<div id="swaplist">${swapListHtml(ex)}</div>`,
  };
}
// Only the list is redrawn while typing, so the field keeps focus and the keyboard stays up.
function swapListHtml(ex) {
  const g = swapCandidates(S, ex.id, ui.sheet.q);
  const row = (e, right) => `<button class="sitem" data-act="swapPick" data-id="${e.id}"><span>${esc(e.name)}</span>${right ? `<span class="muted">${right}</span>` : ''}</button>`;
  const head = (t, extra = '') => `<div class="sgrp" ${extra}>${t}</div>`;
  let h = '';
  if (g.recent.length) h += head(`Recent · ${esc(g.muscle)}`) + g.recent.map(r => row(r.ex, fmtDate(r.date))).join('');
  if (g.all.length) h += head(`All ${esc(g.muscle)}`) + g.all.map(e => row(e)).join('');
  if (g.other.length) {
    h += ui.sheet.other || ui.sheet.q.trim()
      ? head('Other muscles', 'id="swapother" tabindex="-1"') + g.other.map(o => head(esc(o.muscle), 'class="sgrp sub"') + o.items.map(e => row(e)).join('')).join('')
      : '<button class="sitem" data-act="swapOther" aria-expanded="false"><span>Other muscles</span><span aria-hidden="true">›</span></button>';
  }
  // Add goes last, so Enter (first row on screen) picks a real match whenever there is one.
  if (g.add) h += `<button class="sitem add" data-act="swapAdd">+ Add “${esc(g.add)}” (${esc(g.muscle)})</button>`;
  return h || '<p class="hint">No other exercises match.</p>';
}
const redrawSwapList = () => { const ex = exById((session(activeMeso(), ui.at.w, ui.at.d) ?? blankSession(activeMeso(), ui.at.w, ui.at.d)).slots[ui.sheet.i]?.exId); if (ex) $('#swaplist').innerHTML = swapListHtml(ex); };

// Undo of a swap: the usual write guard, and only while nothing has been logged on the slot since.
const swapUndoGuard = sl => { const g = writeGuard(); return () => g() && !sl.sets.some(x => x.done); };
// pick: {id} or {add: {name, muscle}} (created only once the swap goes ahead, so a refusal or Cancel leaves nothing).
// Rest of block with a plan note on the slot asks first (swapNote sheet); clearNote is its answer.
function doSwap(pick, clearNote) {
  const sh = ui.sheet;
  const c = curW(); // stores the session if it was only shown, like typing a set
  if (!c || !['swap', 'swapNote'].includes(sh?.kind) || sh.key !== sessKey(c.m, c.w, c.d)) { closeSheet(); return; }
  const sl = c.s.slots[sh.i];
  if (sl.sets.some(x => x.done)) { closeSheet(); toast('Untick the logged sets first to swap'); return; }
  const block = sh.mode === 'block' && !c.s.done;
  const note = c.m.days[c.d].exercises[sh.i].notes;
  if (block && clearNote == null && note?.trim()) {
    openSheet({ kind: 'swapNote', key: sh.key, i: sh.i, mode: 'block', pick }, sh.ret);
    return;
  }
  const exId = pick.id ?? ensureExercise(pick.add.name, pick.add.muscle).id;
  const r = block ? swapBlock(c.m, c.d, sh.i, exId, `${c.w}-${c.d}`, { clearNote: !!clearNote }) : swapToday(c.s, sh.i, exId);
  if (!r.error) save();
  closeSheet(); // re-renders and puts focus back on the card's ⋯
  if (r.error) { if (r.error === 'done') toast('Untick the logged sets first to swap'); return; }
  const name = exById(exId).name, m = c.m, d = c.d, i = sh.i;
  if (block) toast(`${name} for the rest of the block`, { label: 'Undo', act: () => restoreBlock(m, d, i, r.snap), guard: swapUndoGuard(sl) });
  else toast(`Swapped to ${name} for today`, { label: 'Undo', act: () => restoreSlot(sl, r.snap), guard: swapUndoGuard(sl) });
}

// Asked in the sheet before a rest-of-block swap empties the slot's plan note. Either answer swaps.
function sheetSwapNote() {
  const m = activeMeso(), { w, d } = ui.at, { key, i } = ui.sheet;
  const slot = m.days[d].exercises[i];
  if (key !== sessKey(m, w, d) || !slot) return null;
  return {
    title: 'Clear the plan note?',
    body: `<p class="note-q">“${esc(slot.notes)}”</p><p class="hint">It was written for ${esc(exById(slot.exId)?.name)}.</p>
      <button class="btn block primary" data-act="swapNoteGo" data-clear="1">Clear note</button>
      <button class="btn block" data-act="swapNoteGo" data-clear="0">Keep note</button>`,
    focus: '[data-act=swapNoteGo]',
  };
}

const SHEETS = { week: sheetWeek, logNow: sheetLogNow, workout: sheetWorkout, finish: sheetFinish, card: sheetCard, swap: sheetSwap, swapNote: sheetSwapNote, set: sheetSet };

// Shell shared by every sheet: title, body, Cancel at the bottom; the backdrop also cancels.
function renderSheet() {
  const el = $('#sheet');
  const sp = ui.sheet && SHEETS[ui.sheet.kind]();
  if (ui.sheet && !sp) ui.sheet = null;
  el.hidden = !sp;
  el.dataset.focus = sp?.focus || '';
  el.innerHTML = sp ? `<div class="sheet-bg" data-act="sheetCancel"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><h2 id="sheet-title" tabindex="-1">${sp.title}</h2>${sp.body}
    <button class="btn block" data-act="sheetCancel">${sp.cancel || 'Cancel'}</button></div>` : '';
}

// Open a sheet and move focus into it (VoiceOver starts there). ret: selector to refocus on close.
function openSheet(spec, ret) {
  ui.sheet = { ...spec, ret };
  render();
  // Focus goes into the sheet (VoiceOver starts there): the sheet's own target, else its title.
  ($(`#sheet .sheet ${$('#sheet').dataset.focus || 'h2'}`) || $('#sheet-title'))?.focus();
}
function closeSheet() {
  const ret = ui.sheet?.ret;
  ui.sheet = null;
  render();
  if (ret) $(ret)?.focus();
}

function render() {
  const blocked = mode === 'recovery';
  $('#tabs').style.display = blocked ? 'none' : '';
  if (blocked) { $('#main').innerHTML = viewRecovery(); return; }
  $('#main').innerHTML = (readOnly ? `<div class="banner ro">Data was saved by a newer version of Liftbook. Reload to update. Changes won’t be saved.</div>` : '')
    + VIEWS[ui.tab]();
  renderSheet();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
}

// One toast at a time, at the bottom. opt {label, act}: an action button (44 px) shown for 6 s. The action lives
// here, not in the DOM; a newer toast replaces it, so an old toast's action can never fire.
let toastTimer, toastAction = null;
function cancelToast() {
  toastAction = null;
  clearTimeout(toastTimer);
  $('#toast').classList.remove('show');
}
// opt.guard() is checked again when the action is tapped (the write guard can change while the toast shows).
function toast(msg, opt) {
  const el = $('#toast');
  toastAction = opt?.act ? { act: opt.act, guard: opt.guard || (() => true), then: opt.then } : null;
  el.innerHTML = `<span>${esc(msg)}</span>${toastAction ? `<button class="tact" data-act="toastAct">${esc(opt.label || 'Undo')}</button>` : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  const mine = toastAction;
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    if (toastAction === mine) toastAction = null;
  }, toastAction ? 6000 : 3200);
}

/* ---------- rest timer ---------- */

let rest = null, audio;

// at: {w, d, i, j} of the set that started it, so unticking that set can stop it.
function startRest(type, at) {
  stopRest();
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch (e) { /* no audio */ }
  const secs = type === 'main' ? S.settings.restMain : S.settings.restAcc;
  rest = { end: Date.now() + secs * 1000, fired: false, at };
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

// Share sheet where available (iOS: save to Files), otherwise a download.
async function shareFile(name, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

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
        exId: ensureExercise(e.name, e.muscle, e).id, plan: [e.sets], reps: e.reps, type: e.type, notes: e.notes ?? '', timed: !!e.timed,
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

// The draft as meso fields, or null (with a toast) if it can't be saved. Doesn't change the draft.
function draftFields(D) {
  if (!D.days.length || D.days.some(d => !d.exercises.length)) { toast('Every day needs at least one exercise'); return null; }
  return {
    name: D.name.trim() || 'Mesocycle', weeks: D.weeks, deload: D.deload, style: D.style,
    days: D.days.map(d => ({ ...copyDay(d), name: d.name.trim() || 'Day' })),
  };
}
const newMeso = fields => ({ id: uid(), ...fields, log: {}, pos: { w: 0, d: 0 }, complete: false, created: Date.now() });

const A = {
  tab: el => { ui.tab = el.dataset.tab; ui.edit = null; ui.sheet = null; ui.renaming = null; cancelToast(); render(); window.scrollTo(0, 0); },
  goto: el => {
    const fromSheet = ui.sheet?.kind === 'week';
    ui.at = { meso: S.activeId, w: +el.dataset.w, d: +el.dataset.d }; ui.edit = null; ui.sheet = null; cancelToast(); render();
    if (fromSheet) $('[data-act=weekSheet]')?.focus(); // back on the button that opened the sheet
  },
  sheetCancel: () => closeSheet(),
  // ⋯ on an exercise card. Hidden on a finished workout unless Edit is on; checked again here.
  cardMenu: el => {
    if (!cardWritable()) return;
    const m = activeMeso(), { w, d } = ui.at;
    openSheet({ kind: 'card', key: sessKey(m, w, d), i: +el.dataset.i }, `[data-act="cardMenu"][data-i="${el.dataset.i}"]`);
  },
  swapOpen: () => {
    if (!cardWritable()) return;
    const m = activeMeso(), { w, d } = ui.at, { key, i, ret } = ui.sheet;
    if ((session(m, w, d) ?? blankSession(m, w, d)).slots[i]?.sets.some(x => x.done)) { toast('Untick the logged sets first to swap'); return; }
    openSheet({ kind: 'swap', key, i, q: '', other: false, mode: 'today' }, ret);
  },
  swapMode: el => { ui.sheet.mode = el.dataset.v; render(); $(`#sheet [data-act=swapMode][data-v="${el.dataset.v}"]`)?.focus(); },
  swapNoteGo: el => doSwap(ui.sheet.pick, el.dataset.clear === '1'),
  swapOther: () => { ui.sheet.other = true; redrawSwapList(); $('#swapother')?.focus(); },
  swapPick: el => doSwap({ id: el.dataset.id }),
  swapAdd: () => {
    if (!cardWritable()) return;
    const m = activeMeso(), { w, d } = ui.at;
    const cur = exById((session(m, w, d) ?? blankSession(m, w, d)).slots[ui.sheet.i]?.exId);
    const g = cur && swapCandidates(S, cur.id, ui.sheet.q);
    if (g?.add) doSwap({ add: { name: g.add, muscle: g.muscle } });
  },
  unswap: el => {
    const c = curW();
    if (!c) return;
    const i = +el.dataset.i, sl = c.s.slots[i];
    const r = unswap(c.m, c.d, c.s, i);
    if (r.error) { if (r.error === 'done') toast('Untick the logged sets first'); return; }
    save();
    render();
    toast(`Back to ${exById(sl.exId).name}`, { label: 'Undo', act: () => restoreSlot(sl, r.snap), guard: swapUndoGuard(sl) });
  },
  // The step belongs to the exercise, so this doesn't store a workout that's only shown.
  cardStep: el => {
    const m = activeMeso(), { w, d } = ui.at;
    const ex = cardWritable() && exById((session(m, w, d) ?? blankSession(m, w, d)).slots[ui.sheet?.i]?.exId);
    if (!ex) { closeSheet(); return; }
    setStep(ex, el.dataset.v);
    save();
    closeSheet();
    toast(`Weight step for ${ex.name}: ${ex.step} ${unit()}`);
  },
  toastAct: () => {
    const a = toastAction;
    cancelToast();
    if (!a || !a.guard()) return; // e.g. edit mode ended since: the session is read-only again
    a.act();
    save();
    render();
    a.then?.(); // after the re-render, still inside the tap (iOS only opens the keyboard on a user gesture)
  },
  editOn: () => { ui.edit = sessKey(activeMeso(), ui.at.w, ui.at.d); cancelToast(); render(); },
  editOff: () => {
    cancelToast();
    const c = curW(); // still in edit mode here, so the write is allowed
    if (c && tidySlots(c.s)) save();
    ui.edit = null;
    render();
  },
  start: () => { const { m, w, d } = { m: activeMeso(), ...ui.at }; ui.sheet = null; session(m, w, d, true); save(); render(); },
  weekSheet: () => openSheet({ kind: 'week' }, '[data-act=weekSheet]'),
  logNow: () => { const m = activeMeso(); openSheet({ kind: 'logNow', key: sessKey(m, ui.at.w, ui.at.d) }, '[data-act=logNow]'); },
  // Expand/collapse a card (layout only; nothing is written).
  cardToggle: el => {
    const m = activeMeso(), i = +el.dataset.i;
    const o = openCards(sessKey(m, ui.at.w, ui.at.d));
    if (o.has(i)) o.delete(i); else o.add(i);
    render();
    $(`[data-act=cardToggle][data-i="${i}"]`)?.focus();
  },

  set: el => {
    const c0 = curW();
    if (!c0) return;
    const { m, s, d } = c0;
    const i = +el.dataset.i, j = +el.dataset.j;
    const st = s.slots[i].sets[j];
    if (st.done) { toast('Tap the set number to untick'); return; } // a second tap never unticks (F03)
    const c = slotCtx(m, ui.at.w, d, s, i);
    const r = acceptSet(st, c.suggest(j), c.ex); // suggestion from the data, the same values the screen shows
    if (r.error) {
      const el2 = $(`input[data-i="${i}"][data-j="${j}"][data-f="${r.error === 'weight' ? 'w' : 'r'}"]`);
      el2.classList.add('bad');
      el2.focus();
      toast(r.error === 'weight' ? 'Enter the weight (or mark it BW in Exercises)' : 'Enter reps (more than 0)');
      return;
    }
    const cur0 = currentSlot(s);
    tickSet(st, r, Date.now());
    if (!slotOpen(s.slots[i])) openCards(sessKey(m, ui.at.w, d)).delete(i); // its last set: collapse it
    save();
    if (!s.done) startRest(m.days[d].exercises[i].type, { w: ui.at.w, d, i, j }); // never while editing a finished one
    render();
    if (!s.done) scrollToCurrent(cur0, currentSlot(s), i);
  },
  // Set number: a done set can be unticked (confirm). Undone sets get Skip / Warm-up with the set sheet (2.1).
  // ↑ chip: tap writes last+step and the bottom of the range into untouched sets; tap again clears them.
  bump: el => {
    const c0 = curW();
    if (!c0) return;
    const { m, s, d } = c0;
    const c = slotCtx(m, ui.at.w, d, s, +el.dataset.i);
    if (!c.last || !c.meta.reps) return;
    const n = toggleBump(c.sl, c.last, c.step, c.meta.reps);
    save();
    render();
    if (bumpOn(c.sl) && n) toast(`Filled ${n} set${n === 1 ? '' : 's'}`, { label: 'Undo', act: () => { if (bumpOn(c.sl)) toggleBump(c.sl, c.last, c.step, c.meta.reps); }, guard: writeGuard() });
  },
  wkMenu: () => {
    if (!cardWritable()) return;
    const m = activeMeso(), { w, d } = ui.at;
    openSheet({ kind: 'workout', key: sessKey(m, w, d) }, '[data-act=wkMenu]');
  },
  // Skip the open workout (from the ⋯ sheet or the Finish sheet's "Nothing logged yet").
  wkSkip: () => {
    const m = activeMeso(), { w, d } = ui.at;
    if (!cardWritable()) { closeSheet(); return; }
    const r = skipWorkout(m, w, d, Date.now());
    ui.sheet = null;
    if (r.error) { render(); if (r.error === 'done') toast('Sets are logged — finish it instead'); return; }
    if (rest?.at && rest.at.w === w && rest.at.d === d) stopRest();
    save();
    if (!m.complete) ui.at = { meso: m.id, ...m.pos }; // on to the next workout
    render();
    window.scrollTo(0, 0);
    const name = m.days[d].name;
    toast(`Skipped ${name}`, { label: 'Undo', act: () => { restoreSkip(m, w, d, r.snap); ui.at = { meso: m.id, w, d }; },
      guard: () => activeMeso() === m && !!m.log[`${w}-${d}`]?.skipped });
  },
  doAnyway: () => {
    const m = activeMeso(), { w, d } = ui.at;
    const r = unskipWorkout(m, w, d);
    save();
    render();
    if (r.moved) toast(m.complete ? 'Block no longer complete' : `Next up is now W${m.pos.w + 1} ${m.days[m.pos.d].name}`);
  },
  wkDiscard: () => {
    if (!ui.sheet?.confirmDiscard) { ui.sheet.confirmDiscard = true; render(); $('#sheet [data-act=wkDiscard]')?.focus(); return; }
    const m = activeMeso(), { w, d } = ui.at, k = `${w}-${d}`;
    if (!cardWritable()) { closeSheet(); return; }
    const r = discardWorkout(m, w, d);
    ui.sheet = null;
    if (r.error) { render(); return; }
    if (rest?.at && rest.at.w === w && rest.at.d === d) stopRest();
    save();
    render();
    toast('Workout discarded', { label: 'Undo', act: () => { m.log[k] = r.s; }, guard: () => activeMeso() === m && !m.log[k] });
  },
  wkDiscardKeep: () => { ui.sheet.confirmDiscard = false; render(); $('#sheet [data-act=wkDiscard]')?.focus(); },
  // Set number: opens the set sheet (Untick / Skip / Delete). Nothing is written until a row is tapped.
  setNum: el => {
    if (!cardWritable()) return;
    const m = activeMeso(), { w, d } = ui.at, { i, j } = el.dataset;
    openSheet({ kind: 'set', key: sessKey(m, w, d), i: +i, j: +j }, `[data-act=setNum][data-i="${i}"][data-j="${j}"]`);
  },
  setUntick: () => {
    const c = sheetSetW();
    if (!c || !c.st.done) return;
    const { s, i, j, st } = c, snap = snapSet(st);
    untickSet(st);
    const a = rest?.at;
    if (!s.done && a && a.w === ui.at.w && a.d === ui.at.d && a.i === i && a.j === j) stopRest();
    save();
    closeSheet();
    toast(`Set ${j + 1} unticked`, { label: 'Undo', act: () => restoreSet(st, snap), guard: writeGuard() });
  },
  setSkip: () => {
    const c = sheetSetW();
    if (!c || !skipSet(c.st)) return;
    save();
    closeSheet();
    $(`[data-act=unskipSet][data-i="${c.i}"][data-j="${c.j}"]`)?.focus(); // the ↺ that replaced the number
    const st = c.st;
    toast(`Set ${c.j + 1} skipped`, { label: 'Undo', act: () => unskipSet(st), guard: writeGuard() });
  },
  setUnskip: () => { const c = sheetSetW(); if (!c) return; unskipSet(c.st); save(); closeSheet(); },
  // ↺ on a skipped set: one tap back.
  unskipSet: el => {
    const c = curW();
    const st = c?.s.slots[+el.dataset.i]?.sets[+el.dataset.j];
    if (!st) return;
    unskipSet(st);
    save();
    render();
    $(`[data-act=setNum][data-i="${el.dataset.i}"][data-j="${el.dataset.j}"]`)?.focus();
  },
  setDelete: el => {
    if (el.dataset.typed === 'true') { ui.sheet.confirmDel = true; render(); $('#sheet [data-act=setDelete]')?.focus(); return; }
    const c = sheetSetW();
    if (!c) return;
    const { sl, i, j } = c;
    const r = deleteSet(sl, j);
    if (r.error) { closeSheet(); return; }
    const a = rest?.at;
    if (a && a.w === ui.at.w && a.d === ui.at.d && a.i === i && a.j > j) a.j--; // the timer's set moved up
    save();
    ui.sheet = null;
    render();
    toast(`Set ${j + 1} deleted`, { label: 'Undo', act: () => sl.sets.splice(j, 0, r.set), guard: writeGuard() });
  },
  setDelKeep: () => { ui.sheet.confirmDel = false; render(); $('#sheet [data-act=setDelete]')?.focus(); },
  // Skip the exercise (or the rest of it) from the card ⋯ sheet; Unskip from there or the card's inline Undo.
  skipSlot: () => {
    const c = curW(), sh = ui.sheet;
    const sl = c && sh?.kind === 'card' && sh.key === sessKey(c.m, c.w, c.d) && c.s.slots[sh.i];
    if (!sl) { closeSheet(); return; }
    if (!skipSlot(sl)) { closeSheet(); return; }
    save();
    closeSheet();
    const g = writeGuard();
    toast(`${exById(sl.exId)?.name} skipped`, { label: 'Undo', act: () => unskipSlot(sl), guard: () => g() && !!sl.skip });
  },
  unskipSlot: el => {
    const c = curW();
    const sl = c?.s.slots[+el.dataset.i];
    if (!sl || !unskipSlot(sl)) return;
    save();
    if (ui.sheet) closeSheet(); else render();
    $(`[data-act=cardMenu][data-i="${el.dataset.i}"]`)?.focus();
  },
  addSet: el => { const c = curW(); if (!c) return; c.s.slots[+el.dataset.i].sets.push(...blankSets(1)); save(); render(); },
  rmSet: el => {
    const c = curW();
    if (!c) return;
    const sl = c.s.slots[+el.dataset.i];
    if (canRemoveLastSet(sl)) { sl.sets.pop(); save(); render(); return; }
    const n = sl.sets.length, last = sl.sets[n - 1];
    if (n > 1) toast(last.done ? `Untick set ${n} first (tap its number)` : `Clear set ${n} first`);
  },
  // Feedback only changes sl.fb; the plan changes only inside finishSession (never re-run when editing).
  fb: el => { const c = curW(); if (!c) return; c.s.slots[+el.dataset.i].fb[el.dataset.k] = +el.dataset.v; save(); render(); },

  // Finish opens the sheet; finishGo does it. Typed-but-unticked sets are logged or skipped, never dropped (F07).
  finish: () => {
    const c0 = curW();
    if (!c0 || c0.s.done) return; // Finish runs once; editing a finished workout never re-runs it
    openSheet({ kind: 'finish' });
  },
  finishGo: el => {
    ui.sheet = null;
    const c0 = curW();
    if (!c0 || c0.s.done) { render(); return; }
    const { m, s, w, d } = c0;
    const snap = finishSnapshot(m, w, d);
    const typed = finishReview(s).typed;
    if (el.dataset.mode !== 'plain' && typed.length) {
      const accept = (i, j) => { const x = slotCtx(m, w, d, s, i); return acceptSet(s.slots[i].sets[j], x.suggest(j), x.ex); };
      const res = applyTyped(s, typed, accept, el.dataset.mode, Date.now());
      if (res.error) { // nothing changed: show the set that needs a value (opening its card)
        openCards(sessKey(m, w, d)).add(res.i);
        render();
        const inp = $(`input[data-i="${res.i}"][data-j="${res.j}"][data-f="${res.error === 'weight' ? 'w' : 'r'}"]`);
        inp?.classList.add('bad');
        inp?.scrollIntoView({ block: 'center' });
        inp?.focus();
        toast(res.error === 'weight' ? 'Enter the weight (or mark it BW in Exercises)' : 'Enter reps (more than 0)');
        return;
      }
    }
    const changes = finishSession(m, w, d, s, Date.now()).changes.map(c => `${exById(c.exId)?.name} ${c.from}→${c.to}`);
    ui.at = null;
    stopRest();
    save();
    render();
    window.scrollTo(0, 0);
    toast(changes.length ? `Saved. Next week: ${changes.join(', ')}` : 'Workout saved 💪', {
      label: 'Undo',
      act: () => { restoreFinish(m, snap); ui.at = { meso: m.id, w, d }; },
      // The session is finished on purpose here; this Undo reverses the Finish, so it's checked against that.
      guard: () => canUndoFinish(m, w, d, s),
    });
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
  // Keeps the edits: same draft through the new-block path, named like Copy does.
  // Keeps the edits as a NEW block without switching to it (the current block stays active).
  saveCopy: () => {
    const fields = draftFields(ui.draft);
    if (!fields) return;
    if (!/ \(copy\)$/.test(fields.name)) fields.name += ' (copy)';
    S.mesos.push(newMeso(fields));
    ui.draft = null;
    save();
    render();
    window.scrollTo(0, 0);
    toast('Saved as a copy — tap Make active when you want to switch');
  },
  saveDraft: () => {
    const D = ui.draft;
    const fields = draftFields(D);
    if (!fields) return;
    if (D.editId) {
      const m = S.mesos.find(x => x.id === D.editId);
      if (!canSaveEdit(m)) {
        toast(m ? 'This block now has logged workouts — save your edits as a copy' : 'This block no longer exists');
        render(); // swaps Save for "Save as a copy"
        return;
      }
      m.log = {}; // only empty sessions are left; drop them so none is out of line with the edited days
      Object.assign(m, fields);
    } else {
      const m = newMeso(fields);
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
    S.exercises.push({ id: uid(), name, muscle: $('#newExMuscle').value, bw: false, timed: false });
    save();
    render();
    toast(`Added ${name}`);
  },
  exFlag: el => { const ex = exById(el.dataset.id); ex[el.dataset.k] = !ex[el.dataset.k]; save(); render(); },
  // Delete only what nothing refers to; otherwise explain and offer Rename (history is kept by id).
  delExercise: el => {
    const ex = exById(el.dataset.id);
    const u = exerciseUse(S, ex.id);
    const inDraft = draftUses(ui.draft, ex.id);
    if (!canDeleteExercise(u) || inDraft) {
      const why = u.loggedSets ? `Has ${u.loggedSets} logged set${u.loggedSets === 1 ? '' : 's'} — can’t delete`
        : u.inPlans.length ? `Used in ${u.inPlans.join(', ')} — can’t delete`
          : inDraft ? 'Used in the plan you’re editing — can’t delete' : 'Used in a workout — can’t delete';
      const focusName = () => { const inp = $(`[data-rename="${ex.id}"]`); inp?.focus(); inp?.select(); };
      toast(why, { label: 'Rename', act: () => { ui.renaming = ex.id; }, then: focusName });
      return;
    }
    if (!confirm(`Delete ${ex.name}?`)) return;
    S.exercises = S.exercises.filter(e => e.id !== ex.id);
    save();
    render();
  },
  exRename: el => {
    ui.renaming = el.dataset.id;
    render();
    const inp = $(`[data-rename="${el.dataset.id}"]`);
    inp?.focus();
    inp?.select();
  },

  unit: el => { S.settings.unit = el.dataset.v; save(); render(); },
  // Read-only: export exactly what is stored, not the in-memory (normalized, maybe edited) copy.
  exportData: () => shareFile(`liftbook-backup-${new Date().toISOString().slice(0, 10)}.json`, readOnly ? boot.raw : JSON.stringify(S), 'application/json'),
  downloadRaw: () => shareFile(`liftbook-unreadable-${new Date().toISOString().slice(0, 10)}.txt`, boot.raw ?? '', 'text/plain'),
  reload: () => location.reload(),
  startFresh: () => {
    const msg = boot.copied
      ? 'Start fresh? The unreadable data stays saved on this phone as a recovery copy.'
      : 'The unreadable data could NOT be backed up on this phone. Download it first, or it will be lost. Start fresh anyway?';
    if (!confirm(msg)) return;
    S = freshState();
    mode = 'ok';
    save();
    render();
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
  if (b === 'exMuscle') { exById(t.dataset.id).muscle = t.value; save(); render(); return; }
  if (b === 'step') {
    const ex = exById(t.dataset.id);
    setStep(ex, t.value);
    save();
    return;
  }
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
  if ('swapq' in t.dataset) { if (ui.sheet?.kind === 'swap') { ui.sheet.q = t.value; redrawSwapList(); } return; }
  if (t.dataset.f) {
    t.classList.remove('bad');
    const c0 = curW();
    if (!c0) return;
    const { m, s, d } = c0;
    const i = +t.dataset.i, j = +t.dataset.j;
    const sl = s.slots[i];
    sl.sets[j][t.dataset.f] = t.value.replace(',', '.');
    save();
    // The reps suggestion for this row depends on its typed weight; keep the shown placeholder equal to what ✓
    // would log. Other rows don't change: suggestions only follow TICKED earlier sets.
    if (t.dataset.f === 'w') {
      const ri = $(`input[data-i="${i}"][data-j="${j}"][data-f="r"]`);
      if (ri) ri.placeholder = slotCtx(m, ui.at.w, d, s, i).suggest(j).r;
    }
    // Keep −Set's state in step without a re-render (which would close the keyboard).
    const rm = $(`[data-act="rmSet"][data-i="${t.dataset.i}"]`);
    rm?.classList.toggle('off', !canRemoveLastSet(sl));
    rm?.setAttribute('aria-disabled', String(!canRemoveLastSet(sl)));
  } else if (t.dataset.bind && t.tagName === 'INPUT' && t.type !== 'checkbox') {
    onBind(t);
  }
});

// Rename: Enter or leaving the field saves, Esc cancels.
// Enter with an invalid name keeps the field open; leaving the field (blur) with one cancels the rename —
// iOS has no Esc, so blur must always be a way out.
function commitRename(inp, fromBlur) {
  const id = inp.dataset.rename;
  if (ui.renaming !== id) return; // already saved or cancelled
  const r = renameExercise(S, id, inp.value);
  if (r.error) {
    const msg = r.error === 'duplicate' ? 'Another exercise already has that name' : 'The name can’t be empty';
    if (fromBlur) { ui.renaming = null; render(); toast(`${msg} — name not changed`); }
    else { toast(msg); inp.focus(); }
    return;
  }
  ui.renaming = null;
  save();
  render();
}
document.addEventListener('keydown', e => {
  const t = e.target;
  // Enter / Search in the swap field: the first result, or Add when that's the only row.
  if (e.key === 'Enter' && 'swapq' in (t.dataset || {})) {
    e.preventDefault();
    if (t.value.trim()) $('#swaplist [data-act=swapPick], #swaplist [data-act=swapAdd]')?.click(); // first row on screen
    return;
  }
  if (e.key === 'Escape' && ui.sheet) { closeSheet(); return; }
  if (!t.dataset?.rename) return;
  if (e.key === 'Enter') { e.preventDefault(); commitRename(t); }
  else if (e.key === 'Escape') { ui.renaming = null; render(); }
});
document.addEventListener('focusout', e => { if (e.target.dataset?.rename) commitRename(e.target, true); });

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.bind && (t.tagName === 'SELECT' || t.type === 'checkbox')) onBind(t);
});

$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (mode !== 'ok') return;
  let text = null;
  try { text = await f.text(); } catch (err) { /* unreadable file → rejected below */ }
  const r = importInto(store, text, ({ blocks, workouts, last }) => confirm(
    `${blocks} block${blocks === 1 ? '' : 's'}, ${workouts} workout${workouts === 1 ? '' : 's'}`
    + `${last ? `, last on ${fmtDate(last)}` : ''}. Replace what’s on this phone?`));
  if (!r.ok) {
    const why = {
      invalid: 'That file isn’t a Liftbook backup',
      newer: 'This backup is from a newer version of Liftbook. Update the app first.',
      storage: 'Couldn’t read this phone’s storage. Nothing was changed.',
      backup: 'Couldn’t save a copy of your current data (storage full?). Nothing was imported.',
      save: 'Couldn’t save the backup (storage full?). Your data is unchanged.',
    }[r.reason];
    if (why) toast(why);
    return;
  }
  S = r.state;
  Object.assign(ui, { at: null, draft: null, progEx: null, edit: null });
  stopRest();
  render();
  toast('Backup restored');
});

// The timer keeps an absolute end time, so it catches up after the phone sleeps.
document.addEventListener('visibilitychange', () => { if (rest && !document.hidden) tickRest(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // A waiting update applies itself when the app returns to the foreground, unless something is in progress.
  navigator.serviceWorker.register('sw.js').then(reg => {
    let asked = false; // first install also fires controllerchange; only reload when we asked
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (asked) location.reload(); });
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) return;
      await reg.update().catch(() => {});
      const focused = !!document.activeElement?.matches('input, select, textarea');
      if (reg.waiting && canAutoUpdate({ rest: !!rest, focused, sheet: !!ui.sheet, edit: !!ui.edit, draft: !!ui.draft, toast: !!toastAction })) { asked = true; reg.waiting.postMessage('skip'); }
    });
  });
}

render();
