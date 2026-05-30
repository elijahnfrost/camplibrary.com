// Camp Library — seed data + display helpers.
// Ported from the Claude Design prototype (camp-data.js). Seed content is preserved verbatim.

import type {
  Activity,
  AgeGroup,
  Category,
  Place,
  Slot,
} from "./types";

// Category order drives the shelves.
export const CATEGORIES: Category[] = [
  { id: "Game", label: "Games", numeral: "I" },
  { id: "Craft", label: "Crafts", numeral: "II" },
  { id: "Song", label: "Songs & Circle", numeral: "III" },
  { id: "Water", label: "Water & Wide", numeral: "IV" },
  { id: "Quiet", label: "Quiet Time", numeral: "V" },
];

export const ENERGY = ["", "Calm", "Lively", "Rowdy"] as const;

const PLACE_SHORT: Record<Place, string> = { Inside: "IN", Outside: "OUT", Both: "BOTH" };

// Age groups are a TAG. Each activity carries `ages` = list of group ids.
export const AGE_GROUPS: AgeGroup[] = [
  { id: "pre", label: "Preschool", short: "PreK", lo: 0, hi: 0, min: 3, max: 5 },
  { id: "g13", label: "Grades 1–3", short: "Gr 1–3", lo: 1, hi: 3, min: 6, max: 9 },
  { id: "g46", label: "Grades 4–6", short: "Gr 4–6", lo: 4, hi: 6, min: 9, max: 12 },
];

// Schedule scaffolding (ported from camp-schedule.jsx).
export const SLOTS: Slot[] = [
  { id: "s1", time: "9:00" },
  { id: "s2", time: "10:30" },
  { id: "lunch", meal: true, label: "Lunch & rest hour" },
  { id: "s3", time: "1:30" },
  { id: "s4", time: "3:00" },
  { id: "s5", time: "4:30" },
];

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export function ageGroups(a: Pick<Activity, "ages">): AgeGroup[] {
  return AGE_GROUPS.filter((g) => (a.ages || []).indexOf(g.id) >= 0);
}

export function ageSpan(a: Pick<Activity, "ages">): string {
  const gs = ageGroups(a);
  if (!gs.length) return "Grades 4–6";
  const grades = gs.filter((g) => g.lo > 0);
  const hasPre = gs.some((g) => g.id === "pre");
  if (!grades.length) return "Preschool";
  const lo = Math.min(...grades.map((g) => g.lo));
  const hi = Math.max(...grades.map((g) => g.hi));
  if (hasPre) return "PreK–Gr " + hi;
  return "Grades " + lo + "–" + hi;
}

export function ageLabel(a: Pick<Activity, "ages">): string {
  return ageSpan(a);
}

export function ageStamps(a: Pick<Activity, "ages">): string[] {
  return ageGroups(a).map((g) => g.short);
}

function codeAge(a: Pick<Activity, "ages">): string {
  const gs = ageGroups(a);
  const grades = gs.filter((g) => g.lo > 0);
  const hasPre = gs.some((g) => g.id === "pre");
  if (!grades.length) return "PreK";
  const lo = Math.min(...grades.map((g) => g.lo));
  const hi = Math.max(...grades.map((g) => g.hi));
  return hasPre ? "K–" + hi : lo + "–" + hi;
}

export function code(a: Pick<Activity, "type" | "place" | "ages">): string {
  return a.type.charAt(0) + " · " + PLACE_SHORT[a.place] + " · " + codeAge(a);
}

export function groupLabel(a: Pick<Activity, "groupMin" | "groupMax">): string {
  if (a.groupMin == null) return "Any size";
  if (a.groupMax == null) return a.groupMin + "+";
  return a.groupMin + "–" + a.groupMax;
}

export function durLabel(a: Pick<Activity, "durationMin">): string {
  return a.durationMin + " min";
}

export function metaLine(a: Activity): string {
  return [durLabel(a), ageLabel(a), a.place].join("  ·  ");
}

// Approval rating → warm sequential color scale (low = clay, high = green) so the shelf ranks by color.
const RATING_COLORS: Record<number, string> = {
  1: "#cda08a",
  2: "#d8b78f",
  3: "#dcc587",
  4: "#aebf86",
  5: "#85a45f",
};
const RATING_NEUTRAL = "#e6dcc6"; // unrated / not run yet — a plain, blank cover
export const RATING_WORD: Record<number, string> = {
  0: "Not run yet",
  1: "Rough day",
  2: "So-so",
  3: "Solid",
  4: "Crowd-pleaser",
  5: "Camp favorite",
};

export function ratingColor(r: number | undefined): string {
  if (!r || r < 1) return RATING_NEUTRAL;
  return RATING_COLORS[Math.max(1, Math.min(5, Math.round(r)))];
}

// ---------- seed activities ----------
type SeedActivity = Omit<Activity, "ages" | "rating"> & {
  ages?: Activity["ages"];
  rating?: number;
};

const SEED: SeedActivity[] = [
  {
    id: "capture-flag", title: "Capture the Flag", type: "Game", place: "Outside",
    ageMin: 8, ageMax: 12, durationMin: 30, groupMin: 10, groupMax: 30, energy: 3, prep: "Low",
    blurb: "Two teams, two flags, one no-man's-land. The camp classic.",
    materials: ["2 flags or pinnies", "Cones for boundaries", "Team markers"],
    steps: [
      "Split the field in half and place a flag deep in each team's territory.",
      "Mark a small jail near each flag and explain the safe zones.",
      "Players cross into enemy ground to grab the flag — tagged players go to jail.",
      "Freed by a teammate's touch; first team to carry the enemy flag home wins.",
    ],
    notes: "For big groups add a second flag per side. For mixed ages, pair a younger camper with an older guard.",
    safety: "Set hard boundary lines away from trees and slopes. No grabbing or tackling — tags are two-finger touches only.",
  },
  {
    id: "gaga-ball", title: "Gaga Ball", type: "Game", place: "Outside",
    ageMin: 7, ageMax: 14, durationMin: 20, groupMin: 6, groupMax: 20, energy: 3, prep: "None",
    blurb: "Dodgeball's faster, friendlier cousin — played in a pit.",
    materials: ["Soft foam ball", "Gaga pit or taped octagon"],
    steps: [
      "Everyone starts with a hand on the wall of the pit.",
      "Ball is tossed in; on the third bounce, play begins.",
      "Hit opponents below the knee to eliminate them.",
      "Last camper standing wins; reset and play again.",
    ],
    notes: "No pit? Tape an octagon on a gym floor or use pool noodles as a low wall.",
    safety: "Underhand hits only, below the knee. Watch for collisions when the pit gets crowded.",
  },
  {
    id: "sharks-minnows", title: "Sharks & Minnows", type: "Game", place: "Both",
    ageMin: 6, ageMax: 12, durationMin: 15, groupMin: 8, groupMax: 30, energy: 2, prep: "None",
    blurb: "A dash across open ground while the sharks try to tag you.",
    materials: ["Two boundary lines (cones or chalk)"],
    steps: [
      "Pick one or two 'sharks' to stand in the middle.",
      "'Minnows' line up on one side and run to the other on 'Go'.",
      "Tagged minnows become sharks for the next round.",
      "Keep going until one minnow remains — they start as shark next game.",
    ],
    notes: "Indoors, swap running for power-walking or crab-walking to keep it calm.",
    safety: "Run in one direction only; no diving. Keep the run zone clear of furniture.",
  },
  {
    id: "camouflage", title: "Camouflage", type: "Game", place: "Outside",
    ageMin: 8, ageMax: 14, durationMin: 20, groupMin: 6, groupMax: 20, energy: 2, prep: "None",
    blurb: "Hide-and-seek for the wide outdoors — freeze, hide, and creep closer.",
    materials: ["A bandana or blindfold (optional)"],
    steps: [
      "One leader stands at a base and closes their eyes, counting to thirty.",
      "Everyone hides — but must stay able to see the leader.",
      "Leader opens eyes and calls out anyone they spot.",
      "On the next count, hiders creep closer; first to touch base wins.",
    ],
    notes: "Great for tree-lined fields. Add rounds where players must move closer each count.",
    safety: "Define a clear hiding boundary. No climbing trees or hiding near water.",
  },
  {
    id: "friendship-bracelets", title: "Friendship Bracelets", type: "Craft", place: "Inside",
    ageMin: 6, ageMax: 14, durationMin: 30, groupMin: null, groupMax: null, energy: 1, prep: "Low",
    blurb: "Knotted embroidery floss — the trade currency of every camp.",
    materials: ["Embroidery floss (3–4 colors each)", "Tape or safety pins", "Scissors"],
    steps: [
      "Cut four strands about an arm's length and knot them at the top.",
      "Tape the knot to the table or pin it to a knee.",
      "Make forward knots across, color by color.",
      "Tie off and trade with a friend.",
    ],
    notes: "Younger campers do well with a simple braid before learning knots.",
    safety: "Supervise scissors. Keep floss lengths short to avoid tangles around fingers.",
  },
  {
    id: "tie-dye", title: "Tie-Dye Shirts", type: "Craft", place: "Outside",
    ageMin: 9, ageMax: 14, durationMin: 45, groupMin: null, groupMax: null, energy: 1, prep: "High",
    blurb: "Rubber bands, squeeze bottles, and a spiral of color.",
    materials: ["White cotton shirts", "Dye in squeeze bottles", "Rubber bands", "Gloves", "Plastic table cover"],
    steps: [
      "Pre-soak shirts and prep dye stations before campers arrive.",
      "Twist and band each shirt into a spiral or stripes.",
      "Apply dye, fully saturating each section.",
      "Bag shirts to set overnight, then rinse and dry.",
    ],
    notes: "High prep: mix dye and cover tables ahead of time. Label bags with names.",
    safety: "Gloves required. Dye stains — work outdoors and keep it off skin and eyes.",
  },
  {
    id: "leaf-rubbings", title: "Leaf Rubbings", type: "Craft", place: "Both",
    ageMin: 5, ageMax: 10, durationMin: 20, groupMin: null, groupMax: null, energy: 1, prep: "Low",
    blurb: "A nature walk that turns into a gallery of textures.",
    materials: ["Paper", "Peeled crayons", "Collected leaves"],
    steps: [
      "Take a short walk to collect a few interesting leaves.",
      "Place a leaf vein-side up under a sheet of paper.",
      "Rub the side of a crayon over it to reveal the pattern.",
      "Layer colors and label each leaf.",
    ],
    notes: "Pair with a quick lesson on leaf shapes and tree names.",
    safety: "Remind campers which plants to avoid touching (poison ivy, thorns).",
  },
  {
    id: "painted-rocks", title: "Painted Rocks", type: "Craft", place: "Both",
    ageMin: 6, ageMax: 12, durationMin: 25, groupMin: null, groupMax: null, energy: 1, prep: "Medium",
    blurb: "Smooth stones become bugs, faces, and trail markers.",
    materials: ["Smooth rocks", "Acrylic paint", "Brushes", "Newspaper"],
    steps: [
      "Wash and dry rocks; set out painting stations on newspaper.",
      "Sketch a design lightly before painting.",
      "Paint base colors first, details once dry.",
      "Let dry fully before sending home.",
    ],
    notes: "Hide finished rocks around camp for a later scavenger hunt.",
    safety: "Use washable or non-toxic acrylics. Cover clothing.",
  },
  {
    id: "boom-chicka-boom", title: "Boom Chicka Boom", type: "Song", place: "Both",
    ageMin: 5, ageMax: 12, durationMin: 5, groupMin: null, groupMax: null, energy: 2, prep: "None",
    blurb: "A call-and-response echo song with endless silly styles.",
    materials: [],
    steps: [
      "Leader sings a line; the group echoes it back.",
      "Work through the verse: 'I said a boom chicka boom.'",
      "Call a style — underwater, robot, opera — and repeat.",
      "End by getting quieter and quieter.",
    ],
    notes: "Let campers invent the next style. Perfect for transitions and lines.",
    safety: "No safety concerns — just protect your ears on the loud styles.",
  },
  {
    id: "princess-pat", title: "Princess Pat", type: "Song", place: "Both",
    ageMin: 5, ageMax: 12, durationMin: 5, groupMin: null, groupMax: null, energy: 2, prep: "None",
    blurb: "A marching echo song with big arm motions.",
    materials: [],
    steps: [
      "Teach the four motions before singing.",
      "Leader sings each line; group echoes with motions.",
      "Speed up slightly with each round.",
      "Finish on the fastest round everyone can manage.",
    ],
    notes: "Great around a campfire or while waiting for the next activity.",
    safety: "Give campers arm room for the motions.",
  },
  {
    id: "moose-song", title: "The Moose Song", type: "Song", place: "Both",
    ageMin: 6, ageMax: 12, durationMin: 5, groupMin: null, groupMax: null, energy: 3, prep: "None",
    blurb: "Juice, moose, and antlers — loud, fast, and gloriously silly.",
    materials: [],
    steps: [
      "Teach the chorus and the antler hand motion.",
      "Sing through the verse together.",
      "Add the motions and speed up each round.",
      "End with the biggest, loudest antlers.",
    ],
    notes: "An energy-burner — use it to wake a sleepy group up.",
    safety: "Loud by design; keep it short to save voices.",
  },
  {
    id: "sponge-relay", title: "Sponge Relay", type: "Water", place: "Outside",
    ageMin: 6, ageMax: 14, durationMin: 15, groupMin: 8, groupMax: 24, energy: 3, prep: "Low",
    blurb: "Soak it, sprint it, squeeze it — first bucket full wins.",
    materials: ["Large sponges", "Buckets (two per team)", "Water source"],
    steps: [
      "Fill a full bucket at the start and an empty one at each team's end.",
      "Soak the sponge, run it down, squeeze it into the empty bucket.",
      "Pass back and repeat down the line.",
      "First team to fill their bucket to the line wins.",
    ],
    notes: "Mark a fill line so teams know the target. Great on a hot day.",
    safety: "Run on grass, not pavement — wet feet slip. Keep the path clear.",
  },
  {
    id: "drip-drip-drop", title: "Drip Drip Drop", type: "Water", place: "Outside",
    ageMin: 6, ageMax: 12, durationMin: 15, groupMin: 8, groupMax: 20, energy: 2, prep: "Low",
    blurb: "Duck-Duck-Goose with a cup of water and a gleeful splash.",
    materials: ["A cup of water", "A circle of seated campers"],
    steps: [
      "Everyone sits in a circle; one camper is 'it' with the cup.",
      "They walk around dripping a little water on each head — 'drip'.",
      "On 'drop', they douse someone, who jumps up to chase.",
      "If caught before the open seat, they're 'it' again.",
    ],
    notes: "Refill the cup between rounds. Keep the circle tight for fair chases.",
    safety: "Sit on grass to avoid slips. Empty the cup gently — no faces.",
  },
  {
    id: "story-circle", title: "Story Circle", type: "Quiet", place: "Both",
    ageMin: 5, ageMax: 12, durationMin: 20, groupMin: null, groupMax: null, energy: 1, prep: "None",
    blurb: "One sentence each, around the circle, until a tale appears.",
    materials: ["A talking stick or small object (optional)"],
    steps: [
      "Sit in a circle and set the opening line together.",
      "Each camper adds one sentence when holding the object.",
      "Keep it moving — no skipping, no vetoing.",
      "Wrap the story when it returns to the start.",
    ],
    notes: "A calm closer for the end of the day or a rest hour.",
    safety: "None — a good low-energy reset.",
  },
  {
    id: "nature-journaling", title: "Nature Journaling", type: "Quiet", place: "Outside",
    ageMin: 8, ageMax: 14, durationMin: 30, groupMin: null, groupMax: null, energy: 1, prep: "Low",
    blurb: "Find a sit-spot, slow down, and sketch what you notice.",
    materials: ["Notebooks", "Pencils", "Clipboards (optional)"],
    steps: [
      "Hand out journals and walk to a quiet outdoor spot.",
      "Each camper picks a sit-spot a few steps apart.",
      "Spend ten minutes sketching or writing what they observe.",
      "Regroup and share one discovery each.",
    ],
    notes: "Prompt with 'I notice / I wonder / It reminds me of'.",
    safety: "Set a clear boundary for sit-spots and a recall signal.",
  },
];

// Seed approval ratings (1–5) — editable in-app, overrides persist in localStorage.
const SEED_RATINGS: Record<string, number> = {
  "capture-flag": 5, "gaga-ball": 5, "sharks-minnows": 4, "camouflage": 3,
  "friendship-bracelets": 5, "tie-dye": 4, "leaf-rubbings": 3, "painted-rocks": 4,
  "boom-chicka-boom": 5, "princess-pat": 3, "moose-song": 4,
  "sponge-relay": 5, "drip-drip-drop": 4, "story-circle": 3, "nature-journaling": 4,
};

// Derive age-group tags from the original min/max ranges.
function deriveAges(a: SeedActivity): Activity["ages"] {
  if (a.ages && a.ages.length) return a.ages;
  const ids = AGE_GROUPS.filter((g) => a.ageMin <= g.max && a.ageMax >= g.min).map((g) => g.id);
  return ids.length ? ids : ["g46"];
}

export const ACTIVITIES: Activity[] = SEED.map((a) => ({
  ...a,
  ages: deriveAges(a),
  rating: SEED_RATINGS[a.id] ?? 3,
}));

export function monogram(title: string): string {
  return title.trim().charAt(0).toUpperCase();
}
