// Your training plan (source of truth). The app offers it as the first template in the Plan builder.
// weekday: 0 = Sunday … 6 = Saturday. type "main" uses the long rest timer, "accessory" the short one.

/**
 * @typedef {Object} PlanExercise
 * @property {string} name
 * @property {string} muscle      One of MUSCLES in app.js
 * @property {number} sets
 * @property {[number, number]} reps  Target range (seconds when timed)
 * @property {'main'|'accessory'} type
 * @property {string} [notes]
 * @property {boolean} [timed]    Log seconds instead of reps
 * @property {boolean} [bw]       Bodyweight exercise: log the added load (blank = bodyweight only)
 * @property {number}  [step]     Weight step for the ↑ chip and deload rounding (e.g. 2 for dumbbells); default 2.5 kg / 5 lb
 * @property {string[]} [was]     Earlier names of the SAME movement (true renames only; a replacement exercise gets no
 *                                `was` and starts its own history). When the plan is applied and no exercise is called
 *                                `name` yet, the first name in `was` (in this order) that matches an exercise renames
 *                                that exercise in place: same id, so its history stays. Case-insensitive. An old name
 *                                must not appear in any other exercise's `name` or `was`.
 *
 * @typedef {Object} PlanDay
 * @property {string} name
 * @property {number} weekday
 * @property {string} [notes]
 * @property {PlanExercise[]} exercises
 */

/** @type {{ name: string, days: PlanDay[] }} */
const MY_PLAN = {
  name: 'Arm wrestling + SBD · 3 gym + 2 skills',
  days: [
    {
      name: 'Sat: Squat + Bench + Pull', weekday: 6,
      exercises: [
        { name: 'Squat', was: ['Squat (barbell or goblet)'], muscle: 'Quads', sets: 3, reps: [4, 6], type: 'main', notes: 'Week 1: work up to a set of 5 at RPE 8 — that is your working weight' },
        { name: 'Barbell Bench Press', muscle: 'Chest', sets: 4, reps: [4, 6], type: 'main', notes: 'Start around 80 kg × 5' },
        { name: 'Weighted Pull-up', bw: true, muscle: 'Back', sets: 4, reps: [3, 5], type: 'main', notes: 'Around +15 kg; raise the load once you hit 5 on all sets' },
        { name: 'Cable Cupping (table position)', muscle: 'Forearms', sets: 4, reps: [6, 8], type: 'accessory', notes: 'Low pulley, elbow on a bench pad at 90°, towel/strap through the handle; curl wrist + fingers toward you. Heavy.' },
        { name: 'Cable Pronation (table position)', muscle: 'Forearms', sets: 3, reps: [6, 10], type: 'accessory', notes: 'Elbow on pad, rotate the forearm against the cable (thumb toward you)' },
        { name: 'Rising (radial deviation)', was: ['Radial Deviation (DB wrist side raise)'], muscle: 'Forearms', sets: 3, reps: [8, 12], type: 'accessory', notes: 'Dumbbell handle loaded on one end; lift the thumb side' },
        { name: 'Hanging Leg Raise', bw: true, muscle: 'Abs', sets: 3, reps: [8, 12], type: 'accessory' },
      ],
    },
    {
      name: 'Sun: Volume + tendons', weekday: 0, notes: 'Lighter day after Saturday — stop 2–3 reps shy of failure.',
      exercises: [
        { name: 'Incline Barbell Bench', muscle: 'Chest', sets: 3, reps: [8, 10], type: 'main' },
        { name: 'Chin-up', was: ['Chin-up (bodyweight)'], bw: true, muscle: 'Back', sets: 3, reps: [6, 8], type: 'main', notes: 'Add weight once 3×8 is easy' },
        { name: 'Bulgarian Split Squat', muscle: 'Quads', sets: 3, reps: [8, 8], type: 'accessory', notes: 'Reps per leg' },
        { name: 'Reverse Curl', muscle: 'Forearms', sets: 3, reps: [8, 10], type: 'accessory' },
        { name: 'Static Hold (table position, cable)', muscle: 'Forearms', sets: 3, reps: [20, 30], type: 'accessory', timed: true, notes: 'Moderate load, hold the arm-wrestling position; log seconds' },
        { name: 'Finger Extension (band)', bw: true, muscle: 'Forearms', sets: 2, reps: [15, 20], type: 'accessory' },
        { name: 'Ab Wheel', bw: true, muscle: 'Abs', sets: 3, reps: [8, 12], type: 'accessory' },
      ],
    },
    {
      name: 'Tue: Skills (park)', weekday: 2, notes: 'Practice, not fatigue — stop every set well before failure. Rained out? Do 3 tuck front lever holds at the end of Saturday instead.',
      exercises: [
        { name: 'Tuck Front Lever', bw: true, timed: true, muscle: 'Back', sets: 5, reps: [8, 12], type: 'main', notes: 'Advanced tuck once 5×12 s is solid' },
        { name: 'L-sit (bars)', bw: true, timed: true, muscle: 'Abs', sets: 3, reps: [10, 20], type: 'accessory' },
        { name: 'Handstand practice', bw: true, timed: true, muscle: 'Shoulders', sets: 5, reps: [20, 40], type: 'accessory', notes: 'Freestanding attempts on grass; log your best hold per set' },
      ],
    },
    {
      name: 'Wed: Deadlift + Dips + Side pressure', weekday: 3,
      exercises: [
        // 'Deadlift' is a built-in exercise filed under Back; it's reused as is.
        { name: 'Deadlift', muscle: 'Back', sets: 3, reps: [3, 5], type: 'main', notes: 'Start at 125 kg × 5' },
        { name: 'Weighted Dips', bw: true, muscle: 'Chest', sets: 3, reps: [5, 8], type: 'main' },
        { name: 'Chest-Supported Row', muscle: 'Back', sets: 3, reps: [6, 8], type: 'accessory' },
        { name: 'Cable Side Pressure (table position)', muscle: 'Forearms', sets: 4, reps: [6, 8], type: 'accessory', notes: 'Cable from the side at table height, elbow on pad; pull the hand toward your chest (hook). Heavy.' },
        { name: 'Cable Back Pressure (table position)', muscle: 'Forearms', sets: 3, reps: [6, 8], type: 'accessory', notes: 'Cable in front, elbow on pad; pull down and back' },
        { name: 'Heavy Barbell Curl', was: ['Heavy Supinated Curl (barbell or DB)'], muscle: 'Biceps', sets: 3, reps: [5, 8], type: 'accessory' },
        { name: 'Hammer Curl', muscle: 'Biceps', sets: 2, reps: [8, 10], type: 'accessory' },
        { name: 'Face Pull', muscle: 'Shoulders', sets: 2, reps: [15, 15], type: 'accessory' },
      ],
    },
    {
      name: 'Fri: Skills (home)', weekday: 5, notes: 'No pulling — heavy Saturday tomorrow.',
      exercises: [
        { name: 'Wall Handstand', bw: true, timed: true, muscle: 'Shoulders', sets: 5, reps: [20, 40], type: 'accessory' },
        { name: 'L-sit / tuck sit (chairs or floor)', bw: true, timed: true, muscle: 'Abs', sets: 4, reps: [10, 15], type: 'accessory' },
        { name: 'Compression Lift', bw: true, muscle: 'Abs', sets: 3, reps: [8, 8], type: 'accessory', notes: 'Seated, legs straight, lift both heels' },
      ],
    },
  ],
};
