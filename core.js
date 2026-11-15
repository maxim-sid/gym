// Pure logic shared by the app (classic script, loaded before app.js) and the Node tests (require).
// No DOM, no globals: everything takes its input as arguments.
(function (root) {
  'use strict';

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

  // Logged as added load (blank = bodyweight only). Seeded by exact name; editable in the Exercises tab.
  // Band exercises are included: they have no weight to log.
  const BW_NAMES = ['Weighted Dips', 'Weighted Pull-up', 'Chin-up (bodyweight)', 'Push-up', 'Hanging Leg Raise', 'Ab Wheel', 'Dip', 'Pull-up',
    'Finger Extension (band)', 'Static Hold (mid-range curl or band/cable pull)'];

  const uid = () => Math.random().toString(36).slice(2, 10);
  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);

  function freshState() {
    return {
      v: 1,
      settings: { unit: 'kg', restMain: 180, restAcc: 90 },
      exercises: DEFAULT_EX.map(([name, muscle]) => ({ id: uid(), name, muscle, bw: BW_NAMES.includes(name), timed: false })),
      mesos: [],
      activeId: null,
    };
  }

  // Fills only missing containers and defaults that the readers rely on. Never touches logged sets,
  // dates or values. Idempotent. Returns true if it changed anything.
  function normalize(s) {
    let changed = false;
    const fill = (o, k, v) => { if (o[k] == null) { o[k] = v; changed = true; } };
    fill(s, 'settings', {});
    if (isObj(s.settings)) {
      fill(s.settings, 'unit', 'kg');
      fill(s.settings, 'restMain', 180);
      fill(s.settings, 'restAcc', s.settings.rest ?? 90);
    }
    fill(s, 'exercises', []);
    fill(s, 'mesos', []);
    if (Array.isArray(s.mesos)) {
      s.mesos.forEach(m => {
        if (!isObj(m)) return;
        fill(m, 'log', {});
        fill(m, 'pos', { w: 0, d: 0 });
        fill(m, 'days', []);
        fill(m, 'style', 'rp');
        if (!isObj(m.log)) return;
        Object.values(m.log).forEach(ss => {
          if (isObj(ss) && Array.isArray(ss.slots)) ss.slots.forEach(sl => { if (isObj(sl)) fill(sl, 'fb', {}); });
        });
      });
    }
    // Exercise flags, seeded once (a value the user set, including false, is never overwritten).
    if (Array.isArray(s.exercises)) {
      const timedIds = new Set();
      (Array.isArray(s.mesos) ? s.mesos : []).forEach(m => isObj(m) && Array.isArray(m.days) && m.days.forEach(d =>
        isObj(d) && Array.isArray(d.exercises) && d.exercises.forEach(sl => { if (isObj(sl) && sl.timed) timedIds.add(sl.exId); })));
      s.exercises.forEach(ex => {
        if (!isObj(ex)) return;
        fill(ex, 'bw', BW_NAMES.includes(ex.name));
        fill(ex, 'timed', timedIds.has(ex.id));
      });
    }
    return changed;
  }

  // Shape only: is it safe for the readers to walk? No business rules.
  function validate(s) {
    if (!isObj(s) || !isObj(s.settings) || !Array.isArray(s.exercises) || !Array.isArray(s.mesos)) return false;
    if (!s.exercises.every(e => isObj(e) && typeof e.id === 'string')) return false;
    return s.mesos.every(m => isObj(m) && Array.isArray(m.days) && isObj(m.log) && isObj(m.pos)
      && m.days.every(d => isObj(d) && Array.isArray(d.exercises))
      && Object.values(m.log).every(ss => isObj(ss) && Array.isArray(ss.slots)
        && ss.slots.every(sl => isObj(sl) && Array.isArray(sl.sets) && sl.sets.every(isObj))));
  }

  // raw: the string from storage (or null). → {state, changed} | {recovery: reason} | {readOnly: state}
  function loadFrom(raw) {
    if (raw == null) return { state: freshState(), changed: false };
    let s;
    try { s = JSON.parse(raw); } catch (e) { return { recovery: 'corrupt' }; }
    if (!isObj(s) || typeof s.v !== 'number') return { recovery: 'unknown' };
    if (s.v > 1) {
      // Written by a newer version: shown as is (best effort), never saved.
      try { normalize(s); } catch (e) { /* display only */ }
      return { readOnly: s };
    }
    if (s.v !== 1) return { recovery: 'unknown' };
    const changed = normalize(s);
    if (!validate(s)) return { recovery: 'invalid' };
    return { state: s, changed };
  }

  const KEY = 'liftbook-v1', BACKUP_KEY = 'liftbook-backup-auto', RECOVERY_PREFIX = 'liftbook-recovery-';

  // Keep one copy of unreadable data under its own key; skipped if an identical copy already exists.
  function keepRecoveryCopy(storage, raw, now) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(RECOVERY_PREFIX) && storage.getItem(k) === raw) return true;
      }
      storage.setItem(RECOVERY_PREFIX + new Date(now).toISOString(), raw);
      return true;
    } catch (e) { return false; }
  }

  // All storage decisions on load. storage: anything with getItem/setItem/key/length.
  // Writes at most a recovery copy or the backup-auto copy; never KEY.
  // → {state, mode: 'ok'|'readOnly'|'recovery', reason?, raw, copied?}
  function loadState(storage, now) {
    let raw;
    try { raw = storage.getItem(KEY); } catch (e) { return { state: null, mode: 'recovery', reason: 'storage', raw: null, copied: false }; }
    const r = loadFrom(raw);
    if (r.recovery) return { state: null, mode: 'recovery', reason: r.recovery, raw, copied: keepRecoveryCopy(storage, raw, now) };
    if (r.readOnly) return { state: r.readOnly, mode: 'readOnly', raw };
    if (r.changed) { try { storage.setItem(BACKUP_KEY, raw); } catch (e) { /* best effort */ } }
    return { state: r.state, mode: 'ok', raw };
  }

  /* ---------- plan, sessions and progression (moved from app.js unchanged) ---------- */

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

  const doneSets = sl => sl.sets.filter(x => x.done);
  const e1rm = (w, r) => w * (1 + r / 30);
  const blankSets = n => Array.from({ length: n }, () => ({ w: '', r: '', done: false }));
  const roundLoad = (w, unit) => { const step = unit === 'kg' ? 2.5 : 5; return Math.round(w / step) * step; };
  const repsTxt = (r, timed) => (r ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`) + (timed ? ' s' : '') : '');
  function parseReps(str) {
    const m = String(str).match(/(\d+)\s*(?:[-–]\s*(\d+))?/);
    if (!m) return null;
    const a = +m[1], b = +(m[2] ?? m[1]);
    return [Math.min(a, b), Math.max(a, b)];
  }

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

  // A not-yet-stored session for week w, day d: every planned slot with blank planned sets.
  function blankSession(m, w, d) {
    return {
      date: null, done: false,
      slots: m.days[d].exercises.map((sl, i) => ({ exId: sl.exId, sets: blankSets(plannedSets(m, d, i, w)), fb: {} })),
    };
  }

  // Lookup; with create, stores blankSession() first. Views only look up; write paths create.
  function session(m, w, d, create) {
    const k = `${w}-${d}`;
    if (!m.log[k] && create) m.log[k] = blankSession(m, w, d);
    return m.log[k];
  }

  // Has anything real been logged in this meso? (Empty sessions created by a tap don't count.)
  const hasLogs = m => Object.values(m.log).some(s => s.done || s.skipped
    || s.slots.some(sl => sl.sets.some(x => x.done || x.w !== '' || x.r !== '')));

  // The plan editor replaces days wholesale, so it may only save over a block with nothing logged.
  // (The editor stays open across tabs, so this is re-checked at save time.)
  const canSaveEdit = m => !!m && !hasLogs(m);

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

  // The data part of "Finish workout". changes: [{exId, from, to}] for next week's set counts (rp only).
  function finishSession(m, w, d, s, now) {
    const base = s.slots.map(sl => sl.sets.length);
    s.slots.forEach(sl => { sl.sets = doneSets(sl); });
    const changes = [];
    if (!isFixed(m) && !isDeload(m, w) && w + 1 < m.weeks) {
      m.days[d].exercises.forEach((slot, i) => {
        const n = Math.max(1, Math.min(12, base[i] + setDelta(s.slots[i].fb)));
        slot.plan[w + 1] = n;
        if (n !== base[i]) changes.push({ exId: slot.exId, from: base[i], to: n });
        const next = m.log[`${w + 1}-${d}`];
        if (next && !next.done && !next.slots[i].sets.some(x => x.done)) next.slots[i].sets = blankSets(n);
      });
    }
    s.done = true;
    s.date = now;
    advance(m);
    return { changes };
  }

  // ✓ on a set: typed value, else the suggestion (prefill), else the rules below. Never invents a 0.
  // pre: {w, r} suggested values (a suggested weight of 0 counts as none). → {ok, w, r} | {error: 'weight'|'reps'}
  function acceptSet(st, pre, ex) {
    const t = v => String(v ?? '').trim(); // ' ' counts as blank
    const preW = t(pre?.w) === '' || +pre.w === 0 ? '' : t(pre.w);
    const w = t(st.w) !== '' ? t(st.w) : preW;
    const r = t(st.r) !== '' ? t(st.r) : t(pre?.r);
    if (w === '' ? !ex?.bw : isNaN(+w)) return { error: 'weight' };   // blank is only OK for bodyweight exercises
    if (r === '' || !(+r > 0)) return { error: 'reps' };
    return { ok: true, w, r };
  }

  // ✓: marks a set done with the accepted values and the tick time. A done set is left alone (no accidental untick).
  function tickSet(st, accepted, now) {
    if (st.done) return false;
    st.w = accepted.w;
    st.r = accepted.r;
    st.done = true;
    st.t = now;
    return true;
  }

  function untickSet(st) {
    st.done = false;
    delete st.t;
  }

  // −Set may only remove an untouched last set (not done, nothing typed), and never the only set.
  function canRemoveLastSet(sl) {
    const last = sl.sets[sl.sets.length - 1];
    return sl.sets.length > 1 && !last.done && last.w === '' && last.r === '';
  }

  // "100×8, 100×7" · bodyweight "BW×8, +20×6" · timed "30 s, +10 kg · 25 s". Legacy weighted 0 → "8 reps".
  function fmtSets(sets, ex, unit) {
    return sets.map(x => {
      const w = +x.w;
      if (ex?.timed) return w > 0 ? `+${w} ${unit} · ${x.r} s` : `${x.r} s`;
      if (ex?.bw) return w > 0 ? `+${w}×${x.r}` : `BW×${x.r}`;
      return w ? `${w}×${x.r}` : `${x.r} reps`;
    }).join(', ');
  }

  // Progress chart for one exercise. → {metric: 'e1rm'|'load'|'reps'|'hold', points: [{x: date, y}]}
  // e1rm: only sets with a known load (w > 0) and 1–12 reps; sessions without one are left out, not plotted as 0.
  function chartPoints(S, ex) {
    const perf = perfFor(S, ex.id);
    const maxOf = (sets, f) => Math.max(...sets.map(f));
    const per = f => perf.map(p => ({ x: p.date, y: f(p.sets) }));
    if (ex.timed) return { metric: 'hold', points: per(sets => maxOf(sets, x => +x.r)) };
    const anyLoad = perf.some(p => p.sets.some(x => +x.w > 0));
    if (!anyLoad) return { metric: 'reps', points: per(sets => maxOf(sets, x => +x.r)) };
    if (ex.bw) return { metric: 'load', points: per(sets => Math.max(0, maxOf(sets, x => +x.w || 0))) };
    const points = perf.map(p => {
      const q = p.sets.filter(x => +x.w > 0 && +x.r >= 1 && +x.r <= 12);
      return q.length ? { x: p.date, y: maxOf(q, x => e1rm(+x.w, +x.r)) } : null;
    }).filter(Boolean);
    return { metric: 'e1rm', points };
  }

  function allSessions(S) {
    const out = [];
    S.mesos.forEach(m => Object.entries(m.log).forEach(([k, s]) => {
      if (!s.done) return;
      const [w, d] = k.split('-').map(Number);
      out.push({ m, w, d, s });
    }));
    return out.sort((a, b) => b.s.date - a.s.date);
  }

  function perfFor(S, exId) {
    const out = [];
    allSessions(S).forEach(({ s }) => s.slots.forEach(sl => {
      if (sl.exId !== exId) return;
      const sets = doneSets(sl).filter(x => +x.r > 0);
      if (sets.length) out.push({ date: s.date, sets });
    }));
    return out.sort((a, b) => a.date - b.date);
  }

  const BEFORE_IMPORT_KEY = 'liftbook-before-import';

  // What a state holds, for the import confirm. Only finished workouts count.
  function summarize(s) {
    let workouts = 0, last = null;
    s.mesos.forEach(m => Object.values(m.log).forEach(ss => {
      if (!ss.done) return;
      workouts++;
      if (typeof ss.date === 'number' && (last == null || ss.date > last)) last = ss.date;
    }));
    return { blocks: s.mesos.length, workouts, last };
  }

  // Import a backup file through the same path as loading. confirm(summary) → boolean decides.
  // Order: validate → confirm → copy the current stored string to BEFORE_IMPORT_KEY → write KEY.
  // Nothing is written unless the file is valid and confirmed; KEY is not written if the copy fails.
  // → {ok: true, state, summary} | {ok: false, reason: 'invalid'|'newer'|'cancelled'|'storage'|'backup'|'save', summary?}
  function importInto(storage, text, confirm) {
    const r = loadFrom(text ?? '');
    if (r.readOnly) return { ok: false, reason: 'newer' };
    if (!r.state) return { ok: false, reason: 'invalid' };
    const summary = summarize(r.state);
    if (!confirm(summary)) return { ok: false, reason: 'cancelled', summary };
    let current;
    try { current = storage.getItem(KEY); } catch (e) { return { ok: false, reason: 'storage', summary }; }
    if (current != null) {
      try { storage.setItem(BEFORE_IMPORT_KEY, current); } catch (e) { return { ok: false, reason: 'backup', summary }; }
    }
    try { storage.setItem(KEY, JSON.stringify(r.state)); } catch (e) { return { ok: false, reason: 'save', summary }; }
    return { ok: true, state: r.state, summary };
  }

  const api = { DEFAULT_EX, uid, freshState, normalize, validate, loadFrom, loadState, summarize, importInto,
    KEY, BACKUP_KEY, RECOVERY_PREFIX, BEFORE_IMPORT_KEY,
    FEEDBACK, setDelta, doneSets, e1rm, blankSets, roundLoad, repsTxt, parseReps,
    totalWeeks, isDeload, isFixed, dayOrder, targetRIR, plannedSets, blankSession, session, hasLogs, canSaveEdit, prevSlot, advance,
    finishSession, allSessions, perfFor, BW_NAMES, acceptSet, fmtSets, chartPoints, tickSet, untickSet, canRemoveLastSet };
  if (typeof module === 'object' && module.exports) module.exports = api; else Object.assign(root, api);
})(this);
