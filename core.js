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

  /* ---------- saved builder draft and backup reminder (3.6) ---------- */
  const DRAFT_KEY = 'liftbook-draft'; // the unsaved plan builder draft, outside S
  // A stored draft, checked against today's data: exercises that no longer exist are dropped, and an edit of a block
  // that's gone becomes a new block. → the draft | null (unreadable or not a draft)
  function parseDraft(raw, S) {
    let D;
    try { D = JSON.parse(raw); } catch (e) { return null; }
    if (!isObj(D) || typeof D.name !== 'string' || !(+D.weeks > 0) || !Array.isArray(D.days)
      || !D.days.every(d => isObj(d) && Array.isArray(d.exercises))) return null;
    const ids = new Set(S.exercises.map(e => e.id));
    D.days.forEach(d => { d.exercises = d.exercises.filter(sl => isObj(sl) && ids.has(sl.exId) && Array.isArray(sl.plan)); });
    if (D.editId && !S.mesos.some(m => m.id === D.editId)) delete D.editId;
    return D;
  }
  // The backup file's text: the data as it will be once the export is recorded (lastExport = ts, reminder reset),
  // so a restored backup knows when it was made. S itself is only stamped once the share/download went ahead.
  function backupText(S, ts) {
    const copy = JSON.parse(JSON.stringify(S));
    copy.settings.lastExport = ts;
    delete copy.settings.backupHintOff;
    return JSON.stringify(copy);
  }
  // The Plan tab's backup reminder: due once there are finished workouts and the last export (or, never exported,
  // the first workout) is over 14 days ago, unless dismissed since that export. → {days} | null
  function backupDue(S, now) {
    const done = allSessions(S);
    if (!done.length) return null;
    const last = +S.settings.lastExport > 0 ? +S.settings.lastExport : null;
    if ((S.settings.backupHintOff ?? null) === (last ?? 0)) return null;
    const since = last ?? Math.min(...done.map(x => x.s.date));
    const days = Math.floor((now - since) / 864e5);
    return days > 14 ? { days } : null;
  }

  /* ---------- body log (3.8) ---------- */
  const isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
  // "82,5" → "82.5"; a weight is a number in (0, 1000). → string | null
  const bodyNum = v => { const t = String(v ?? '').trim().replace(',', '.'); return t !== '' && +t > 0 && +t < 1000 ? String(+t) : null; };
  function cleanBody(arr) {
    const by = {};
    arr.forEach(e => { if (e && isDay(e.d) && bodyNum(e.w)) by[e.d] = { d: e.d, w: bodyNum(e.w) }; }); // later wins
    return Object.values(by).sort((a, b) => (a.d < b.d ? -1 : 1));
  }
  // The local calendar day of a timestamp (or a 'YYYY-MM-DD' as is).
  const dayOf = t => (isDay(t) ? t : (() => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })());
  const dayShift = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10); // UTC math: no DST jumps
  // Add or replace the entry for date d (not after `today`, when given).
  // → {ok, prev (the replaced entry or null)} | {error: 'date'|'future'|'weight'}
  function addBody(S, d, w, today) {
    if (!isDay(d)) return { error: 'date' };
    if (today && d > today) return { error: 'future' };
    const v = bodyNum(w);
    if (!v) return { error: 'weight' };
    const list = Array.isArray(S.body) ? S.body : (S.body = []);
    const k = list.findIndex(e => e.d === d);
    const prev = k >= 0 ? list.splice(k, 1)[0] : null;
    list.push({ d, w: v });
    list.sort((a, b) => (a.d < b.d ? -1 : 1));
    return { ok: true, prev };
  }
  // Save from the Body form. Editing an entry (orig = its date) under a new date moves it: the old date goes.
  // → {ok, d, prev (replaced at d), orig (the removed original, if moved)} | {error} — undo with undoBodySave
  function saveBody(S, d, w, { orig = null, today } = {}) {
    const r = addBody(S, d, w, today);
    if (r.error) return r;
    const moved = orig && orig !== d ? removeBody(S, orig) : null;
    return { ok: true, d, prev: r.prev, orig: moved };
  }
  function undoBodySave(S, r) {
    removeBody(S, r.d);
    if (r.prev) addBody(S, r.prev.d, r.prev.w);
    if (r.orig) addBody(S, r.orig.d, r.orig.w);
  }
  // Remove the entry for date d. → the entry | null
  function removeBody(S, d) {
    const k = (S.body || []).findIndex(e => e.d === d);
    if (k < 0) return null;
    const e = S.body.splice(k, 1)[0];
    if (!S.body.length) delete S.body;
    return e;
  }
  // Bodyweight on a day (date string or timestamp): the latest entry on or before it. → number | null
  function bodyAt(S, t) {
    const d = dayOf(t);
    let w = null;
    for (const e of S.body || []) { if (e.d <= d) w = +e.w; else break; }
    return w;
  }
  // Current bodyweight: the latest Body entry, else the old Settings value (3.1), else null.
  const currentBody = S => (S.body?.length ? +S.body[S.body.length - 1].w : +S.settings?.bodyweight > 0 ? +S.settings.bodyweight : null);
  // For a workout on day t: its saved value is preferred by callers; then the log on that day; then the current one.
  const bodyFor = (S, t) => bodyAt(S, t) ?? currentBody(S);
  // Stats for the Body tab. avg of the 7 days ending today, and the same 4 weeks earlier; change = now − then.
  function bodyStats(S, today) {
    const list = S.body || [];
    const avg = (from, to) => { const xs = list.filter(e => e.d >= from && e.d <= to).map(e => +e.w); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    const r1 = x => (x == null ? null : Math.round(x * 10) / 10);
    const avg7 = avg(dayShift(today, -6), today);
    const then = avg(dayShift(today, -34), dayShift(today, -28));
    return { latest: list.length ? list[list.length - 1] : null, avg7: r1(avg7), change: avg7 != null && then != null ? r1(avg7 - then) : null };
  }
  // 7-day average at each entry (the entries in the 7 days up to it), for the chart's second line.
  const bodyAvgLine = S => (S.body || []).map(e => {
    const xs = S.body.filter(x => x.d <= e.d && x.d >= dayShift(e.d, -6)).map(x => +x.w);
    return { x: Date.parse(e.d), y: xs.reduce((a, b) => a + b, 0) / xs.length };
  });

  function freshState() {
    return {
      v: 1,
      settings: { unit: 'kg', restMain: 180, restAcc: 90, beepLoud: false, keepAwake: false },
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
      fill(s.settings, 'beepLoud', false);   // 2.8: both opt-in
      fill(s.settings, 'keepAwake', false);
    }
    fill(s, 'exercises', []);
    fill(s, 'mesos', []);
    // Body log (3.8): optional. Malformed entries are dropped (never the whole file); one per date, sorted.
    if ('body' in s) {
      const clean = Array.isArray(s.body) ? cleanBody(s.body) : [];
      if (JSON.stringify(clean) !== JSON.stringify(s.body)) { changed = true; if (clean.length) s.body = clean; else delete s.body; }
    }
    if (Array.isArray(s.mesos)) {
      s.mesos.forEach(m => {
        if (!isObj(m)) return;
        fill(m, 'log', {});
        fill(m, 'pos', { w: 0, d: 0 });
        fill(m, 'days', []);
        fill(m, 'style', 'rp');
        if (!isObj(m.log)) return;
        Object.values(m.log).forEach(ss => {
          // Finished by code from before 2.5 while marked skipped: done wins.
          if (isObj(ss) && ss.done && ('skipped' in ss || 'skippedAt' in ss)) { delete ss.skipped; delete ss.skippedAt; changed = true; }
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

  // Warm-up sets (3.3, x.wu): logged and shown, but never working sets: not in stats, history, suggestions,
  // counts or progression. "Working" helpers below are what every counting reader uses.
  const doneSets = sl => sl.sets.filter(x => x.done && !x.wu);
  const workSets = sl => sl.sets.filter(x => !x.wu);
  // Index of set j among the working sets (warm-ups sit at the top), or among the warm-ups for a warm-up.
  const workIndex = (sl, j) => sl.sets.slice(0, j).filter(x => !!x.wu === !!sl.sets[j]?.wu).length;
  // What the set's number cell shows: "W" for a warm-up, else its working number (1, 2, …).
  const setLabel = (sl, j) => (sl.sets[j]?.wu ? 'W' : String(workIndex(sl, j) + 1));
  const e1rm = (w, r) => w * (1 + r / 30);
  const blankSets = n => Array.from({ length: n }, () => ({ w: '', r: '', done: false }));
  const roundLoad = (w, unit) => { const step = unit === 'kg' ? 2.5 : 5; return Math.round(w / step) * step; };
  // Nearest multiple of step, without float noise (1.25 × 3 = 3.75, not 3.7500000000000004).
  const roundTo = (w, step) => Math.round(Math.round(w / step) * step * 1000) / 1000;
  // Weight step for an exercise: its own (dumbbells 2, dip belt 1.25 …) or the unit default.
  // Weight steps offered in the card ⋯ sheet and on the Exercises tab. A stored step outside the list
  // (plan.js or an import) is offered too, so it's never reset by accident. Not a positive number → unit default.
  const STEPS = [1, 1.25, 2, 2.5, 5];
  const stepChoices = ex => +ex?.step > 0 && !STEPS.includes(+ex.step) ? [...STEPS, +ex.step].sort((a, b) => a - b) : STEPS;
  const setStep = (ex, v) => { if (+v > 0) ex.step = +v; else delete ex.step; return ex; };
  const stepOf = (ex, unit) => +ex?.step > 0 ? +ex.step : unit === 'kg' ? 2.5 : 5;
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
    if (m.days[d].exercises[i].off) return 0; // retired from the plan (2.9b)
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

  // Finished workouts are read-only unless the user turned on Edit for exactly that session (F18).
  // key: the session's key (e.g. "<mesoId>:w-d"); editKey: the key Edit is on for, or null.
  // A skipped workout takes no writes at all (not even in Edit): "Do it anyway" (unskipWorkout) comes first.
  const canWrite = (s, key, editKey) => !s || (!s.skipped && (!s.done || (editKey != null && editKey === key)));

  // Undo of a Finish is allowed only while that exact session is still in the log and still finished (nothing has
  // replaced it, e.g. an import, and it wasn't undone already). It is the one write to a finished session that
  // doesn't need Edit: it reverses the Finish itself.
  const canUndoFinish = (m, w, d, s) => !!m && m.log[`${w}-${d}`] === s && !!s.done;

  // The plan editor replaces days wholesale, so it may only save over a block with nothing logged.
  // (The editor stays open across tabs, so this is re-checked at save time.)
  const canSaveEdit = m => !!m && !hasLogs(m);


  function advance(m) {
    for (let w = 0; w < totalWeeks(m); w++) {
      for (const d of dayOrder(m)) {
        const ss = m.log[`${w}-${d}`];
        if (!(ss?.done || ss?.skipped)) { m.pos = { w, d }; m.complete = false; return; } // skipped = passed
      }
    }
    m.complete = true;
  }

  // Anything the user put in a slot: a skip, a note, a done/skipped/typed set or a warm-up row.
  const slotHasContent = sl => !!(sl.skip || sl.note || sl.sets.some(x => x.done || x.skip || x.wu || typedSet(x)));
  const hasContent = ss => !!ss && (ss.done || ss.skipped || ss.slots.some(slotHasContent));
  // Untouched and following the plan: rebuildOpen / finish may rewrite it. (A swapped slot is the user's choice too.)
  const slotEmpty = sl => !sl.from && !slotHasContent(sl);
  const typedSet = x => String(x.w ?? '').trim() !== '' || String(x.r ?? '').trim() !== '';

  // The data part of "Finish workout". changes: [{exId, from, to}] for next week's set counts (rp only).
  // Only EMPTY unticked sets are dropped (after counting base); skipped sets keep their values (F07). The date is the
  // first tick, so a late Finish doesn't move it (F12) — computed only here, never on edit.
  function finishSession(m, w, d, s, now) {
    const base = s.slots.map(sl => workSets(sl).length); // warm-ups aren't planned sets
    s.slots.forEach(sl => {
      // Drop empty unticked sets, highest first, so the slot's saved indexes (skipMarked) follow each removal.
      for (let j = sl.sets.length - 1; j >= 0; j--) {
        const x = sl.sets[j];
        if (!(x.done || x.skip || typedSet(x))) { sl.sets.splice(j, 1); shiftIdx(sl, j, -1); }
      }
      delete sl.bump;
    });
    const changes = [];
    if (!isFixed(m) && !isDeload(m, w) && w + 1 < m.weeks) {
      m.days[d].exercises.forEach((slot, i) => {
        // Retired slots, and slots a session doesn't have (an exercise appended after it), have no progression.
        if (slot.off || !s.slots[i]) return;
        // A swapped slot's feedback is about the substitute; a skipped one holds (never shrinks next week).
        const n = swappedFrom(m, d, s, i) || s.slots[i].skip ? base[i] : Math.max(1, Math.min(12, base[i] + setDelta(s.slots[i].fb)));
        slot.plan[w + 1] = n;
        if (n !== base[i]) changes.push({ exId: slot.exId, from: base[i], to: n });
        const next = m.log[`${w + 1}-${d}`];
        // Next week's stored slot takes the new count only while it's untouched (nothing typed, skipped or swapped).
        if (next && !next.done && !next.skipped && next.slots[i] && slotEmpty(next.slots[i])) next.slots[i].sets = blankSets(n);
      });
    }
    s.done = true;
    const ticks = s.slots.flatMap(sl => sl.sets.filter(x => x.done && typeof x.t === 'number').map(x => x.t));
    s.date = ticks.length ? Math.min(...ticks) : now;
    advance(m);
    return { changes };
  }

  // What the Finish sheet shows. typed: unticked, unskipped sets with something typed ({i, j}).
  // empty: empty sets of STARTED exercises (any set done, typed or skipped); notStarted: exercises with none of
  // that. (Finish removes every empty set either way; this only splits the wording.)
  function finishReview(s) {
    const typed = [];
    let sets = 0, empty = 0, exercises = 0, notStarted = 0, skipped = 0, of = 0;
    s.slots.forEach((sl, i) => {
      if (!sl.sets.length && !sl.skip) return; // a retired exercise (2.9b): not part of this workout
      of++;
      if (sl.sets.some(x => x.done && !x.wu)) exercises++;
      if (sl.skip) skipped++; // a skipped exercise is neither "not started" nor has empty sets (all undone are skipped)
      const started = sl.skip || sl.sets.some(x => x.done || x.skip || typedSet(x));
      if (!started) { notStarted++; return; }
      sl.sets.forEach((x, j) => {
        if (x.done) { if (!x.wu) sets++; }
        else if (x.skip) return;
        else if (typedSet(x)) typed.push({ i, j });
        else empty++;
      });
    });
    return { exercises, of, sets, typed, empty, notStarted, skipped, nothing: !sets && !typed.length };
  }

  // "Log them" / "Skip them" for the typed sets. accept(i, j) → acceptSet result. All are checked first, so
  // an invalid one changes nothing. → {ok: true} | {error, i, j}
  function applyTyped(s, list, accept, mode, now) {
    if (mode === 'log') {
      const res = list.map(({ i, j }) => ({ i, j, r: accept(i, j) }));
      const bad = res.find(x => x.r.error);
      if (bad) return { error: bad.r.error, i: bad.i, j: bad.j };
      res.forEach(({ i, j, r }) => tickSet(s.slots[i].sets[j], r, now));
    } else {
      list.forEach(({ i, j }) => { s.slots[i].sets[j].skip = true; });
    }
    return { ok: true };
  }

  // Undo for Finish: everything finishSession (and the sheet's log/skip) can change for week w, day d.
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  function finishSnapshot(m, w, d) {
    return {
      w, d, pos: clone(m.pos), complete: m.complete,
      cur: clone(m.log[`${w}-${d}`]), next: clone(m.log[`${w + 1}-${d}`]),
      plans: m.days[d].exercises.map(e => clone(e.plan)),
    };
  }
  function restoreFinish(m, snap) {
    const put = (k, v) => { if (v === undefined) delete m.log[k]; else m.log[k] = clone(v); };
    put(`${snap.w}-${snap.d}`, snap.cur);
    // A next-week session that didn't exist before Finish is removed only while it's still blank;
    // anything logged in it since is kept.
    const nk = `${snap.w + 1}-${snap.d}`;
    if (snap.next !== undefined || !hasContent(m.log[nk])) put(nk, snap.next);
    m.days[snap.d].exercises.forEach((e, i) => { if (snap.plans[i]) e.plan = clone(snap.plans[i]); });
    m.pos = clone(snap.pos);
    m.complete = snap.complete;
  }

  // ✓ on a set: typed value, else the suggestion (prefill), else the rules below. Never invents a 0.
  // pre: {w, r} suggested values (a suggested weight of 0 counts as none). → {ok, w, r} | {error: 'weight'|'reps'}
  function acceptSet(st, pre, ex) {
    const t = v => String(v ?? '').trim(); // ' ' counts as blank
    const preW = t(pre?.w) === '' || +pre.w === 0 ? '' : t(pre.w);
    const w = t(st.w) !== '' ? t(st.w) : preW;
    const r = t(st.r) !== '' ? t(st.r) : t(pre?.r);
    if (w === '' ? !ex?.bw && !st.wu : isNaN(+w)) return { error: 'weight' }; // blank: bodyweight exercises and warm-ups
    if (r === '' || !(+r > 0)) return { error: 'reps' };
    return { ok: true, w, r };
  }

  // ✓: marks a set done with the accepted values and the tick time. A done set is left alone (no accidental untick).
  function tickSet(st, accepted, now) {
    if (st.done) return false;
    delete st.skip;
    st.w = accepted.w;
    st.r = accepted.r;
    st.done = true;
    st.t = now;
    return true;
  }

  // For Undo: a copy of a set's fields, and putting them back exactly (fields absent in the copy are removed).
  const snapSet = st => ({ ...st });
  function restoreSet(st, snap) {
    Object.keys(st).forEach(k => { if (!(k in snap)) delete st[k]; });
    Object.assign(st, snap);
  }

  function untickSet(st) {
    st.done = false;
    delete st.t;
  }

  // After editing a finished workout: drop trailing sets that are not done and have nothing typed, keeping at least
  // one set per slot (a slot that already has none stays as it is). → number of sets removed.
  function tidySlots(s) {
    let n = 0;
    s.slots.forEach(sl => {
      while (sl.sets.length > 1) {
        const x = sl.sets[sl.sets.length - 1];
        if (x.done || x.skip || x.wu || String(x.w).trim() !== '' || String(x.r).trim() !== '') break;
        sl.sets.pop();
        n++;
      }
    });
    return n;
  }

  // −Set may only remove an untouched last set (not done, nothing typed), and never the only set.
  function canRemoveLastSet(sl) {
    const last = sl.sets[sl.sets.length - 1];
    return sl.sets.length > 1 && !last.done && !last.skip && !last.wu && last.w === '' && last.r === '';
  }

  /* ---------- current card (2.6) ---------- */
  // A slot still has work while it isn't skipped and has an undone, unskipped set.
  const slotOpen = sl => !sl.skip && sl.sets.some(x => !x.done && !x.skip && !x.wu);
  // The card to show expanded: the slot of the most recently ticked set (by t) if it still has work, else the
  // first slot with work. → index, or -1 when nothing is left.
  function currentSlot(s) {
    let best = -1, bt = -Infinity;
    s.slots.forEach((sl, i) => sl.sets.forEach(x => { if (x.done && typeof x.t === 'number' && x.t > bt) { bt = x.t; best = i; } }));
    if (best >= 0 && slotOpen(s.slots[best])) return best;
    return s.slots.findIndex(slotOpen);
  }

  // The next set to do: {i, j} in the current card, or null when every set is done or skipped.
  function nextSet(s) {
    const i = currentSlot(s);
    if (i < 0) return null;
    return { i, j: s.slots[i].sets.findIndex(x => !x.done && !x.skip && !x.wu) };
  }
  // Every set ticked or skipped (and at least one ticked): Finish becomes the main action.
  const allLogged = s => s.slots.some(sl => sl.sets.some(x => x.done && !x.wu)) && s.slots.every(sl => sl.skip || sl.sets.every(x => x.done || x.skip || x.wu));

  /* ---------- forgotten Finish (2.7) ---------- */
  const STALE_MS = 6 * 3600e3;
  // Newest tick time in a session, or null.
  const lastTick = s => s.slots.reduce((mx, sl) => sl.sets.reduce((a, x) => (x.done && typeof x.t === 'number' && x.t > (a ?? -Infinity) ? x.t : a), mx), null);
  // An unfinished, unskipped stored session whose newest tick is over 6 h old (the newest such one).
  // → {key, w, d, t} | null
  function staleSession(m, now) {
    let best = null;
    for (const [key, s] of Object.entries(m?.log || {})) {
      if (s.done || s.skipped) continue;
      const t = lastTick(s);
      if (t != null && now - t > STALE_MS && (!best || t > best.t)) {
        const [w, d] = key.split('-').map(Number);
        best = { key, w, d, t };
      }
    }
    return best;
  }
  // Ticking into this session now would merge a new workout into an old one.
  const isStale = (s, now) => !!s && !s.done && !s.skipped && lastTick(s) != null && now - lastTick(s) > STALE_MS;

  /* ---------- live plan editing (2.9a) ---------- */
  // Plan edits made from workout (w, d) count from that workout on, or from the next week once it's finished.
  const planFromWeek = (m, w, d) => (m.log[`${w}-${d}`]?.done ? w + 1 : w);
  // Sets for slot i from week fromW on: later per-week entries go, so plannedSets returns n from then on.
  function setPlanSets(m, d, i, fromW, n) {
    const plan = m.days[d].exercises[i].plan;
    plan[fromW] = Math.max(1, Math.min(12, Math.round(+n) || 1));
    plan.length = fromW + 1;
    for (let k = 0; k < fromW; k++) if (plan[k] === undefined) plan[k] = null; // no holes in the stored array
  }
  // Rep range from two fields: both empty → null (no range); one → that number; reversed → swapped. 1–100.
  function parseRange(lo, hi) {
    const f = v => { const n = Math.round(+String(v ?? '').trim()); return String(v ?? '').trim() !== '' && n >= 1 ? Math.min(100, n) : null; };
    const a = f(lo), b = f(hi);
    if (a == null && b == null) return null;
    const x = a ?? b, y = b ?? a;
    return [Math.min(x, y), Math.max(x, y)];
  }
  // After a plan change: every unfinished, unskipped session's slots that have nothing in them (slotEmpty) follow
  // the plan again (exercise and planned sets). Content is never touched. → [{k, i, snap}] for restoreRebuilt
  function rebuildOpen(m) {
    const out = [];
    for (const [k, s] of Object.entries(m.log)) {
      if (s.done || s.skipped) continue;
      const [w, d] = k.split('-').map(Number);
      (m.days[d]?.exercises || []).forEach((slot, i) => {
        const sl = s.slots[i];
        if (!sl || !slotEmpty(sl)) return;
        const n = plannedSets(m, d, i, w);
        if (sl.exId === slot.exId && sl.sets.length === n) return;
        out.push({ k, i, snap: snapSlot(sl) });
        sl.exId = slot.exId;
        sl.sets = blankSets(n);
        delete sl.bump;
      });
    }
    return out;
  }
  function restoreRebuilt(m, list) {
    list.forEach(({ k, i, snap }) => { const sl = m.log[k]?.slots[i]; if (sl && slotEmpty(sl)) restoreSlot(sl, snap); });
  }
  // +1 week. With a deload, the deload moves to the new last week, so it's refused once the deload week has a
  // session (it would turn logged deload work into a hard week).
  const canAddWeek = m => !(m.deload && Object.keys(m.log).some(k => +k.split('-')[0] === m.weeks));
  function addWeek(m) {
    if (!canAddWeek(m)) return { error: 'deload' };
    const snap = { weeks: m.weeks, complete: m.complete, pos: { ...m.pos } };
    m.weeks += 1; // plannedSets repeats the last per-week entry, so the plan arrays need nothing
    advance(m);   // a completed block gets its new week as next up
    return { snap };
  }
  function restoreWeek(m, snap) {
    m.weeks = snap.weeks;
    m.complete = snap.complete;
    m.pos = { ...snap.pos };
  }

  /* ---------- live plan editing, part 2 (2.9b): append, retire, reinstate ---------- */
  // Append an exercise to day d (builder defaults). Every session of that day that isn't finished gets a matching
  // slot, skipped ones included (empty), so slot i lines up everywhere; finished sessions keep fewer slots.
  // → {i, keys} for removeAppended
  function appendSlot(m, d, exId) {
    m.days[d].exercises.push({ exId, plan: [2], reps: null, type: 'accessory', notes: '', timed: false });
    const i = m.days[d].exercises.length - 1, keys = [];
    for (const [k, s] of Object.entries(m.log)) {
      const [w, dd] = k.split('-').map(Number);
      if (dd !== d || s.done) continue;
      while (s.slots.length < i) s.slots.push({ exId: m.days[d].exercises[s.slots.length].exId, sets: [], fb: {} }); // never sparse
      s.slots.push({ exId, sets: s.skipped ? [] : blankSets(plannedSets(m, d, i, w)), fb: {} });
      keys.push(k);
    }
    return { i, keys };
  }
  // Undo of appendSlot, while nothing was logged in the new slot anywhere. Checked over every session of day d
  // that has slot i (not just those that existed at the append: a shown-only workout may have been stored since).
  const sessionsOfDay = (m, d) => Object.entries(m.log).filter(([k]) => +k.split('-')[1] === d).map(([, s]) => s);
  const canRemoveAppended = (m, d, r) => m.days[d].exercises.length === r.i + 1
    && sessionsOfDay(m, d).every(s => s.slots.length <= r.i || (s.slots.length === r.i + 1 && slotEmpty(s.slots[r.i])));
  function removeAppended(m, d, r) {
    if (!canRemoveAppended(m, d, r)) return false;
    m.days[d].exercises.pop();
    sessionsOfDay(m, d).forEach(s => { if (s.slots.length === r.i + 1) s.slots.pop(); });
    return true;
  }
  // Retire slot i (off:true): plannedSets 0, no progression, dropped by Copy, hidden when empty. Open sessions'
  // empty slots get no sets; slots with anything in them stay. → {snap} for restore | {error}
  function retireSlot(m, d, i) {
    const slot = m.days[d]?.exercises[i];
    if (!slot) return { error: 'missing' };
    if (slot.off) return { error: 'same' };
    const plan = snapSlot(slot);
    slot.off = true;
    return { snap: { plan, slots: rebuildOpen(m) } };
  }
  // Back in the plan: open sessions' empty slots get their planned sets again. → {snap} | {error}
  function reinstateSlot(m, d, i) {
    const slot = m.days[d]?.exercises[i];
    if (!slot?.off) return { error: 'same' };
    const plan = snapSlot(slot);
    delete slot.off;
    return { snap: { plan, slots: rebuildOpen(m) } };
  }
  // Undo for either: the plan slot and the session slots they rebuilt.
  function restorePlanSlot(m, d, i, snap) {
    restoreSlot(m.days[d].exercises[i], snap.plan);
    restoreRebuilt(m, snap.slots);
  }

  /* ---------- rest timer (2.8) ---------- */
  const REST_KEY = 'liftbook-rest';            // the running timer, outside the data (S); every access in try/catch
  const REST_OVER_MAX = 600;                    // overtime shown up to 10 min, then the timer is gone
  // Per-exercise rest lengths: 15 s steps, 15 s to 10 min.
  const clampRest = secs => Math.min(600, Math.max(15, Math.round(+secs / 15) * 15 || 15));
  // The rest after a set of slot i (day d): the plan slot's own length, else the Settings default for its type.
  const restFor = (m, d, i, settings) => {
    const slot = m.days[d]?.exercises[i];
    return +slot?.rest > 0 ? +slot.rest : slot?.type === 'main' ? settings.restMain : settings.restAcc;
  };
  // rest {end} at time now → {state: 'running', secs left} | {state: 'over', secs past zero} | {state: 'expired'}
  function restState(rest, now) {
    if (!rest || !(+rest.end > 0)) return { state: 'expired', secs: 0 };
    const ms = rest.end - now;
    if (ms > 0) return { state: 'running', secs: Math.ceil(ms / 1000) };
    const over = Math.floor((now - rest.end) / 1000);
    return over < REST_OVER_MAX ? { state: 'over', secs: over } : { state: 'expired', secs: over };
  }
  // ±15 on the bar: moves the end of a running rest (never into the past); +15 in overtime starts 15 s from now.
  const adjustRest = (end, delta, now) => Math.max(now, Math.max(end, now) === end ? end + delta * 1000 : now + delta * 1000);

  /* ---------- skip / discard a workout (2.5) ---------- */
  // Sets a Discard would delete: done or with numbers typed.
  const loggedSets = s => s.slots.reduce((n, sl) => n + sl.sets.filter(x => x.done || typedSet(x)).length, 0);
  // Skip: "I won't do this one." Only before any set is done. A missing session is created full (blankSession);
  // anything typed or skipped in it is kept. The schedule moves on (sequence model). → {snap} | {error}
  function skipWorkout(m, w, d, now) {
    const k = `${w}-${d}`, s0 = m.log[k];
    if (s0?.done || s0?.skipped) return { error: 'state' };
    if (s0 && s0.slots.some(sl => sl.sets.some(x => x.done))) return { error: 'done' };
    const snap = { s: s0 ? snapSlot(s0) : null, pos: { ...m.pos }, complete: m.complete };
    const s = s0 ?? (m.log[k] = blankSession(m, w, d));
    s.skipped = true;
    s.skippedAt = now;
    advance(m);
    return { snap };
  }
  // Undo of a skip: the session as it was (or gone, if the skip created it) and the old position.
  function restoreSkip(m, w, d, snap) {
    const k = `${w}-${d}`;
    if (snap.s) { if (m.log[k]) restoreSlot(m.log[k], snap.s); else m.log[k] = snapSlot(snap.s); } else delete m.log[k];
    m.pos = { ...snap.pos };
    m.complete = snap.complete;
  }
  // "Do it anyway": back into the sequence; an earlier one becomes next up again. → {moved: pos changed}
  function unskipWorkout(m, w, d) {
    const s = m.log[`${w}-${d}`];
    if (!s?.skipped) return { moved: false };
    delete s.skipped;
    delete s.skippedAt;
    rebuildOpen(m); // plan changes made while it was skipped (rebuildOpen passes over skipped sessions)
    const before = `${m.pos.w}-${m.pos.d}-${m.complete}`;
    advance(m);
    return { moved: before !== `${m.pos.w}-${m.pos.d}-${m.complete}` };
  }
  // Discard: "I'll redo this." Deletes an unfinished session; no advance (it stays where it is in the sequence).
  // → {s} (put back with m.log[key] = s) | {error}
  function discardWorkout(m, w, d) {
    const k = `${w}-${d}`, s = m.log[k];
    if (!s) return { error: 'missing' };
    if (s.done || s.skipped) return { error: 'state' };
    delete m.log[k];
    return { s };
  }

  // Note for today (3.4): sl.note, trimmed, up to 200 characters; empty removes it. → the previous note ('' if none)
  function setNote(sl, text) {
    const prev = sl.note ?? '';
    const t = String(text ?? '').trim().slice(0, 200);
    if (t) sl.note = t; else delete sl.note;
    return prev;
  }

  /* ---------- skip (2.4) ---------- */
  // A skipped set keeps its numbers and done:false, so nothing that counts done sets sees it (stats, lastPerf,
  // prefill, charts); it still counts in the planned number of sets.
  const skipSet = st => { if (st.done) return false; st.skip = true; return true; };
  const unskipSet = st => { delete st.skip; };
  // Skip the exercise (or the rest of it: done sets stay counted). sl.skipMarked remembers which sets this
  // marked, so unskipping keeps sets that were skipped on their own. → false if already skipped.
  function skipSlot(sl) {
    if (sl.skip) return false;
    sl.skipMarked = [];
    sl.sets.forEach((x, j) => { if (!x.done && !x.skip && !x.wu) { x.skip = true; sl.skipMarked.push(j); } });
    sl.skip = true;
    return true;
  }
  function unskipSlot(sl) {
    if (!sl.skip) return false;
    (sl.skipMarked || []).forEach(j => { if (sl.sets[j] && !sl.sets[j].done) delete sl.sets[j].skip; });
    delete sl.skip;
    delete sl.skipMarked;
    return true;
  }
  // The slot keeps set indexes (the +step chip's sl.bump, skip-exercise's sl.skipMarked). When a set is inserted at
  // `from` (delta +1) they move down; when the set at `from` is removed (delta −1) its own index goes and later
  // ones move up. → which lists held `from` before a removal (to put it back on undo)
  function shiftIdx(sl, from, delta) {
    const held = {};
    ['bump', 'skipMarked'].forEach(key => {
      const a = sl[key];
      if (!Array.isArray(a)) return;
      if (delta < 0) held[key] = a.includes(from);
      sl[key] = a.filter(k => !(delta < 0 && k === from)).map(k => (k > from || (delta > 0 && k === from) ? k + delta : k));
    });
    return held;
  }

  // + Add warm-up set: a blank warm-up after any existing ones, at the top of the slot. → j of the new set
  function addWarmup(sl) {
    const j = sl.sets.filter(x => x.wu).length;
    sl.sets.splice(j, 0, { w: '', r: '', done: false, wu: true });
    shiftIdx(sl, j, 1);
    return j;
  }
  // Undo of addWarmup while that row is still blank and undone.
  function removeWarmup(sl, j) {
    const x = sl.sets[j];
    if (!x?.wu || x.done || typedSet(x)) return false;
    sl.sets.splice(j, 1);
    shiftIdx(sl, j, -1);
    return true;
  }

  // Delete set j: never a done set or the only working set. → {set, held} for undeleteSet | {error}
  function deleteSet(sl, j) {
    const x = sl.sets[j];
    if (!x) return { error: 'missing' };
    if (x.done) return { error: 'done' };
    if (!x.wu && workSets(sl).length < 2) return { error: 'last' }; // a warm-up can always go
    const set = sl.sets.splice(j, 1)[0];
    return { set, held: shiftIdx(sl, j, -1) };
  }
  // Undo of deleteSet: the set back at j, and back in the index lists it was in.
  function undeleteSet(sl, j, r) {
    sl.sets.splice(j, 0, r.set);
    shiftIdx(sl, j, 1);
    Object.entries(r.held || {}).forEach(([key, had]) => { if (had && Array.isArray(sl[key])) sl[key] = [...sl[key], j].sort((a, b) => a - b); });
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

  // Progress chart for one exercise. → {metric: 'e1rm'|'e1rmBw'|'load'|'reps'|'hold', points: [{x: date, y}]}
  // e1rm: only sets with a known load (w > 0) and 1–12 reps; sessions without one are left out, not plotted as 0.
  // e1rmBw (3.1, bodyweight exercise while Settings has a bodyweight): e1RM of bodyweight + added load, using the
  // bodyweight saved with each workout (s.bw) or, for older ones, the current setting (then fallback: true).
  // Which metric an exercise is charted (and its records judged) on. Cheaper than chartPoints: no points.
  function chartMetric(S, ex, perf = perfFor(S, ex.id)) {
    if (ex.timed) return 'hold';
    if (ex.bw && currentBody(S)) return 'e1rmBw'; // while any bodyweight is known (Body log or the Settings value)
    if (!perf.some(p => p.sets.some(x => +x.w > 0))) return 'reps';
    return ex.bw ? 'load' : 'e1rm';
  }
  // A workout's bodyweight, the one lookup for charts, records and Finish. → number | null
  // Order: a Body entry on exactly that day (logged after the fact, it's the most accurate), then s.bw, then the
  // latest entry before that day, then the current value.
  const bwFor = (S, s) => {
    const t = s?.date ?? Date.now(), exact = (S.body || []).find(e => e.d === dayOf(t));
    return exact ? +exact.w : +s?.bw > 0 ? +s.bw : bodyFor(S, t);
  };

  function chartPoints(S, ex) {
    const perf = perfFor(S, ex.id);
    const metric = chartMetric(S, ex, perf);
    // Each point is the workout's best set on that metric (setValue), the same values the 🏆 compares.
    const points = perf.map(p => {
      const vals = p.sets.map(x => setValue(metric, x, bwFor(S, p))).filter(v => v != null);
      return vals.length ? { x: p.date, y: Math.max(...vals) } : null;
    }).filter(Boolean);
    if (metric !== 'e1rmBw') return { metric, points };
    const fallback = perf.some(p => !(+p.bw > 0) && bodyAt(S, p.date) == null);
    return { metric, points, bw: currentBody(S), fallback };
  }

  /* ---------- personal best (3.2) ---------- */
  // One set's value on the exercise's chart metric (see chartPoints), or null when the set says nothing about it.
  function setValue(metric, x, bw) {
    const w = +x.w || 0, r = +x.r;
    if (!(r > 0)) return null;
    if (metric === 'hold' || metric === 'reps') return r;
    if (metric === 'load') return Math.max(0, w);
    if (r > 12) return null;
    if (metric === 'e1rmBw') return bw ? e1rm(bw + Math.max(0, w), r) : null;
    return w > 0 ? e1rm(w, r) : null;
  }
  // The best value on that metric in finished workouts before session s (not s itself). null = no earlier value,
  // e.g. the first time: then there's no badge.
  function bestBefore(S, exId, metric, s) {
    const before = s?.done ? s.date : Infinity;
    let best = null;
    for (const { s: ss } of allSessions(S)) {
      if (ss === s || !(ss.date < before)) continue;
      const bw = bwFor(S, ss);
      ss.slots.forEach(sl => {
        if (sl.exId !== exId) return;
        doneSets(sl).forEach(x => { const v = setValue(metric, x, bw); if (v != null && (best == null || v > best)) best = v; });
      });
    }
    return best;
  }
  // Today's record set for exercise ex in session s: the best working set of the day (all its slots) when it beats
  // every earlier workout. → {i, j, value, metric} | null
  function prSet(S, ex, s) {
    const metric = chartMetric(S, ex);
    const best = bestBefore(S, ex.id, metric, s);
    if (best == null) return null;
    const bw = bwFor(S, s);
    let top = null;
    s.slots.forEach((sl, i) => {
      if (sl.exId !== ex.id) return;
      sl.sets.forEach((x, j) => {
        if (!x.done || x.wu) return;
        const v = setValue(metric, x, bw);
        if (v != null && v > best && (!top || v > top.value)) top = { i, j, value: v, metric };
      });
    });
    return top;
  }

  // Sets that count for history, suggestions and stats. (Warm-ups will be excluded here: 3.3.)
  const countedSets = sl => sl.sets.filter(x => x.done && !x.wu && +x.r > 0);

  // The last time this EXERCISE was done, in any block (replaces the slot-index prevSlot, F05).
  // Finished sessions only, newest first, deload weeks skipped. occurrence: the k-th slot with this exercise
  // in a session (when today's session has it twice). before: only sessions finished before this time
  // (for viewing an old workout). → {date, sets, note, m, w, d} | null
  function lastPerf(S, exId, { exclude = null, occurrence = 0, before = Infinity } = {}) {
    for (const { m, w, d, s } of allSessions(S)) {
      if (s === exclude || !(s.date < before) || isDeload(m, w)) continue;
      // For a later occurrence, past slots where exId was only a substitute don't count (they'd shift the index).
      const hits = s.slots.filter((sl, k) => sl.exId === exId && countedSets(sl).length && (!occurrence || !swappedFrom(m, d, s, k)));
      if (!hits.length) continue;
      const sl = hits[Math.min(occurrence, hits.length - 1)];
      return { date: s.date, sets: countedSets(sl), wu: sl.sets.filter(x => x.wu && x.done && +x.r > 0), note: sl.note ?? '', m, w, d };
    }
    return null;
  }

  // The newest note on this exercise in a finished workout (also when it wasn't done that day: "skipped, shoulder
  // hurt"), or null. → {note, date}
  function lastNoteFor(S, exId, { exclude = null, before = Infinity } = {}) {
    for (const { s } of allSessions(S)) {
      if (s === exclude || !(s.date < before)) continue;
      const sl = s.slots.find(x => x.exId === exId && x.note);
      if (sl) return { note: sl.note, date: s.date };
    }
    return null;
  }

  // ↑ hint (double progression, unchanged rule): every set last time at the top of the CURRENT slot's range.
  function slotHints(last, reps, deload) {
    const hitTop = !!(!deload && reps && last && last.sets.every(x => +x.r >= reps[1]));
    const weighted = !!last && last.sets.some(x => +x.w > 0);
    return { hitTop, weighted };
  }

  // Suggested values for set j (shown as placeholders, logged by a one-tap ✓). opts: {deload, step}
  // Weight: today's nearest earlier counted set → last time's set j → last time's final set → ''.
  //   Last time's REAL weight (more weight is an explicit tap: applyBump); a deload week halves it, rounded to the
  //   exercise's step. A 0/blank suggestion counts as none, except that a bodyweight exercise done at BW today stays BW.
  // Reps: last time's set j as the target. If this set's weight differs from what last time suggests, today's
  //   previous set's reps instead. No last time → today's previous → ''.
  function prefill(sl, j, last, ex, { deload = false, step = 2.5 } = {}) {
    const usable = v => v != null && String(v).trim() !== '' && +v !== 0;
    // A warm-up: last time's warm-up in the same position, as it was, or nothing (never from working sets).
    if (sl.sets[j]?.wu) {
      const lw = last?.wu?.[workIndex(sl, j)];
      return lw ? { w: usable(lw.w) ? String(+lw.w) : '', r: String(lw.r) } : { w: '', r: '' };
    }
    const wj = workIndex(sl, j); // working sets line up with last time's working sets
    const prev = sl.sets.slice(0, j).reverse().find(x => x.done && !x.wu && +x.r > 0) || null;
    const ls = last ? last.sets[wj] || last.sets[last.sets.length - 1] : null;
    let fromLast = '';
    if (ls) {
      const base = +ls.w || 0;
      const v = deload ? roundTo(base / 2, step) : base;
      fromLast = v ? String(v) : '';
    }
    let w;
    if (prev && usable(prev.w)) w = String(+prev.w);
    else if (prev && ex?.bw) w = '';
    else w = fromLast;
    let r = '';
    if (ls) {
      r = String(ls.r);
      const typed = String(sl.sets[j]?.w ?? '').trim();
      const wNow = typed !== '' ? typed : w;
      if (prev && (+wNow || 0) !== (+fromLast || 0)) r = String(prev.r);
    } else if (prev) r = String(prev.r);
    return { w, r };
  }

  // The ↑ chip: last time's weight + step for set j, and the bottom of the rep range.
  const bumpValues = (last, j, step, reps) => {
    const ls = last.sets[j] || last.sets[last.sets.length - 1];
    return { w: String(Math.round((+ls.w + step) * 1000) / 1000), r: String(reps[0]) };
  };
  const untouched = x => !x.done && !x.skip && !x.wu && String(x.w).trim() === '' && String(x.r).trim() === '';
  // The chip's state lives on the session slot: sl.bump = [indexes the chip filled] while it is on (optional field,
  // ignored by old code). It is never inferred from values, so hand-typed numbers can't switch it on.
  const bumpOn = sl => Array.isArray(sl.bump);
  // Tap 1 writes last+step and reps[0] into every unticked set with nothing typed (real values: ✓ logs them and the
  // reps rule can't flip them) and remembers which. Tap 2 clears only those of them that are still unticked and
  // unchanged, then turns the chip off. Ticked, hand-typed and edited sets are never touched. → number changed.
  function toggleBump(sl, last, step, reps) {
    let n = 0;
    if (bumpOn(sl)) {
      sl.bump.forEach(j => {
        const x = sl.sets[j], b = x && bumpValues(last, workIndex(sl, j), step, reps);
        if (x && !x.done && x.w === b.w && x.r === b.r) { x.w = ''; x.r = ''; n++; }
      });
      delete sl.bump;
      return n;
    }
    sl.bump = [];
    sl.sets.forEach((x, j) => {
      if (!untouched(x)) return;
      const b = bumpValues(last, workIndex(sl, j), step, reps);
      x.w = b.w;
      x.r = b.r;
      sl.bump.push(j);
      n++;
    });
    return n;
  }

  // Where an exercise is used: plans (block names), and every logged session slot with it (any set, any state).
  // → {inPlans: [block names], loggedSets: sets done/typed/skipped, sessions: sessions with a slot for it}
  function exerciseUse(S, exId) {
    const inPlans = S.mesos.filter(m => m.days.some(d => d.exercises.some(sl => sl.exId === exId))).map(m => m.name);
    let loggedSets = 0, sessions = 0;
    S.mesos.forEach(m => Object.values(m.log).forEach(ss => {
      const slots = ss.slots.filter(sl => sl.exId === exId);
      if (!slots.length) return;
      sessions++;
      slots.forEach(sl => { loggedSets += sl.sets.filter(x => x.done || x.skip || typedSet(x)).length; });
    }));
    return { inPlans, loggedSets, sessions };
  }
  // The unsaved plan draft (the builder stays open across tabs) refers to it?
  const draftUses = (draft, exId) => !!draft && draft.days.some(d => d.exercises.some(sl => sl.exId === exId));
  // Deletable only when nothing refers to it (deleting would orphan history: C9).
  const canDeleteExercise = u => !u.inPlans.length && !u.sessions;

  // Rename keeps the id, so history follows. Trimmed; empty or a case-insensitive duplicate is refused.
  function renameExercise(S, exId, name) {
    const ex = S.exercises.find(e => e.id === exId);
    const n = String(name ?? '').trim();
    if (!ex) return { error: 'missing' };
    if (!n) return { error: 'empty' };
    if (S.exercises.some(e => e.id !== exId && e.name.toLowerCase() === n.toLowerCase())) return { error: 'duplicate' };
    ex.name = n;
    return { ok: true };
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

  /* ---------- swap (2.2) ---------- */

  // Groups for the swap sheet of a slot doing exId. query filters every group by name (substring, any case).
  // → {muscle, recent: [{ex, date}] same muscle by last date done, all: rest of that muscle A–Z,
  //    other: [{muscle, items}] other muscles A–Z, add: the typed name when no exercise has exactly that name}
  function swapCandidates(S, exId, query = '') {
    const muscle = S.exercises.find(e => e.id === exId)?.muscle;
    const q = String(query).trim(), ql = q.toLowerCase();
    const last = {};
    allSessions(S).forEach(({ s }) => s.slots.forEach(sl => {
      if (!(sl.exId in last) && countedSets(sl).length) last[sl.exId] = s.date;
    }));
    const byName = (a, b) => a.name.localeCompare(b.name);
    const pool = S.exercises.filter(e => e.id !== exId && e.name.toLowerCase().includes(ql));
    const same = pool.filter(e => e.muscle === muscle);
    const recent = same.filter(e => e.id in last).sort((a, b) => last[b.id] - last[a.id]).map(ex => ({ ex, date: last[ex.id] }));
    const all = same.filter(e => !(e.id in last)).sort(byName);
    const other = [...new Set(pool.filter(e => e.muscle !== muscle).map(e => e.muscle))].sort()
      .map(mu => ({ muscle: mu, items: pool.filter(e => e.muscle === mu).sort(byName) }));
    const add = q && !S.exercises.some(e => e.name.toLowerCase() === ql) ? q : null;
    return { muscle, recent, all, other, add };
  }

  // The planned exercise when slot i of a session does something else today, else null. Read from sl.from,
  // written by swapToday at the time of the swap, NOT by comparing with the current plan: after a rest-of-block
  // swap the plan changes, and older sessions must not start looking swapped. (m, d: kept for the callers.)
  const swappedFrom = (m, d, s, i) => {
    const sl = s.slots[i];
    return sl?.from && sl.from !== sl.exId ? sl.from : null;
  };

  // lastPerf's occurrence for slot i: earlier UNSWAPPED slots doing the same planned exercise.
  // A swapped slot always uses 0 (the substitute's most recent slot).
  const occurrenceOf = (m, d, s, i) => !s.slots[i] || swappedFrom(m, d, s, i) ? 0
    : s.slots.slice(0, i).filter((x, k) => x.exId === s.slots[i].exId && !swappedFrom(m, d, s, k)).length;

  const snapSlot = sl => JSON.parse(JSON.stringify(sl));
  function restoreSlot(sl, snap) {
    Object.keys(sl).forEach(k => delete sl[k]);
    Object.assign(sl, snapSlot(snap));
  }

  // Today only: slot i does newExId instead. Refused once a set is done (history must keep what was lifted).
  // Undone sets are emptied so the suggestions come from the new exercise; feedback, skip and the +step chip reset.
  // → {snap} for Undo | {error: 'done'|'same'|'missing'}
  function swapToday(s, i, newExId) {
    const sl = s.slots[i];
    if (!sl) return { error: 'missing' };
    if (sl.exId === newExId) return { error: 'same' };
    if (sl.sets.some(x => x.done)) return { error: 'done' };
    const snap = snapSlot(sl);
    const planned = sl.from ?? sl.exId; // what the plan had when this slot was first swapped (or now)
    if (newExId === planned) delete sl.from; else sl.from = planned;
    sl.exId = newExId;
    sl.sets = sl.sets.map(x => (x.wu ? { w: '', r: '', done: false, wu: true } : { w: '', r: '', done: false }));
    sl.fb = {};
    delete sl.skip;
    delete sl.skipMarked;
    delete sl.bump;
    return { snap };
  }
  // Rest of block (2.3): the plan slot itself does newExId from now on. Today's session (todayKey, stored) goes
  // through swapToday; every other session of day d that isn't done or skipped and has no done set in slot i
  // follows unless its slot has content (typed or skipped). Done sessions are never touched (history keeps what was lifted). clearNote empties the plan note.
  // → {snap} for restoreBlock | {error: 'done'|'same'|'missing'}
  function swapBlock(m, d, i, newExId, todayKey, { clearNote = false } = {}) {
    const slot = m.days[d]?.exercises[i];
    const today = m.log[todayKey];
    if (!slot || !today?.slots[i]) return { error: 'missing' };
    if (today.slots[i].sets.some(x => x.done)) return { error: 'done' };
    if (slot.exId === newExId && today.slots[i].exId === newExId) return { error: 'same' };
    const snap = { plan: snapSlot(slot), slots: {} };
    for (const [k, s] of Object.entries(m.log)) {
      const sl = s.slots[i];
      if (+k.split('-')[1] !== d || s.done || s.skipped || !sl || sl.sets.some(x => x.done)) continue;
      // Other sessions keep a slot with anything in it (typed numbers, skips); only today's is cleared.
      if (k !== todayKey && slotHasContent(sl)) continue;
      if (sl.exId === newExId && !sl.from) continue; // already doing it, as planned
      const before = snapSlot(sl);
      swapToday(s, i, newExId); // 'same' when it already does newExId (a today-only swap): only `from` goes
      delete sl.from;           // the plan now does newExId, so this slot is no longer a swap
      snap.slots[k] = before;
    }
    slot.exId = newExId;
    if (clearNote) slot.notes = '';
    return { snap };
  }
  function restoreBlock(m, d, i, snap) {
    restoreSlot(m.days[d].exercises[i], snap.plan);
    for (const [k, sl] of Object.entries(snap.slots)) {
      const cur = m.log[k]?.slots[i];
      if (cur && !cur.sets.some(x => x.done)) restoreSlot(cur, sl); // never undo over sets logged since
    }
  }

  // Back to the planned exercise (sl.from): the same rules as a swap.
  const unswap = (m, d, s, i) => { const from = swappedFrom(m, d, s, i); return from ? swapToday(s, i, from) : { error: 'same' }; };

  function perfFor(S, exId) {
    const out = [];
    allSessions(S).forEach(({ s }) => s.slots.forEach(sl => {
      if (sl.exId !== exId) return;
      const sets = doneSets(sl).filter(x => +x.r > 0);
      if (sets.length) out.push({ date: s.date, sets, ...(+s.bw > 0 ? { bw: +s.bw } : {}) });
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

  // A waiting app update may reload the page only when nothing in progress would be lost.
  const canAutoUpdate = ({ rest, focused, sheet, edit, draft, toast }) => !rest && !focused && !sheet && !edit && !draft && !toast;

  const api = { DEFAULT_EX, uid, freshState, normalize, validate, loadFrom, loadState, summarize, importInto,
    KEY, BACKUP_KEY, RECOVERY_PREFIX, BEFORE_IMPORT_KEY,
    FEEDBACK, setDelta, doneSets, workSets, workIndex, setLabel, shiftIdx, addWarmup, removeWarmup, undeleteSet, e1rm, blankSets, roundLoad, repsTxt, parseReps,
    totalWeeks, isDeload, isFixed, dayOrder, targetRIR, plannedSets, blankSession, session, hasLogs, canSaveEdit, canWrite, canUndoFinish, advance,
    hasContent, exerciseUse, draftUses, canDeleteExercise, renameExercise, finishSession, finishReview, applyTyped, finishSnapshot, restoreFinish, allSessions, swapCandidates, swappedFrom, occurrenceOf, snapSlot, restoreSlot, swapToday, swapBlock, restoreBlock, unswap, perfFor, setValue, bestBefore, prSet, chartMetric, bwFor, countedSets, lastPerf, lastNoteFor, slotHasContent, slotHints, prefill, roundTo, STEPS, stepChoices, setStep, stepOf, bumpOn, toggleBump, snapSet, restoreSet, tidySlots, BW_NAMES, acceptSet, fmtSets, chartPoints, tickSet, untickSet, canRemoveLastSet, canAutoUpdate, setNote, skipSet, unskipSet, skipSlot, unskipSlot, deleteSet, loggedSets, skipWorkout, restoreSkip, unskipWorkout, discardWorkout, slotOpen, currentSlot, nextSet, allLogged, lastTick, staleSession, isStale, DRAFT_KEY, parseDraft, backupDue, backupText, addBody, saveBody, undoBodySave, removeBody, bodyAt, bodyFor, currentBody, bodyStats, bodyAvgLine, dayOf, planFromWeek, setPlanSets, parseRange, rebuildOpen, restoreRebuilt, canAddWeek, addWeek, restoreWeek, appendSlot, canRemoveAppended, removeAppended, retireSlot, reinstateSlot, restorePlanSlot, REST_KEY, clampRest, restFor, restState, adjustRest };
  if (typeof module === 'object' && module.exports) module.exports = api; else Object.assign(root, api);
})(this);
