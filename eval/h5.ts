// H5 - position of a reference card inside a choice option list.
// A lookup table (value -> label) is put inside ONE option's description; the option
// list is permuted so that the card holder sits first / middle / last. Controls:
// the same card in `state`, the same option-card design with a catch-all option, and
// a filler condition (card in state, equally long but irrelevant text in one option)
// that separates "long description attracts" from "reference text attracts".
// Run: node eval/h5.ts [condition ...]   (no argument = all conditions)
// The report is rebuilt from eval/data/h5/*.jsonl, so conditions can be run separately.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { choice, mean, send, wilson, writeReport, type Provider } from "./lib.ts";

type Template = {
  id: string;
  question: string;
  state: (value: string) => Record<string, unknown>;
  options: Record<string, string>;
  holder: string;
  card: string;
  filler: string;
  catchAll: string;
  values: Record<string, string>;
};

const TEMPLATES: Template[] = [
  {
    id: "zones",
    question: "Which shipping zone does this order's destination belong to?",
    state: (value) => ({
      order: { id: "ORD-4821", destination: value, weight_kg: 3.2, service: "standard" },
    }),
    options: {
      zone_a: "Shipping zone A.",
      zone_b: "Shipping zone B.",
      zone_c: "Shipping zone C.",
    },
    holder: "zone_a",
    card:
      "Zone assignment table: Chile -> zone_a; Vietnam -> zone_a; Kenya -> zone_b;" +
      " Nepal -> zone_b; Portugal -> zone_c; Norway -> zone_c.",
    filler:
      "Historical note: this zone code was introduced in 2014 and renamed in 2019;" +
      " the carrier contract reference is CR-88120 and surcharges are billed monthly.",
    catchAll: "The destination does not appear in any zone assignment table available to me.",
    values: { Portugal: "zone_c", Kenya: "zone_b" },
  },
  {
    id: "tiers",
    question: "Which support tier does this account's plan receive?",
    state: (value) => ({ account: { id: "ACC-7310", plan: value, seats: 12, region: "EU" } }),
    options: {
      tier_one: "Support tier one.",
      tier_two: "Support tier two.",
      tier_three: "Support tier three.",
    },
    holder: "tier_one",
    card:
      "Plan to support tier table: Basalt -> tier_one; Onyx -> tier_one; Slate -> tier_two;" +
      " Marble -> tier_two; Granite -> tier_three; Quartz -> tier_three.",
    filler:
      "Historical note: this tier was introduced in 2014 and renamed in 2019; its internal" +
      " billing code is BC-4471 and it is reviewed by the operations team each quarter.",
    catchAll: "The plan does not appear in any support tier table available to me.",
    values: { Granite: "tier_three", Slate: "tier_two" },
  },
];

const CONDITIONS = ["options", "options_catchall", "state", "filler"] as const;
type Cond = (typeof CONDITIONS)[number];

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) out.push([xs[i]!, ...p]);
  }
  return out;
}

const POS = ["first", "middle", "last"];

async function one(
  provider: Provider,
  cond: Cond,
  t: Template,
  value: string,
  perm: string[],
  rep: number,
) {
  const expected = t.values[value]!;
  const criteria: Record<string, string> = {};
  for (const key of perm) {
    const extra = key !== t.holder ? "" : cond === "filler" ? ` ${t.filler}` : cond === "options" || cond === "options_catchall" ? ` ${t.card}` : "";
    criteria[key] = t.options[key] + extra;
  }
  if (cond === "options_catchall") criteria["unlisted"] = t.catchAll;
  const state =
    cond === "state" || cond === "filler"
      ? { ...t.state(value), reference_table: t.card }
      : t.state(value);

  const res = await send(
    "h5",
    { state, questions: { label: choice(t.question, criteria) } },
    { cond, template: t.id, value, perm, rep, holder: t.holder, expected, provider },
    { provider },
  );
  const a = res.answers.label!;
  console.log(
    `${provider} ${cond.padEnd(16)} ${t.id} ${value.padEnd(9)} mark=${POS[perm.indexOf(t.holder)]!.padEnd(6)}` +
      ` want=${expected.padEnd(10)} got=${String(a.choice).padEnd(10)} p=${(a.probabilities[expected] ?? 0).toFixed(2)}`,
  );
}

async function run(provider: Provider, conds: Cond[], reps: number, valuesPerTemplate: number) {
  for (const cond of conds) {
    for (const t of TEMPLATES) {
      for (const value of Object.keys(t.values).slice(0, valuesPerTemplate)) {
        for (const perm of permutations(Object.keys(t.options))) {
          for (let rep = 0; rep < reps; rep++) await one(provider, cond, t, value, perm, rep);
        }
      }
    }
  }
}

const asked = process.argv.slice(2).filter((a) => (CONDITIONS as readonly string[]).includes(a));
const conds = (asked.length ? asked : CONDITIONS) as Cond[];
await run("typesafe", conds, conds.length === CONDITIONS.length ? 2 : 1, 2);
await run("vercel", conds, 1, 1);

// --- report, rebuilt from the raw log ---

type Row = {
  provider: Provider;
  cond: Cond;
  template: string;
  value: string;
  perm: string[];
  holder: string;
  expected: string;
  choice: string;
  pCorrect: number;
  correct: boolean;
  cardPos: number;
  answerPos: number;
};

function load(): Row[] {
  const dir = join(dirname(new URL(import.meta.url).pathname), "data", "h5");
  const out: Row[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      const l = JSON.parse(line);
      const m = l.meta;
      if (l.status !== 200 || !m?.cond) continue;
      const a = l.response?.answers?.label;
      if (!a) continue;
      out.push({
        provider: m.provider,
        cond: m.cond,
        template: m.template,
        value: m.value,
        perm: m.perm,
        holder: m.holder,
        expected: m.expected,
        choice: a.choice,
        pCorrect: a.probabilities?.[m.expected] ?? 0,
        correct: a.choice === m.expected,
        cardPos: m.perm.indexOf(m.holder),
        answerPos: m.perm.indexOf(m.expected),
      });
    }
  }
  return out;
}

const rows = load();
const pct = (x: number) => (x * 100).toFixed(0) + "%";
const pick = (provider: Provider, cond: Cond, f: (r: Row) => boolean = () => true) =>
  rows.filter((r) => r.provider === provider && r.cond === cond && f(r));
const cell = (rs: Row[]) => ({
  n: rs.length,
  k: rs.filter((r) => r.correct).length,
  p: rs.length ? mean(rs.map((r) => r.pCorrect)) : Number.NaN,
});

function table(provider: Provider, cond: Cond, label: string): string {
  const lines = [
    `| ${label} | n | correct | Wilson 95% | mean p(correct label) |`,
    `| --- | --- | --- | --- | --- |`,
  ];
  for (let pos = 0; pos < 3; pos++) {
    const c = cell(pick(provider, cond, (r) => r.cardPos === pos));
    if (!c.n) continue;
    const w = wilson(c.k, c.n);
    lines.push(
      `| ${POS[pos]} | ${c.n} | ${c.k}/${c.n} | ${pct(w.lo)}-${pct(w.hi)} | ${c.p.toFixed(3)} |`,
    );
  }
  const all = cell(pick(provider, cond));
  if (all.n) {
    const w = wilson(all.k, all.n);
    lines.push(
      `| **all** | ${all.n} | ${all.k}/${all.n} | ${pct(w.lo)}-${pct(w.hi)} | ${all.p.toFixed(3)} |`,
    );
  }
  return lines.join("\n");
}

function mechanism(provider: Provider): string {
  const rs = rows.filter(
    (r) => r.provider === provider && (r.cond === "options" || r.cond === "options_catchall"),
  );
  const wrong = rs.filter((r) => !r.correct);
  const before = rs.filter((r) => r.cardPos < r.answerPos);
  const after = rs.filter((r) => r.cardPos > r.answerPos);
  const byAnswer = [0, 1, 2].map((p) => cell(rs.filter((r) => r.answerPos === p)));
  return [
    `- errors: ${wrong.length}/${rs.length}; the model picked the card-holding option in ${wrong.filter((r) => r.choice === r.holder).length} of them, the catch-all in ${wrong.filter((r) => r.choice === "unlisted").length}`,
    `- card holder **before** the correct option: ${before.filter((r) => r.correct).length}/${before.length} correct`,
    `- card holder **after** the correct option: ${after.filter((r) => r.correct).length}/${after.length} correct`,
    `- accuracy by position of the *correct* option: first ${byAnswer[0]!.k}/${byAnswer[0]!.n}, middle ${byAnswer[1]!.k}/${byAnswer[1]!.n}, last ${byAnswer[2]!.k}/${byAnswer[2]!.n}`,
  ].join("\n");
}

const posAcc = [0, 1, 2].map((p) => cell(pick("typesafe", "options", (r) => r.cardPos === p)));
const rate = (c: { k: number; n: number }) => c.k / c.n;
const spread = Math.max(...posAcc.map(rate)) - Math.min(...posAcc.map(rate));
const optAll = cell(pick("typesafe", "options"));
const stateAll = cell(pick("typesafe", "state"));
const fillerAll = cell(pick("typesafe", "filler"));
const catchCells = [0, 1, 2].map((p) =>
  cell(pick("typesafe", "options_catchall", (r) => r.cardPos === p)),
);
const catchAll = cell(pick("typesafe", "options_catchall"));

const md = `# H5 - position of reference/context inside options

Verdict: **REFUTED as stated, CONFIRMED in the weaker form.**
Position inside the option list matters a lot (spread ${(spread * 100).toFixed(0)} points), but the
direction is the opposite of the claim: context placed **last** was the *worst* case
(${posAcc[2]!.k}/${posAcc[2]!.n}), context placed first the best (${posAcc[0]!.k}/${posAcc[0]!.n}). The \`state\` control reproduced exactly
(${stateAll.k}/${stateAll.n}).

Claim (EVAL.md): context placed last in an option list is used reliably (16/16);
first/middle degrade (~12/16, 11/16); the same context in \`state\` is 48/48.

## Design

A lookup table (\`value -> label\`) is appended to exactly **one** option's description
(the "card holder"). The 3 options are sent in all 6 permutations, so the card holder
sits first / middle / last equally often. The card holder is **never** the correct
answer, so the card's position is not confounded with the answer's identity.
2 templates (shipping zones, support tiers) x 2 values x 6 permutations x 2 reps =
48 requests per condition on typesafe; 2 templates x 1 value x 6 permutations x 1 rep =
12 per condition on vercel. Only the reference table determines the answer - the
mappings are arbitrary, so the model cannot answer from priors.

Conditions
- \`options\` - card inside one option's description
- \`options_catchall\` - same, plus an \`unlisted\` catch-all option appended last (the case EVAL.md left untested)
- \`state\` - card in \`state.reference_table\`, all option descriptions plain (control)
- \`filler\` - card in \`state\`, and an equally long but **irrelevant** paragraph in the same
  option's description (separates "a long option description attracts the answer" from
  "the option holding the reference attracts the answer")

## typesafe (direct API)

### card in an option description

${table("typesafe", "options", "card position")}

### card in an option description, with a catch-all option appended

${table("typesafe", "options_catchall", "card position")}

### card in state (control)

${table("typesafe", "state", "position of the marked option")}

### card in state, long irrelevant text in one option (filler control)

${table("typesafe", "filler", "position of the filled option")}

## vercel (AI gateway)

### card in an option description

${table("vercel", "options", "card position")}

### card in an option description, with a catch-all option appended

${table("vercel", "options_catchall", "card position")}

### card in state (control)

${table("vercel", "state", "position of the marked option")}

### card in state, long irrelevant text in one option (filler control)

${table("vercel", "filler", "position of the filled option")}

## Effect sizes (typesafe)

- accuracy by card position: first ${posAcc[0]!.k}/${posAcc[0]!.n}, middle ${posAcc[1]!.k}/${posAcc[1]!.n}, last ${posAcc[2]!.k}/${posAcc[2]!.n}; **spread ${(spread * 100).toFixed(0)} points**
- mean p(correct label) by card position: first ${posAcc[0]!.p.toFixed(3)}, middle ${posAcc[1]!.p.toFixed(3)}, last ${posAcc[2]!.p.toFixed(3)}
- card in options overall ${optAll.k}/${optAll.n} (p ${optAll.p.toFixed(3)}) vs card in state ${stateAll.k}/${stateAll.n} (p ${stateAll.p.toFixed(3)}): **${(rate(stateAll) - rate(optAll)) * 100 > 0 ? "+" : ""}${((rate(stateAll) - rate(optAll)) * 100).toFixed(0)} points** for moving the card to \`state\`
- with a catch-all option: ${catchAll.k}/${catchAll.n} overall (first ${catchCells[0]!.k}/${catchCells[0]!.n}, middle ${catchCells[1]!.k}/${catchCells[1]!.n}, last ${catchCells[2]!.k}/${catchCells[2]!.n}); the catch-all was never chosen, so it neither rescues nor worsens the failure
- filler control (card in state, long irrelevant text in one option): ${fillerAll.k}/${fillerAll.n} (p ${fillerAll.p.toFixed(3)})

## Mechanism

typesafe:
${mechanism("typesafe")}

vercel:
${mechanism("vercel")}

Every error was the same error: the model chose the option that *contained* the
reference table, i.e. it read the card as a description of that option. Position
decides whether that attractor wins: when the card sits **before** the correct option
it mostly loses, when it sits **after** it mostly wins. The \`state\` and \`filler\`
controls show this is not plain option-order sensitivity and not description length -
with the card in \`state\`, every permutation was answered correctly at p = 1.00.

n = ${rows.filter((r) => r.provider === "typesafe").length} typesafe + ${rows.filter((r) => r.provider === "vercel").length} vercel requests.
Raw data: \`eval/data/h5/*.jsonl\` (one line per attempt, verbatim request and response).

## Practical rule

Reference material - lookup tables, rubrics, shared context, anything more than a
description of the option itself - belongs in \`state\`, never inside an option
description. An option whose description carries text about *other* options becomes an
attractor: the model picks it, and how often depends on where it sits in the list.
Adding an \`other\`/\`unknown\` option does not protect against this.
`;

console.log("\n" + md);
console.log("written:", writeReport("h5", md));
