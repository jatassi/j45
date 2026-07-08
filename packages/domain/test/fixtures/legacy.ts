// Four legacy F45 days (`~/Git/diet-f45/public/workouts.json`), transcribed
// into the new model with HTML stripped to plain text. Golden segment
// sequences for these fixtures live alongside in `legacy-goldens.ts`.
import { Flow, Pod, Round, Station, Workout } from '../../src/workout.js'

// ── Athletica — laps ×3, uniform 40″/20″, 3 pods × 3 stations ───────────
const athleticaPods: readonly [Pod, ...Pod[]] = [
  new Pod({
    name: 'Pod 1',
    stations: [
      new Station({ name: 'Rower — strong, steady pulls' }),
      new Station({ name: 'Dumbbell squat + alternating shoulder press' }),
      new Station({ name: 'Burpee', detail: '(step back = no-jump)' }),
    ],
  }),
  new Pod({
    name: 'Pod 2',
    stations: [
      new Station({ name: 'Bike or treadmill — sprint effort' }),
      new Station({ name: 'Kettlebell swing' }),
      new Station({ name: 'Mountain climbers — fast, hips low' }),
    ],
  }),
  new Pod({
    name: 'Pod 3',
    stations: [
      new Station({ name: 'Dumbbell single-arm snatch — alternate arms' }),
      new Station({ name: 'Box / bench explosive step-ups' }),
      new Station({ name: 'Slam-ball over-shoulder throw', detail: '(sub: dumbbell thruster)' }),
    ],
  }),
]

export const athletica = new Workout({
  name: 'Athletica',
  focus: 'cardio',
  note: 'One rower/bike? Split stations 1 & 4 — one works the machine, the other does the next floor station; swap each lap.',
  pods: athleticaPods,
  flow: new Flow({
    type: 'laps',
    rounds: [
      new Round({ workSeconds: 40, restSeconds: 20 }),
      new Round({ workSeconds: 40, restSeconds: 20 }),
      new Round({ workSeconds: 40, restSeconds: 20 }),
    ],
  }),
})

// ── Docklands — laps ×4, ladder 60/30·30/15·20/10·20/5, 3 pods × 3 ───────
const docklandsPods: readonly [Pod, ...Pod[]] = [
  new Pod({
    name: 'Pod 1',
    stations: [
      new Station({ name: 'Box / bench jump (or step-up)' }),
      new Station({ name: 'Rower' }),
      new Station({ name: 'Yogi push-up (down-dog → push-up)' }),
    ],
  }),
  new Pod({
    name: 'Pod 2',
    stations: [
      new Station({ name: 'Med ball shuffle + rotation' }),
      new Station({ name: 'Dumbbell punches — 4 high + 4 straight' }),
      new Station({ name: 'Plate / dumbbell snatch' }),
    ],
  }),
  new Pod({
    name: 'Pod 3',
    stations: [
      new Station({ name: 'Mountain climbers' }),
      new Station({ name: 'Kettlebell swing' }),
      new Station({ name: 'Bike — climb (high resistance)' }),
    ],
  }),
]

export const docklands = new Workout({
  name: 'Docklands',
  focus: 'cardio',
  note: 'The descending laps are brutal solo — count each other down the last two laps.',
  pods: docklandsPods,
  flow: new Flow({
    type: 'laps',
    rounds: [
      new Round({ workSeconds: 60, restSeconds: 30 }),
      new Round({ workSeconds: 30, restSeconds: 15 }),
      new Round({ workSeconds: 20, restSeconds: 10 }),
      new Round({ workSeconds: 20, restSeconds: 5 }),
    ],
  }),
})

// ── Medusa — sets ×3, ladder 60/15·60/20·60/30, 1 pod × 9 stations ───────
const medusaPods: readonly [Pod, ...Pod[]] = [
  new Pod({
    name: 'Circuit · 3 sets per station',
    stations: [
      new Station({ name: 'Barbell RDL' }),
      new Station({ name: 'Kettlebell goblet sumo squat' }),
      new Station({ name: 'Dumbbell incline close-grip press' }),
      new Station({ name: 'Barbell pendlay row' }),
      new Station({ name: 'Dumbbell Bulgarian split squat — tempo 4-0-1' }),
      new Station({ name: 'Hip bridge / hamstring walk-outs' }),
      new Station({ name: 'Kettlebell single-arm bent row → explosive high pull' }),
      new Station({ name: 'Dumbbell alternating hammer curl + shoulder press' }),
      new Station({ name: 'Dumbbell flat chest fly' }),
    ],
  }),
]

export const medusa = new Workout({
  name: 'Medusa',
  focus: 'strength',
  note: "Spot every heavy set. Ascending rest gives you time to strip and add plates between each other's turns.",
  pods: medusaPods,
  flow: new Flow({
    type: 'sets',
    rounds: [
      new Round({ workSeconds: 60, restSeconds: 15 }),
      new Round({ workSeconds: 60, restSeconds: 20 }),
      new Round({ workSeconds: 60, restSeconds: 30 }),
    ],
  }),
})

// ── Apex — laps ×1, uniform 240″/30″, 1 pod × 8 A/B combo stations ───────
const apexPods: readonly [Pod, ...Pod[]] = [
  new Pod({
    name: '8 combo stations · A then B',
    stations: [
      new Station({ name: 'A Dumbbell sprawl + lateral jump · B Dumbbell single-arm side lunge' }),
      new Station({
        name: 'A Sandbag/dumbbell clean + forward lunge · B Sandbag/dumbbell bear-hug squat (pause)',
      }),
      new Station({ name: 'A Barbell hang clean · B Slam ball / dumbbell over-shoulder throw' }),
      new Station({ name: 'A Dumbbell speed sumo squat + curl · B Push-up + spider lunge + row' }),
      new Station({ name: 'A Bike sprint (30s) · B Kettlebell deficit deadlift' }),
      new Station({ name: 'A Slam ball throw-up squat & catch · B Dumbbell bear-hug carry (20m)' }),
      new Station({ name: 'A Kettlebell swing · B Hand-release burpee' }),
      new Station({ name: 'A Rower (30s) · B Step incline push-up to T-reach' }),
    ],
  }),
]

export const apex = new Workout({
  name: 'Apex',
  focus: 'strength',
  note: 'Pyramids are made for partners — one does move A while the other does B, swap when you both finish a tier. Race to the 6s.',
  pods: apexPods,
  flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 240, restSeconds: 30 })] }),
})
