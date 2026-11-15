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

  const uid = () => Math.random().toString(36).slice(2, 10);
  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);

  function freshState() {
    return {
      v: 1,
      settings: { unit: 'kg', restMain: 180, restAcc: 90 },
      exercises: DEFAULT_EX.map(([name, muscle]) => ({ id: uid(), name, muscle })),
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
    KEY, BACKUP_KEY, RECOVERY_PREFIX, BEFORE_IMPORT_KEY };
  if (typeof module === 'object' && module.exports) module.exports = api; else Object.assign(root, api);
})(this);
