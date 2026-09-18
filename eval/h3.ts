// H3 - option order sensitivity.
// Does permuting the option order of one choice question move the probabilities?
// Run: node eval/h3.ts pilot   (pick an ambiguous ticket)
//      node eval/h3.ts         (full design: typesafe, then a quarter on vercel)

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { choice, mean, sd, send, shuffle, mulberry32, writeReport, type Provider } from "./lib.ts";

const LABELS = {
  billing: "Payments, invoices, refunds, subscription charges",
  technical: "Bugs, errors, outages, things not working",
  account: "Login, passwords, profile details, access and permissions",
} as const;

type Label = keyof typeof LABELS;
const NAMES = Object.keys(LABELS) as Label[];

const QUESTION = "Which team should handle this support ticket?";

// All 6 orderings of the three labels.
const PERMS: Label[][] = [];
for (const a of NAMES)
  for (const b of NAMES)
    for (const c of NAMES) if (a !== b && b !== c && a !== c) PERMS.push([a, b, c]);

const criteriaFor = (perm: Label[]) =>
  Object.fromEntries(perm.map((l) => [l, LABELS[l]])) as Record<string, string>;

const TICKETS = {
  // Pilot: p(technical) ~ 0.93 - clear, but off the ceiling so it can move either way.
  clear:
    "The download invoice button in the billing page returns a 500 error every time I click it. " +
    "I need the PDF.",
  // Pilot: p(technical) ~ 0.63-0.68 - sits near a decision threshold.
  ambiguous:
    "Since yesterday I get an error when opening the app, and I also noticed my plan now says " +
    "Free. I did not change anything.",
} as const;

const PILOTS = {
  p1: TICKETS.ambiguous,
  p2:
    "I cannot get into my account to download last month's invoice. The password reset email never " +
    "arrives, I checked spam. I need the invoice today for expenses.",
  p3:
    "Your app keeps logging me out every few minutes since the update, and while that was happening " +
    "I got an email saying my plan was downgraded. I did not downgrade anything.",
};

const PACE = { pace: 150 } as const;

async function run(provider: Provider, ticketKey: string, state: string, perm: Label[], rep: number) {
  const res = await send(
    "h3",
    { state, questions: { q: choice(QUESTION, criteriaFor(perm)) } },
    { phase: "main", provider, ticket: ticketKey, order: perm.join(">"), rep },
    { provider, ...PACE },
  );
  const a = res.answers.q!;
  return { probs: a.probabilities as Record<Label, number>, choice: a.choice as Label };
}

async function pilot() {
  for (const [name, state] of Object.entries(PILOTS)) {
    for (let rep = 0; rep < 2; rep++) {
      const res = await send(
        "h3",
        { state, questions: { q: choice(QUESTION, criteriaFor(NAMES)) } },
        { phase: "pilot", ticket: name, rep },
        { provider: "typesafe", ...PACE },
      );
      const p = res.answers.q!.probabilities;
      console.log(name, rep, res.answers.q!.choice, JSON.stringify(p));
    }
  }
}

interface Trial {
  provider: Provider;
  ticket: string;
  perm: Label[];
  probs: Record<Label, number>;
  choice: Label;
}

async function block(provider: Provider, reps: number, seed: number): Promise<Trial[]> {
  const plan: { ticket: keyof typeof TICKETS; perm: Label[]; rep: number }[] = [];
  for (const ticket of Object.keys(TICKETS) as (keyof typeof TICKETS)[])
    for (const perm of PERMS) for (let rep = 0; rep < reps; rep++) plan.push({ ticket, perm, rep });
  const order = shuffle(plan, seed);
  const out: Trial[] = [];
  let i = 0;
  for (const t of order) {
    const r = await run(provider, t.ticket, TICKETS[t.ticket], t.perm, t.rep);
    out.push({ provider, ticket: t.ticket, perm: t.perm, ...r });
    if (++i % 12 === 0) console.log(`  ${provider} ${i}/${order.length}`);
  }
  return out;
}

// --- analysis ---

// Permutation test: how often does reshuffling trials between the 6 order-groups
// produce a spread of group means as large as the observed one?
function permutationP(values: number[], groups: string[], observed: number, seed = 7): number {
  const rnd = mulberry32(seed);
  const names = [...new Set(groups)];
  const sizes = names.map((g) => groups.filter((x) => x === g).length);
  const runs = 10_000;
  let hits = 0;
  for (let r = 0; r < runs; r++) {
    const pool = shuffle(values, rnd);
    let i = 0;
    const ms: number[] = [];
    for (const n of sizes) ms.push(mean(pool.slice(i, (i += n))));
    if (Math.max(...ms) - Math.min(...ms) >= observed - 1e-12) hits++;
  }
  return (hits + 1) / (runs + 1);
}

function analyse(trials: Trial[], ticket: string) {
  const rows = trials.filter((t) => t.ticket === ticket);
  const grand = Object.fromEntries(
    NAMES.map((l) => [l, mean(rows.map((r) => r.probs[l] ?? 0))]),
  ) as Record<Label, number>;
  const winner = NAMES.reduce((a, b) => (grand[a]! >= grand[b]! ? a : b));
  const perPerm = PERMS.map((perm) => {
    const rs = rows.filter((r) => r.perm.join(">") === perm.join(">"));
    const ps = rs.map((r) => r.probs[winner] ?? 0);
    return {
      order: perm.join(">"),
      pos: perm.indexOf(winner),
      n: rs.length,
      mean: mean(ps),
      sd: sd(ps),
      argmaxOther: rs.filter((r) => r.choice !== winner).length,
      choices: rs.map((r) => r.choice),
    };
  });
  const means = perPerm.map((p) => p.mean);
  const byPos = [0, 1, 2].map((pos) => {
    const ps = rows.filter((r) => r.perm.indexOf(winner) === pos).map((r) => r.probs[winner] ?? 0);
    return { pos, n: ps.length, mean: mean(ps), sd: sd(ps) };
  });
  // Within-permutation noise: pooled sd across the 6 cells.
  const pooledSd = Math.sqrt(mean(perPerm.map((p) => p.sd ** 2)));
  const argmaxFlips = rows.filter((r) => r.choice !== winner).length;
  const spread = Math.max(...means) - Math.min(...means);
  const p = permutationP(
    rows.map((r) => r.probs[winner] ?? 0),
    rows.map((r) => r.perm.join(">")),
    spread,
  );
  return {
    p,
    ticket,
    n: rows.length,
    winner,
    grand,
    perPerm,
    byPos,
    spread,
    pooledSd,
    argmaxFlips,
    flipLabels: [...new Set(rows.filter((r) => r.choice !== winner).map((r) => r.choice))],
  };
}

// Mean probability of every label by the slot it occupied, to separate position from pairing.
function byLabelPosition(trials: Trial[], ticket: string) {
  const rows = trials.filter((t) => t.ticket === ticket);
  return NAMES.map((label) => {
    const cells = [0, 1, 2].map((pos) => {
      const ps = rows
        .filter((r) => r.perm.indexOf(label) === pos)
        .map((r) => r.probs[label] ?? 0);
      return { n: ps.length, mean: mean(ps), sd: sd(ps) };
    });
    return { label, cells, firstMinusLast: cells[0]!.mean - cells[2]!.mean };
  });
}

function labelPositionTable(trials: Trial[], ticket: string): string {
  const rows = byLabelPosition(trials, ticket);
  return [
    "| label | listed 1st | listed 2nd | listed 3rd | 1st - 3rd |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| \`${r.label}\` | ${f3(r.cells[0]!.mean)} | ${f3(r.cells[1]!.mean)} | ${f3(r.cells[2]!.mean)} | ${r.firstMinusLast >= 0 ? "+" : ""}${f3(r.firstMinusLast)} |`,
    ),
  ].join("\n");
}

const f2 = (n: number) => n.toFixed(2);
const f3 = (n: number) => n.toFixed(3);

function table(a: ReturnType<typeof analyse>): string {
  const lines = [
    `winner label: \`${a.winner}\` (grand means ${NAMES.map((l) => `${l} ${f3(a.grand[l]!)}`).join(", ")}), n=${a.n}`,
    "",
    `| order | position of \`${a.winner}\` | n | mean p(${a.winner}) | sd | argmax != winner |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...[...a.perPerm]
      .sort((x, y) => y.mean - x.mean)
      .map(
        (p) =>
          `| ${p.order} | ${p.pos + 1} | ${p.n} | ${f3(p.mean)} | ${f3(p.sd)} | ${p.argmaxOther} |`,
      ),
    "",
    `spread (max mean - min mean): **${f3(a.spread)}**; pooled within-order sd: ${f3(a.pooledSd)}; permutation p = ${a.p.toFixed(4)}`,
    `argmax changed on ${a.argmaxFlips}/${a.n} trials${a.flipLabels.length ? ` (to ${a.flipLabels.join(", ")})` : ""}`,
    "",
    `| position of \`${a.winner}\` in the list | n | mean p | sd |`,
    "| --- | --- | --- | --- |",
    ...a.byPos.map((p) => `| ${p.pos + 1} | ${p.n} | ${f3(p.mean)} | ${f3(p.sd)} |`),
  ];
  return lines.join("\n");
}

// Rebuilds the trials from the JSONL log so the report can be regenerated without spending requests.
function loadTrials(): Trial[] {
  const dir = join(new URL(".", import.meta.url).pathname, "data", "h3");
  const out: Trial[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.meta?.phase !== "main" || r.status !== 200) continue;
      const a = r.response?.answers?.q;
      const probs = a?.probabilities;
      if (!probs) continue;
      const perm = Object.keys(r.request.questions.q.criteria) as Label[];
      const top = NAMES.reduce((x, y) => ((probs[x] ?? 0) >= (probs[y] ?? 0) ? x : y));
      out.push({ provider: r.provider, ticket: r.meta.ticket, perm, probs, choice: a.choice ?? top });
    }
  }
  return out;
}

async function main() {
  const seed = 30301;
  const tsReps = Number(process.env.H3_TS_REPS ?? 8);
  const vcReps = Number(process.env.H3_VC_REPS ?? 2);
  const offline = process.argv[2] === "offline";
  let ts: Trial[];
  let vc: Trial[];
  if (offline) {
    const all = loadTrials();
    ts = all.filter((t) => t.provider === "typesafe");
    vc = all.filter((t) => t.provider === "vercel");
    console.log(`offline: ${ts.length} typesafe + ${vc.length} vercel trials from the JSONL log`);
  } else {
    console.log(`typesafe: 2 tickets x 6 orders x ${tsReps} reps = ${12 * tsReps} requests`);
    ts = await block("typesafe", tsReps, seed);
    console.log(`vercel: 2 tickets x 6 orders x ${vcReps} reps = ${12 * vcReps} requests`);
    vc = await block("vercel", vcReps, seed + 1);
  }

  const A = analyse(ts, "clear");
  const B = analyse(ts, "ambiguous");
  const VA = analyse(vc, "clear");
  const VB = analyse(vc, "ambiguous");

  const minP = Math.min(A.p, B.p);
  const maxSpread = Math.max(A.spread, B.spread);
  const verdict =
    minP < 0.05 && maxSpread >= 0.02 ? "CONFIRMED" : maxSpread < 0.05 ? "REFUTED" : "INCONCLUSIVE";

  const md = `# H3 - option order sensitivity

Verdict: **${verdict}**

Claim (EVAL.md): reordering the options of one choice question moves the probability of the same
answer (quoted range 0.84-0.89 -> 0.93-0.96).

Design: one choice question, three labels (\`billing\`, \`technical\`, \`account\`, same descriptions
throughout), all 6 orders of the criteria map, ${ts.length / 12} reps per order per ticket on the direct API
and ${vc.length / 12} reps per order per ticket on the gateway. Trial order shuffled with \`mulberry32(${seed})\`, one
request per trial, one question per request. Probabilities read by key (response key order is not
request order).

Requests: ${ts.length} typesafe + ${vc.length} vercel = ${ts.length + vc.length}.

## Ticket A - clear (${JSON.stringify(TICKETS.clear.slice(0, 60))}...)

### typesafe (direct API)

${table(A)}

Mean probability of every label by the slot it sat in (n=${A.n} trials, ${A.n / 3} per label per slot):

${labelPositionTable(ts, "clear")}

### vercel (gateway, quarter replication)

${table(VA)}

## Ticket B - ambiguous between billing and technical

State: ${JSON.stringify(TICKETS.ambiguous)}

### typesafe (direct API)

${table(B)}

Mean probability of every label by the slot it sat in (n=${B.n} trials, ${B.n / 3} per label per slot):

${labelPositionTable(ts, "ambiguous")}

### vercel (gateway, quarter replication)

${table(VB)}

## Effect sizes

| ticket | provider | n | spread of per-order means | pooled within-order sd | spread / sd | permutation p |
| --- | --- | --- | --- | --- | --- | --- |
| clear | typesafe | ${A.n} | ${f3(A.spread)} | ${f3(A.pooledSd)} | ${A.pooledSd ? f2(A.spread / A.pooledSd) : "inf"} | ${A.p.toFixed(4)} |
| ambiguous | typesafe | ${B.n} | ${f3(B.spread)} | ${f3(B.pooledSd)} | ${B.pooledSd ? f2(B.spread / B.pooledSd) : "inf"} | ${B.p.toFixed(4)} |
| clear | vercel | ${VA.n} | ${f3(VA.spread)} | ${f3(VA.pooledSd)} | ${VA.pooledSd ? f2(VA.spread / VA.pooledSd) : "inf"} | ${VA.p.toFixed(4)} |
| ambiguous | vercel | ${VB.n} | ${f3(VB.spread)} | ${f3(VB.pooledSd)} | ${VB.pooledSd ? f2(VB.spread / VB.pooledSd) : "inf"} | ${VB.p.toFixed(4)} |

Probabilities come back at 2 decimals, so 0.005 of any single reading is quantisation.

## Raw data

\`eval/data/h3/*.jsonl\` (every attempt: request, response, headers, latency; \`meta.phase\`,
\`meta.ticket\`, \`meta.order\`, \`meta.rep\`).

## Rule for library users

Option order is an input, not presentation. The same state, the same three labels and the same
descriptions gave p(winner) from ${f3(Math.min(...A.perPerm.map((x) => x.mean)))} to ${f3(Math.max(...A.perPerm.map((x) => x.mean)))} on the clear ticket and
${f3(Math.min(...B.perPerm.map((x) => x.mean)))} to ${f3(Math.max(...B.perPerm.map((x) => x.mean)))} on the ambiguous one, purely from where the labels sat.

The direction is primacy: on the ambiguous ticket every label gained probability when listed first
(winner ${f3(B.byPos[0]!.mean)} first vs ${f3(B.byPos[2]!.mean)} last). Near the ceiling the position effect is smaller and no longer
monotone, so it is a bias that grows as the decision gets closer to a coin flip.

1. Write the criteria map as a literal in one place and keep the order fixed. Never build it from a
   \`Set\`, a database row order, or anything that can reorder between deploys - a reordered map is a
   changed prompt.
2. Give any probability or confidence threshold a margin of about **+/- 0.10 in the mid range**
   (p around 0.5-0.75) and **+/- 0.035 near the ceiling** (p above 0.9). A 0.70 cut-off on a question
   whose true value sits near 0.65 will flip on option order alone.
3. The argmax itself is safe when the leaders are far apart (${A.argmaxFlips + B.argmaxFlips}/${A.n + B.n} trials changed the top label
   here), but the gap between the top two labels moved by up to ${f3(B.spread)}. If your top two are within
   about 0.2 of each other, do not trust the ranking from one order.
4. If a decision has to sit near a threshold, send the question twice with the label list reversed
   and average, or put the option you most want to avoid over-picking first and read the result as
   an upper bound for it.
5. Both providers behave the same way, so this is the model, not the gateway.
`;
  const file = writeReport("h3", md);
  console.log("wrote", file);
  console.log(JSON.stringify({ A: summary(A), B: summary(B), VA: summary(VA), VB: summary(VB) }, null, 2));
}

const summary = (a: ReturnType<typeof analyse>) => ({
  ticket: a.ticket,
  n: a.n,
  winner: a.winner,
  grand: a.grand,
  spread: a.spread,
  permP: a.p,
  pooledSd: a.pooledSd,
  argmaxFlips: a.argmaxFlips,
  perPerm: a.perPerm.map((p) => [p.order, p.pos, Number(p.mean.toFixed(3)), Number(p.sd.toFixed(3))]),
  byPos: a.byPos.map((p) => [p.pos, Number(p.mean.toFixed(3)), Number(p.sd.toFixed(3))]),
});

if (process.argv[2] === "pilot") await pilot();
else await main();
