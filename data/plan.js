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
 *
 * @typedef {Object} PlanDay
 * @property {string} name
 * @property {number} weekday
 * @property {string} [notes]
 * @property {PlanExercise[]} exercises
 */

/** @type {{ name: string, days: PlanDay[] }} */
const MY_PLAN = {
  name: 'My plan · 3 days',
  days: [
    {
      name: 'Day 1: Dips + Squat', weekday: 6,
      exercises: [
        { name: 'Weighted Dips', bw: true, muscle: 'Chest', sets: 4, reps: [6, 8], type: 'main', notes: 'Start with a hard set of ~8 reps to find the load; never max-tested yet' },
        { name: 'Squat (barbell or goblet)', muscle: 'Quads', sets: 4, reps: [6, 8], type: 'main' },
        { name: 'Incline Dumbbell Press', muscle: 'Chest', sets: 3, reps: [8, 10], type: 'accessory' },
        { name: 'Chest-Supported Row', muscle: 'Back', sets: 3, reps: [8, 10], type: 'accessory' },
        { name: 'Pec Deck', muscle: 'Chest', sets: 3, reps: [12, 15], type: 'accessory' },
        { name: 'Dumbbell Lateral Raise', muscle: 'Shoulders', sets: 3, reps: [12, 15], type: 'accessory' },
        { name: 'Rope Pushdown', muscle: 'Triceps', sets: 3, reps: [10, 12], type: 'accessory' },
        { name: 'Hammer Curl', muscle: 'Biceps', sets: 4, reps: [8, 10], type: 'accessory', notes: 'Heavier than before' },
        { name: 'Cable Internal Rotation', muscle: 'Shoulders', sets: 3, reps: [10, 12], type: 'accessory', notes: 'Arm at side, elbow bent 90°' },
        { name: 'Radial Deviation (DB wrist side raise)', muscle: 'Forearms', sets: 3, reps: [12, 15], type: 'accessory' },
        { name: 'Hanging Leg Raise', bw: true, muscle: 'Abs', sets: 3, reps: [8, 12], type: 'accessory' },
      ],
    },
    {
      name: 'Day 2: Pull-up + Hinge', weekday: 3,
      exercises: [
        { name: 'Weighted Pull-up', bw: true, muscle: 'Back', sets: 4, reps: [3, 5], type: 'main', notes: 'Around +15 kg; raise the load once you hit 5 on all sets' },
        { name: 'Romanian Deadlift', muscle: 'Hamstrings', sets: 3, reps: [8, 10], type: 'main' },
        { name: 'Overhead Press', muscle: 'Shoulders', sets: 3, reps: [6, 8], type: 'main' },
        { name: 'Bulgarian Split Squat', muscle: 'Quads', sets: 3, reps: [8, 10], type: 'accessory', notes: 'Reps per leg' },
        { name: 'Lat Pulldown or Cable Row', muscle: 'Back', sets: 3, reps: [10, 12], type: 'accessory' },
        { name: 'Face Pull', muscle: 'Shoulders', sets: 3, reps: [15, 15], type: 'accessory' },
        { name: 'Heavy Supinated Curl (barbell or DB)', muscle: 'Biceps', sets: 4, reps: [5, 8], type: 'accessory' },
        { name: 'Pronation (loaded lever or DB)', muscle: 'Forearms', sets: 3, reps: [8, 12], type: 'accessory' },
        { name: 'Cupping Wrist Curl', muscle: 'Forearms', sets: 3, reps: [8, 12], type: 'accessory' },
        { name: 'Overhead Triceps Extension (cable or DB)', muscle: 'Triceps', sets: 3, reps: [10, 12], type: 'accessory' },
        { name: 'Ab Wheel', bw: true, muscle: 'Abs', sets: 3, reps: [8, 12], type: 'accessory' },
      ],
    },
    {
      name: 'Day 3: Volume', weekday: 0, notes: 'Lighter day after Saturday — don’t chase PRs.',
      exercises: [
        { name: 'Incline Barbell Bench', muscle: 'Chest', sets: 3, reps: [8, 10], type: 'main', notes: 'Moderate, stop 2–3 reps shy of failure' },
        { name: 'Chin-up (bodyweight)', bw: true, muscle: 'Back', sets: 3, reps: [6, 8], type: 'main' },
        { name: 'Leg Press', muscle: 'Quads', sets: 3, reps: [8, 10], type: 'main', notes: 'Moderate effort' },
        { name: 'Leg Curl', muscle: 'Hamstrings', sets: 3, reps: [10, 12], type: 'accessory' },
        { name: 'Seated Cable Row', muscle: 'Back', sets: 3, reps: [10, 12], type: 'accessory' },
        { name: 'Push-up', bw: true, muscle: 'Chest', sets: 2, reps: [10, 15], type: 'accessory', notes: 'Stop 2 reps shy of failure' },
        { name: 'Reverse Curl', muscle: 'Forearms', sets: 3, reps: [10, 12], type: 'accessory' },
        { name: 'Rising Curl (wrist extension)', muscle: 'Forearms', sets: 3, reps: [12, 15], type: 'accessory' },
        { name: 'Finger Extension (band)', bw: true, muscle: 'Forearms', sets: 2, reps: [15, 20], type: 'accessory' },
        { name: 'Static Hold (mid-range curl or band/cable pull)', bw: true, muscle: 'Forearms', sets: 3, reps: [15, 20], type: 'accessory', timed: true, notes: 'Log seconds, not reps' },
        { name: 'Skull Crusher', muscle: 'Triceps', sets: 3, reps: [10, 12], type: 'accessory', notes: 'Keep light' },
        { name: 'Rear Delt Fly', muscle: 'Shoulders', sets: 3, reps: [15, 15], type: 'accessory' },
        { name: 'Calf Raise', muscle: 'Calves', sets: 3, reps: [12, 15], type: 'accessory' },
      ],
    },
  ],
};
