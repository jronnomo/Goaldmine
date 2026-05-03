// 90-day Mt. Elbert / shred / longevity program.
// Source-of-truth template; persisted as Program.planJson and read by the dashboard.

export type ExercisePrescription = {
  name: string;
  equipment?: string;
  sets?: number;
  reps?: string | number; // "max" | "8-12" | 12
  durationSec?: number;
  weightHint?: string; // free-form (e.g. "moderate", "30-50 lb DBs")
  notes?: string;
};

export type Block = {
  type: "straight" | "superset" | "finisher" | "mobility" | "cardio";
  label?: string;
  exercises: ExercisePrescription[];
  rounds?: number; // for supersets / circuits
  restSec?: number;
};

export type DayTemplate = {
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 = Monday
  title: string;
  category:
    | "upper"
    | "lower"
    | "zone2-mobility"
    | "calisthenics"
    | "lower-power"
    | "long-endurance"
    | "rest";
  summary: string;
  blocks: Block[];
};

export type NutritionGuidance = {
  calorieGuidance: string;
  proteinTargetG: { low: number; high: number };
  hydration: string;
  habits: string[];
  notes?: string;
};

export type MobilityFocus = {
  emphasis: string[];
  dailyMin: number;
  notes?: string;
};

export type Phase = {
  index: 1 | 2 | 3;
  name: string;
  weeks: number[]; // 1-12
  goal: string;
  emphasis: string;
  nutrition: NutritionGuidance;
  mobility: MobilityFocus;
};

export type BaselineTest = {
  testName: string;
  units: string;
  protocol: string;
  retestWeeks: number[]; // e.g. [6, 12]
};

export type BaselineDay = {
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  title: string;
  tests: BaselineTest[];
};

export type DailyMobilityRoutine = {
  durationMin: number;
  exercises: ExercisePrescription[];
  notes?: string;
};

export type ProgramTemplate = {
  name: string;
  totalWeeks: number;
  phases: Phase[];
  weeklySplit: DayTemplate[];
  baselineWeek: BaselineDay[];
  hikingSuperset: Block; // injected into Day 2 main + Day 5 light
  dailyMobility: DailyMobilityRoutine;
  goals: string[];
};

const HIKING_SUPERSET: Block = {
  type: "superset",
  label: "Hiking-specific superset",
  rounds: 4,
  restSec: 75,
  exercises: [
    {
      name: "Step-Up",
      equipment: "Box (16-20\")",
      reps: "12-15 each leg",
      weightHint: "Bodyweight → light DBs → heavier DBs over phases",
      notes: "Knee tracks toes. Drive through heel. Control the descent.",
    },
    {
      name: "StairMaster or Incline Bike",
      durationSec: 150,
      notes: "Sustainable climb pace; not a sprint.",
    },
  ],
};

export const PROGRAM_TEMPLATE: ProgramTemplate = {
  name: "Mt. Elbert + Shred 90-Day",
  totalWeeks: 12,
  goals: [
    "Summit Mt. Elbert via Black Cloud Trail",
    "Drop to 155 lb lean",
    "Hike + backpack with confidence",
    "Snowboard with power and balance",
    "Maintain joint health for the long haul",
  ],
  phases: [
    {
      index: 1,
      name: "Foundation & Movement Quality",
      weeks: [1, 2, 3, 4],
      goal: "Build consistency, joint strength, aerobic base",
      emphasis: "Bodyweight or light DBs. Conversational cardio. Daily mobility.",
      nutrition: {
        calorieGuidance: "Maintenance to slight deficit (~200 kcal/day). Don't over-restrict early — recovery matters more than fat loss this phase.",
        proteinTargetG: { low: 140, high: 160 },
        hydration: "0.5–1 oz / lb body weight; more on long-effort days. Electrolytes on Day 6.",
        habits: [
          "Whole foods. Eat protein at every meal.",
          "Pre-workout: small carb + protein 30–60 min out (banana + Greek yogurt).",
          "Post-workout (within 60 min): 30–40 g protein + carbs.",
          "Track for one week to calibrate intuition; then ease off the spreadsheet.",
        ],
      },
      mobility: {
        emphasis: ["ankles", "hips", "thoracic spine", "shoulders"],
        dailyMin: 10,
        notes:
          "Goal: groove the routine. Quality over depth. If you skip a day, do 5 min of deep squat hold the next.",
      },
    },
    {
      index: 2,
      name: "Strength + Work Capacity",
      weeks: [5, 6, 7, 8],
      goal: "Improve strength, increase intensity, burn fat",
      emphasis: "Add load. Add rounds. Re-test at end of week 6.",
      nutrition: {
        calorieGuidance: "Slight deficit (~300–500 kcal/day) on most days. Eat at maintenance on long-hike Saturdays — those are fueling days, not deficit days.",
        proteinTargetG: { low: 150, high: 170 },
        hydration: "Same baseline; add 16–24 oz/hr on hikes >2 hours. Salt before long efforts.",
        habits: [
          "Stop drinking calories (no juice, no sweetened drinks).",
          "Carb-time around your hardest sessions (Day 2, Day 5, Day 6).",
          "If hunger crashes performance, take a refeed day at maintenance — not a binge.",
          "Sleep 7+ hours: under-sleep nukes both fat loss and lifts.",
        ],
      },
      mobility: {
        emphasis: ["hips", "thoracic spine", "ankle dorsiflexion", "lat length"],
        dailyMin: 12,
        notes:
          "Add controlled-articular-rotations (CARs) for hips and shoulders 2x/week. Increase deep squat hold to 90s.",
      },
    },
    {
      index: 3,
      name: "Performance & Shred",
      weeks: [9, 10, 11, 12],
      goal: "Peak conditioning, definition, athletic performance",
      emphasis: "Push intensity. Pack-weighted hikes. Re-test at day 90.",
      nutrition: {
        calorieGuidance: "Aggressive deficit only on rest days; maintenance on training days; slight surplus the day before a big hike. Carb-cycle.",
        proteinTargetG: { low: 160, high: 180 },
        hydration: "Pre-hydrate the day before long efforts. On hike day: 20–30 oz/hr + 200–400 mg sodium/hr.",
        habits: [
          "Practice your hike-day nutrition strategy on training hikes — don't try anything new on Elbert.",
          "Caffeine timed for the climb (1–2 hr before pre-dawn start) if you use it.",
          "Last 7 days: drop alcohol, hit protein, prioritize sleep.",
          "Don't lose weight in the final 2 weeks — peak performance > peak leanness for the summit.",
        ],
      },
      mobility: {
        emphasis: ["ankles (descent)", "calves", "hip flexors", "thoracic"],
        dailyMin: 15,
        notes:
          "Calf and ankle work is non-negotiable — descents wreck the underprepared. Add eccentric calf raises 3x/week.",
      },
    },
  ],
  weeklySplit: [
    {
      dayOfWeek: 1,
      title: "Upper Body + Core",
      category: "upper",
      summary: "Calisthenics-focused upper push/pull with a short cardio finisher.",
      blocks: [
        {
          type: "straight",
          label: "Strict pulling (full rest)",
          exercises: [
            { name: "Pull-Up", sets: 4, reps: "max", notes: "Strict form. Assisted if needed." },
          ],
          restSec: 150,
        },
        {
          type: "superset",
          label: "Push/Pull pairing",
          rounds: 4,
          restSec: 90,
          exercises: [
            { name: "Push-Up", reps: "12-20", notes: "Decline if strong." },
            { name: "Bent Over One Arm Row", equipment: "Dumbbell", reps: 10 },
          ],
        },
        {
          type: "straight",
          label: "Overhead press",
          exercises: [
            { name: "Shoulder Press", equipment: "Dumbbell", sets: 4, reps: 10 },
          ],
          restSec: 90,
        },
        {
          type: "superset",
          label: "Core",
          rounds: 4,
          restSec: 45,
          exercises: [
            { name: "Hanging Knee Raise", reps: 12 },
            { name: "Plank", durationSec: 60 },
          ],
        },
        {
          type: "finisher",
          label: "Cardio finisher",
          exercises: [
            { name: "Bike or StairMaster", durationSec: 600, notes: "Moderate." },
          ],
        },
      ],
    },
    {
      dayOfWeek: 2,
      title: "Lower Body + Cardio",
      category: "lower",
      summary: "Lower strength fresh, then the hiking superset is the engine of the day.",
      blocks: [
        {
          type: "straight",
          label: "Lower strength (full rest)",
          exercises: [
            { name: "Goblet Squat", equipment: "Dumbbell", sets: 4, reps: 12 },
            { name: "Romanian Deadlift", equipment: "Dumbbell", sets: 4, reps: 10 },
          ],
          restSec: 120,
        },
        HIKING_SUPERSET,
        {
          type: "straight",
          label: "Calf accessory",
          exercises: [{ name: "Calf Raise", sets: 4, reps: 15 }],
          restSec: 45,
        },
        {
          type: "cardio",
          label: "Zone 2 (optional if energy allows)",
          exercises: [
            { name: "Easy Jog or Bike", durationSec: 1200, notes: "Conversational pace." },
          ],
        },
      ],
    },
    {
      dayOfWeek: 3,
      title: "Zone 2 + Mobility",
      category: "zone2-mobility",
      summary: "Critical longevity day. Conversational cardio plus a real mobility block.",
      blocks: [
        {
          type: "cardio",
          label: "Zone 2 base",
          exercises: [
            { name: "Easy Run or Bike", durationSec: 2700, notes: "45-60 min, conversational." },
          ],
        },
        {
          type: "mobility",
          label: "Mobility (15-20 min)",
          exercises: [
            { name: "Deep Squat Hold", durationSec: 120 },
            { name: "Hip Flexor Stretch", durationSec: 60, notes: "Each side." },
            { name: "Hamstring Stretch", durationSec: 60, notes: "Each side." },
            { name: "Thoracic Rotation", reps: 10, notes: "Each side." },
            { name: "Shoulder Dislocates", equipment: "Band", reps: 15 },
          ],
        },
      ],
    },
    {
      dayOfWeek: 4,
      title: "Full Body Calisthenics",
      category: "calisthenics",
      summary: "Bodyweight focus to keep relative strength climbing.",
      blocks: [
        {
          type: "straight",
          label: "Pulling fresh",
          exercises: [{ name: "Pull-Up", sets: 5, reps: "max" }],
          restSec: 150,
        },
        {
          type: "superset",
          label: "Push + shoulders",
          rounds: 4,
          restSec: 75,
          exercises: [
            { name: "Dip", reps: "10-15", notes: "Bench dips ok." },
            { name: "Pike Push-Up", reps: 10 },
          ],
        },
        {
          type: "straight",
          label: "Volume legs",
          exercises: [{ name: "Bodyweight Squat", sets: 3, reps: 25 }],
          restSec: 60,
        },
        {
          type: "superset",
          label: "Core",
          rounds: 4,
          restSec: 45,
          exercises: [
            { name: "Hollow Body Hold", durationSec: 30 },
            { name: "Russian Twist", reps: 20 },
          ],
        },
      ],
    },
    {
      dayOfWeek: 5,
      title: "Lower + Explosive + Core",
      category: "lower-power",
      summary: "Snowboard + hiking power day. Power work fresh, lighter hiking superset to finish.",
      blocks: [
        {
          type: "straight",
          label: "Power (full rest)",
          exercises: [
            { name: "Jump Squat", sets: 4, reps: 8, notes: "Reset between reps." },
          ],
          restSec: 150,
        },
        {
          type: "straight",
          label: "Unilateral strength",
          exercises: [
            { name: "Bulgarian Split Squat", equipment: "Dumbbell", sets: 4, reps: "10 each leg" },
            { name: "Deadlift", equipment: "Dumbbell", sets: 4, reps: 8 },
          ],
          restSec: 120,
        },
        {
          type: "superset",
          label: "Lateral + step",
          rounds: 3,
          restSec: 60,
          exercises: [
            { name: "Lateral Lunge", reps: "10 each side" },
            { name: "Box Step-Up", reps: 12 },
          ],
        },
        { ...HIKING_SUPERSET, rounds: 3, label: "Hiking superset (light)" },
        {
          type: "superset",
          label: "Core finisher",
          rounds: 3,
          restSec: 45,
          exercises: [
            { name: "Hanging Leg Raise", reps: 10 },
            { name: "Side Plank", durationSec: 45, notes: "Each side." },
          ],
        },
      ],
    },
    {
      dayOfWeek: 6,
      title: "Long Endurance",
      category: "long-endurance",
      summary: "Long run or hike. Pack weight scales with phase.",
      blocks: [
        {
          type: "cardio",
          label: "Long effort",
          exercises: [
            {
              name: "Long Run or Hike",
              durationSec: 5400,
              notes:
                "Phase 1: 60 min run or easy hike, no pack. Phase 2: 2-4 hr hike, 10-15 lb pack. Phase 3: 4-6+ hr hike, 15-25 lb pack.",
            },
          ],
        },
      ],
    },
    {
      dayOfWeek: 7,
      title: "Rest / Active Recovery",
      category: "rest",
      summary: "Walk, light yoga, stretch. Eat well, sleep more.",
      blocks: [
        {
          type: "mobility",
          label: "Optional gentle movement",
          exercises: [
            { name: "Walk", durationSec: 1800 },
            { name: "Light Yoga or Stretching", durationSec: 900 },
          ],
        },
      ],
    },
  ],
  hikingSuperset: HIKING_SUPERSET,
  dailyMobility: {
    durationMin: 12,
    notes:
      "Run this every day, even rest day. Skipping is the #1 cause of plateaus and injury in this program.",
    exercises: [
      { name: "Deep Squat Hold", durationSec: 90, notes: "Heels down, chest up. Breathe." },
      { name: "Couch Stretch (Hip Flexor)", durationSec: 60, notes: "Each side." },
      { name: "90/90 Hip Switches", reps: 8, notes: "Each side." },
      { name: "Hamstring Stretch", durationSec: 60, notes: "Each side." },
      { name: "Thoracic Rotation", reps: 10, notes: "Each side, slow." },
      { name: "Shoulder Dislocates", equipment: "Band", reps: 15 },
      { name: "Ankle Dorsiflexion Drill", reps: 10, notes: "Each side, knee over toes." },
      { name: "Calf Stretch (Wall)", durationSec: 45, notes: "Each side." },
    ],
  },
  baselineWeek: [
    {
      dayOfWeek: 1,
      title: "Upper Strength + Core Baselines",
      tests: [
        { testName: "Pull-Up Max Reps", units: "reps", protocol: "Strict, single set to failure.", retestWeeks: [6, 12] },
        { testName: "Push-Up Max Reps", units: "reps", protocol: "Clean form, single set to failure.", retestWeeks: [6, 12] },
        { testName: "DB Shoulder Press 8-rep Max", units: "lb", protocol: "Heaviest DB pressed for 8 strict reps.", retestWeeks: [6, 12] },
        { testName: "Plank Max Hold", units: "sec", protocol: "Front plank to form failure.", retestWeeks: [6, 12] },
        { testName: "Dead Hang", units: "sec", protocol: "Passive hang from bar.", retestWeeks: [6, 12] },
      ],
    },
    {
      dayOfWeek: 2,
      title: "Lower Strength Baselines",
      tests: [
        { testName: "Goblet Squat 10-rep Max", units: "lb", protocol: "Heaviest DB held vertically for 10 strict reps.", retestWeeks: [6, 12] },
        { testName: "DB Romanian Deadlift 10-rep Max", units: "lb", protocol: "Heaviest pair of DBs for 10 reps.", retestWeeks: [6, 12] },
        { testName: "Walking Lunge Unbroken", units: "steps", protocol: "Bodyweight, walking lunges to form break.", retestWeeks: [6, 12] },
        { testName: "Farmer Carry Max Time", units: "sec", protocol: "Heaviest DBs carried until grip fails.", retestWeeks: [6, 12] },
      ],
    },
    {
      dayOfWeek: 3,
      title: "Aerobic Engine",
      tests: [
        { testName: "1.5 Mile Run", units: "sec", protocol: "All-out run, flat course.", retestWeeks: [6, 12] },
        { testName: "20 Min Bike Distance", units: "mi", protocol: "Steady effort, total distance.", retestWeeks: [6, 12] },
      ],
    },
    {
      dayOfWeek: 4,
      title: "Speed + Power",
      tests: [
        { testName: "40-Yard Sprint", units: "sec", protocol: "3 attempts, log best. Full recovery between.", retestWeeks: [6, 12] },
        { testName: "Vertical Jump", units: "in", protocol: "3 attempts, log best.", retestWeeks: [6, 12] },
        { testName: "Broad Jump", units: "in", protocol: "Standing horizontal jump, 3 attempts, log best.", retestWeeks: [6, 12] },
        { testName: "5-10-5 Shuttle", units: "sec", protocol: "Agility shuttle, log best of 3.", retestWeeks: [6, 12] },
      ],
    },
    {
      dayOfWeek: 5,
      title: "Calisthenics Capacity + Endurance",
      tests: [
        { testName: "Pull-Up Total Across 5 Sets", units: "reps", protocol: "Sum of reps across 5 max-effort sets, 90s rest.", retestWeeks: [6, 12] },
        { testName: "Dip Max Reps", units: "reps", protocol: "Strict, single set to failure.", retestWeeks: [6, 12] },
        { testName: "2-Min Bodyweight Squat", units: "reps", protocol: "Total reps in 2 minutes.", retestWeeks: [6, 12] },
        { testName: "Wall Sit Max Hold", units: "sec", protocol: "Thighs parallel, until form failure.", retestWeeks: [6, 12] },
      ],
    },
    {
      dayOfWeek: 6,
      title: "Long Endurance Benchmark",
      tests: [
        { testName: "60 Min Steady Effort Distance", units: "mi", protocol: "Run or hike, log distance and elevation.", retestWeeks: [6, 12] },
        { testName: "20 Min Step-Up Reps", units: "reps", protocol: "16-20\" box, sustainable pace, total reps in 20 min.", retestWeeks: [6, 12] },
      ],
    },
    {
      dayOfWeek: 7,
      title: "Mobility Assessment",
      tests: [
        { testName: "Deep Squat Hold", units: "sec", protocol: "Hold deep squat without discomfort.", retestWeeks: [6, 12] },
        { testName: "Toe Touch Reach", units: "in", protocol: "Standing forward fold, distance from fingertips to floor (negative if past).", retestWeeks: [6, 12] },
        { testName: "Shoulder Flexion Overhead", units: "deg", protocol: "Subjective: 0-180. Can you fully extend overhead?", retestWeeks: [6, 12] },
      ],
    },
  ],
};
