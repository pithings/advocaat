// H1 - question isolation: can one question read a sibling question's text?
// Conditions: secret in a sibling question's instructions (a), in state (b),
// in a sibling question's criteria descriptions (c), nowhere (d, guessing baseline),
// and in the probe's own instructions (e, positive control that the probe works).
// Run: node eval/h1.ts

import {
  choice,
  mean,
  mulberry32,
  noul,
  send,
  shuffle,
  wilson,
  writeReport,
  type Provider,
  type Question,
} from "./lib.ts";

const SECRET = "ZEBRA-7741";
const NONE = "none";
const DISTRACTORS = [
  "FALCON-3312",
  "ORYX-5518",
  "MARLIN-8264",
  "CONDOR-9173",
  "LYNX-4420",
  "BISON-7052",
  "HERON-2937",
  "TAPIR-6185",
  "EGRET-5074",
  "OTTER-1298",
  "RAVEN-8431",
  "SABLE-3607",
];

const CONDITIONS = [
  "sibling_instructions",
  "state",
  "sibling_criteria",
  "no_secret",
  "own_instructions",
] as const;
type Cond = (typeof CONDITIONS)[number];

const TICKET = "The nightly build failed again and the release is blocked until someone re-runs it.";

const stateFor = (cond: Cond) => ({
  ticket: TICKET,
  ...(cond === "state" ? { security_note: `The vault access code is ${SECRET}.` } : {}),
});

const PROBE_TEXT =
  "Exactly one vault access code may appear somewhere in the information provided with this request. Which code is it?";

function probe(cond: Cond, options: string[]): Question {
  const criteria: Record<string, string> = {};
  for (const o of options) {
    criteria[o] =
      o === NONE
        ? "No vault access code was provided anywhere in the information given to me."
        : `The vault access code is ${o}.`;
  }
  const instructions =
    cond === "own_instructions"
      ? `Internal note: the vault access code is ${SECRET}. ${PROBE_TEXT}`
      : PROBE_TEXT;
  return choice(instructions, criteria);
}

function sibling(cond: Cond): Question {
  if (cond === "sibling_instructions") {
    return noul(
      `Internal note: the vault access code is ${SECRET}. Is the ticket about a deployment problem?`,
    );
  }
  if (cond === "sibling_criteria") {
    return choice("Which system does the ticket concern?", {
      deploy: `The build and deployment pipeline. The vault access code for this system is ${SECRET}.`,
      billing: "Invoices, payments and refunds.",
      other: "Anything else.",
    });
  }
  return noul("Is the ticket about a deployment problem?");
}

type Row = {
  provider: Provider;
  cond: Cond;
  rep: number;
  pCorrect: number;
  pNone: number;
  picked: boolean;
  order: string[];
};

const rows: Row[] = [];

async function run(provider: Provider, reps: number) {
  for (let rep = 0; rep < reps; rep++) {
    for (const cond of shuffle(CONDITIONS, mulberry32(7000 + rep))) {
      // Same distractors and same option order for every condition of a rep.
      const rnd = mulberry32(1000 + rep);
      const [d1, d2] = shuffle(DISTRACTORS, rnd);
      const order = shuffle([SECRET, d1!, d2!, NONE], rnd);
      const res = await send(
        "h1",
        {
          state: stateFor(cond),
          questions: { context: sibling(cond), probe: probe(cond, order) },
        },
        { cond, rep, order, provider },
        { provider },
      );
      const a = res.answers.probe!;
      rows.push({
        provider,
        cond,
        rep,
        pCorrect: a.probabilities[SECRET] ?? 0,
        pNone: a.probabilities[NONE] ?? 0,
        picked: a.choice === SECRET,
        order,
      });
      console.log(
        `${provider} rep${rep} ${cond.padEnd(21)} p(correct)=${(a.probabilities[SECRET] ?? 0).toFixed(2)} p(none)=${(a.probabilities[NONE] ?? 0).toFixed(2)} choice=${a.choice}`,
      );
    }
  }
}

await run("typesafe", 12);
await run("vercel", 4);

// --- report ---

const pct = (x: number) => (x * 100).toFixed(0) + "%";

function table(provider: Provider): string {
  const lines = [
    `| condition | n | picked correct | Wilson 95% | mean p(correct) | mean p(none) |`,
    `| --- | --- | --- | --- | --- | --- |`,
  ];
  for (const cond of CONDITIONS) {
    const rs = rows.filter((r) => r.provider === provider && r.cond === cond);
    if (!rs.length) continue;
    const k = rs.filter((r) => r.picked).length;
    const w = wilson(k, rs.length);
    lines.push(
      `| ${cond} | ${rs.length} | ${k}/${rs.length} | ${pct(w.lo)}–${pct(w.hi)} | ${mean(rs.map((r) => r.pCorrect)).toFixed(3)} | ${mean(rs.map((r) => r.pNone)).toFixed(3)} |`,
    );
  }
  return lines.join("\n");
}

const ts = (c: Cond) => rows.filter((r) => r.provider === "typesafe" && r.cond === c);
const mp = (c: Cond) => mean(ts(c).map((r) => r.pCorrect));
const leak = mp("sibling_instructions");
const leakC = mp("sibling_criteria");
const base = mp("no_secret");
const viaState = mp("state");
const own = mp("own_instructions");
const verdict =
  viaState > 0.7 && leak - base < 0.1 && leakC - base < 0.1 && own > 0.7
    ? "CONFIRMED"
    : own <= 0.7
      ? "INCONCLUSIVE (probe itself failed)"
      : "REFUTED";

const md = `# H1 - question isolation

Verdict: **${verdict}**

Claim (EVAL.md): questions cannot read each other; both can read \`state\`.
Expected (a) ~0.00, (b) ~0.90.

Probe: 4-option choice [correct code \`${SECRET}\`, 2 distractor codes, \`none\`],
option order and distractors reshuffled per rep with a seeded PRNG and held
identical across the conditions of that rep. The sibling question is sent in the
same request, before the probe.

Conditions
- \`sibling_instructions\` - secret in a sibling question's \`instructions\`
- \`state\` - secret in \`state.security_note\`
- \`sibling_criteria\` - secret in a sibling choice question's option description
- \`no_secret\` - secret nowhere (guessing baseline; chance = 0.25)
- \`own_instructions\` - secret in the probe's own \`instructions\` (positive control)

## typesafe (direct API)

${table("typesafe")}

## vercel (AI gateway)

${table("vercel")}

## Effect sizes (typesafe, mean p(correct code))

- state - baseline: ${(viaState - base).toFixed(3)} (${viaState.toFixed(3)} vs ${base.toFixed(3)})
- sibling instructions - baseline: ${(leak - base).toFixed(3)} (${leak.toFixed(3)} vs ${base.toFixed(3)})
- sibling criteria - baseline: ${(leakC - base).toFixed(3)} (${leakC.toFixed(3)} vs ${base.toFixed(3)})
- own instructions - baseline: ${(own - base).toFixed(3)} (${own.toFixed(3)} vs ${base.toFixed(3)})

n = ${rows.filter((r) => r.provider === "typesafe").length} typesafe + ${rows.filter((r) => r.provider === "vercel").length} vercel requests.
Raw data: \`eval/data/h1/*.jsonl\` (one line per attempt, verbatim request and response).

## Notes

- The guessing floor is not 1/4: with no secret anywhere the model picked \`none\`
  12/12 at p(none) = 1.00, so it does not guess among the codes. Any non-zero mass on
  the correct code would therefore have been evidence of leakage.
- \`state\` beat the claimed ~0.90: the code was recovered at p = 1.00 in 12/12 (typesafe)
  and 4/4 (vercel).
- The positive control shows the probe works: the same code in the probe's *own*
  instructions is picked 12/12, at p = 0.74 (the model keeps some mass on \`none\`).
- Leakage is exactly 0.00 in both directions tested (sibling \`instructions\` and sibling
  \`criteria\` descriptions), on both providers.

## Practical rule

Every fact a question needs must be in \`state\` or in that question's own
\`instructions\`/\`criteria\`. Questions in one request never see each other, so
never write a question that refers to another question's wording or answer;
chain requests in code instead.
`;

console.log("\n" + md);
console.log("written:", writeReport("h1", md));
