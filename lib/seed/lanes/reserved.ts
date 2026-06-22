// Camp Library — reserved seed activities.
//
// Three camp staples kept on stable ids so their built-in field diagrams keep
// resolving (capture-flag + sharks-minnows live in PLAYBOOKS_BY_ACTIVITY_ID),
// rebuilt to the current quality bar with the full field set — alt-names, media,
// links, variations, and per-step sub-steps. Hand-authored (not generated) so
// the safety language and diagram coupling stay reviewed.

import type { Activity } from "@/lib/types";

export const reservedActivities: Activity[] = [
  {
    id: "capture-flag",
    title: "Capture the Flag",
    altNames: ["CTF", "Capture the Banner", "Steal the Flag"],
    type: "Game",
    place: "Outside",
    ageMin: 8,
    ageMax: 15,
    ages: ["g13", "g46", "g79"],
    durationMin: 30,
    groupMin: 10,
    groupMax: 30,
    energy: 3,
    prep: "Low",
    rating: 5,
    blurb: "Two teams, two flags, one no-man's-land. The camp classic.",
    materials: [
      "2 flags or pinnies",
      "8-12 cones for boundaries",
      "Team identifiers, such as pinnies or bandanas",
    ],
    materialTags: ["Flags or pinnies", "Cones", "Team identifiers"],
    steps: [
      "Split the field in half and place a flag deep in each team's territory.",
      "Mark a small jail near each flag and explain the safe zones.",
      "Players cross into enemy ground to grab the flag — tagged players go to jail.",
      "Freed by a teammate's touch; first team to carry the enemy flag home wins.",
    ],
    subsets: [
      [
        "Use cones or a chalk line to mark a clear midfield boundary everyone can see.",
        "Set each flag in plain sight, about ten big steps from the back line — not hidden.",
      ],
      [
        "Mark each jail with four cones a few steps to the side of the flag.",
        "Walk the group through where they are safe and where they can be tagged before the whistle.",
      ],
      [],
      [],
    ],
    notes:
      "For big groups add a second flag per side. For mixed ages, pair a younger camper with an older guard so nobody is left guarding alone.",
    safety:
      "Set hard boundary lines away from trees and slopes. No grabbing or tackling — tags are two-finger touches only.",
    variations: [
      "Big groups (24+): add a second flag per side so more campers can score at once and the field never bottlenecks.",
      "Mixed ages: give younger runners a three-second head start and pair them with an older guard.",
      "Older grades (7-12): shrink the safe zones, allow only one guard within five steps of a flag, and require a two-hand tag to free a jailed teammate — it forces real strategy and communication.",
    ],
    media: [
      {
        title: "Video demos: Capture the Flag",
        url: "https://www.youtube.com/results?search_query=capture+the+flag+camp+game+how+to+play",
      },
    ],
    links: [
      {
        label: "Capture the Flag (Rustic Pathways)",
        url: "https://rusticpathways.com/blog/summer-camp-activities",
      },
      {
        label: "More ideas: Capture the Flag variations",
        url: "https://www.google.com/search?q=capture+the+flag+variations+summer+camp",
      },
    ],
  },
  {
    id: "gaga-ball",
    title: "Gaga Ball",
    altNames: ["Gaga", "Ga-ga ball", "Octoball", "Goggaball"],
    type: "Game",
    place: "Outside",
    ageMin: 7,
    ageMax: 15,
    ages: ["g13", "g46", "g79"],
    durationMin: 30,
    groupMin: 6,
    groupMax: 20,
    energy: 3,
    prep: "None",
    rating: 5,
    blurb: "Dodgeball's faster, friendlier cousin — played in a pit.",
    materials: [
      "1 soft foam gaga ball or playground ball",
      "Gaga pit or floor tape for an octagon boundary",
    ],
    materialTags: ["Soft foam playground ball", "Gaga pit or floor tape"],
    steps: [
      "Everyone spreads around the inside of the pit with one hand on the wall.",
      "Drop the ball in the center; the group calls 'Ga'… 'Ga'… 'Go!' on each bounce — only after 'Go' may anyone touch it.",
      "Slap the ball with an open hand to hit other players at or below the knee; a clean low hit puts that player out.",
      "You can't hit the ball twice in a row — it has to touch another player or the wall before you may hit it again.",
      "Out players step outside the wall and become wall-judges who call hits and toss escaped balls back in.",
      "Last camper in wins the round; rounds are short (1-3 min) so everyone re-enters for the next one.",
    ],
    subsets: [
      [],
      ["A hit above the knee does not count and nobody is out.", "A ball off the wall is live."],
      [],
      ["If a player catches the ball straight off someone's hand before it bounces, the hitter is out instead."],
      [],
      [],
    ],
    notes:
      "Hits above the knee don't count; a ball off the wall is live. No scooping, holding, or lifting the ball — open-hand slaps along the ground only. For the youngest groups, drop the catch-out and double-hit rules and referee every call. No pit? Tape an octagon on flat ground or use pool noodles as a low wall.",
    safety:
      "Open-hand slaps along the ground only — no overhand throwing or scooping the ball to launch it (a lifted ball is the main face-hit risk). Stay on your feet: no diving or kneeling slides, and don't sit, climb, or hang on the wall. Tie back long hair and secure glasses.",
    variations: [
      "Crowded pit: play 'two-ball gaga' with a second ball to speed up a big group and cut waiting.",
      "Youngest groups: keep only 'below the knee = out', referee every call, and skip the catch-out rule.",
      "Older grades (7-12): add 'sudden death' for the final two — first clean low hit wins — and allow no-look bank shots off the wall for a real skill ceiling.",
    ],
    media: [
      {
        title: "Video demos: Gaga Ball",
        url: "https://www.youtube.com/results?search_query=gaga+ball+how+to+play+rules",
      },
    ],
    links: [
      {
        label: "More ideas: Gaga Ball rules & variations",
        url: "https://www.google.com/search?q=gaga+ball+rules+and+variations",
      },
    ],
  },
  {
    id: "sharks-minnows",
    title: "Sharks & Minnows",
    altNames: ["Octopus", "Fishes and Sharks", "Sharks and Fishes"],
    type: "Game",
    place: "Both",
    ageMin: 6,
    ageMax: 12,
    ages: ["g13", "g46"],
    durationMin: 15,
    groupMin: 8,
    groupMax: 30,
    energy: 2,
    prep: "None",
    rating: 4,
    blurb: "A dash across open ground while the sharks try to tag you.",
    materials: ["8-12 cones, sidewalk chalk, or floor tape for two boundary lines"],
    materialTags: ["Boundary markers"],
    steps: [
      "Pick one or two 'sharks' to stand in the middle.",
      "'Minnows' line up on one side and run to the other on 'Go'.",
      "Tagged minnows become sharks for the next round.",
      "Keep going until one minnow remains — they start as shark next game.",
    ],
    subsets: [
      [],
      ["Set two clear shore lines far enough apart for a real sprint.", "Sharks may only tag in the open ocean between the shores."],
      [],
      [],
    ],
    notes:
      "Indoors, swap running for power-walking or crab-walking to keep it calm. With a big group, start with two or three sharks so the first round isn't too long.",
    safety: "Run in one direction only; no diving. Keep the run zone clear of furniture and obstacles.",
    variations: [
      "Indoors or small space: replace running with power-walking, crab-walking, or heel-to-toe steps.",
      "Big groups (24+): start with three sharks and add a second 'safe island' cone mid-ocean for a one-second pause.",
      "Older grades (7-9): add a 'frozen seaweed' rule — tagged players freeze in place with arms out and can also tag, turning it into a fast strategy game.",
    ],
    media: [
      {
        title: "Video demos: Sharks and Minnows",
        url: "https://www.youtube.com/results?search_query=sharks+and+minnows+tag+game+how+to+play",
      },
    ],
    links: [
      {
        label: "More ideas: Sharks & Minnows variations",
        url: "https://www.google.com/search?q=sharks+and+minnows+game+variations+camp",
      },
    ],
  },
];
