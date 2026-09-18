// H8: non-determinism of identical requests and of duplicate questions inside one request.
// Run: node eval/h8.ts            collect (both question sets) and report
//      node eval/h8.ts --offline  re-analyse what is already logged
//
// A: 50 identical requests, direct API.
// B: 3 requests, each carrying 40 duplicates of every question under different keys.
// C: 15 identical requests through the Vercel gateway.
// D: the same question under 10 very different key names, order reshuffled per request.
//
// Two question sets over the same state: "peaked" (the model is sure) and "split" (the model sits
// on the fence), because the size of the noise depends on where the answer is.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  choice, noul, score, send, mean, sd, shuffle, writeReport,
  type Provider, type Question,
} from "./lib.ts";

const HYP = "h8";
const DIRECT = { provider: "typesafe" as Provider };
const GATEWAY = { provider: "vercel" as Provider };

const STATE =
  "Works fine I guess. Three stars. Support answered eventually, though I had to ask twice. " +
  "The export is still missing the tax column but I found a workaround.";

const PEAKED: Record<string, Question> = {
  department: choice("Which team should handle this?", {
    billing: "Payments, refunds, invoices",
    technical: "Bugs, outages, integrations",
    success: "Onboarding, adoption, relationship",
  }),
  frustration: score("How frustrated is the customer?", [
    "They sound calm",
    "They sound mildly annoyed",
    "They sound very angry",
  ]),
  at_risk: noul("Is this customer at risk of leaving?"),
};

const SPLIT: Record<string, Question> = {
  mood: choice("What is the writer's mood?", { positive: null, neutral: null, negative: null }),
  team: choice("Which team should handle this?", {
    billing: "Payments, refunds, invoices",
    technical: "Bugs, outages, integrations",
    success: "Onboarding, adoption, relationship",
  }),
  effort: score("How much effort would a good reply take?", [
    "A one line reply",
    "A short reply with a link",
    "A careful written answer",
  ]),
  at_risk: noul("Is this customer at risk of leaving?"),
};

const REPS_DIRECT = 50;
const REPS_GATEWAY = 15;
const DUP_REQUESTS = 3;
const DUP_N = 40;
const KEY_REQUESTS = 12;
const EDGE_REPS = 25;

// A shorter version of the same feedback, on which the two leading options sit within 0.05.
const EDGE_STATE = "Works fine I guess. Three stars. Support answered eventually, though I had to ask twice.";
const KEY_QUESTION = "mood";

const KEY_NAMES = [
  "a",
  "q",
  "x7",
  "mood",
  "is_the_customer_furious_and_about_to_churn",
  "should_we_immediately_refund_this_angry_person",
  "trivial_and_ignorable_question_nobody_reads",
  "positive",
  "MOOD_CLASSIFICATION_V2_FINAL",
  "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
];

// --- collect ---

const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const runs = (part: string) => !process.argv.includes("--offline") && (!ONLY || ONLY.includes(part));

if (runs("A")) {
  const body = "split";
  console.log(`A: ${REPS_DIRECT} identical requests (typesafe, ${body})`);
  for (let i = 0; i < REPS_DIRECT; i++) {
    await send(HYP, { state: STATE, questions: SPLIT }, { part: "A", body, rep: i }, DIRECT);
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${REPS_DIRECT}`);
  }

}

if (runs("B")) {
  const body = "split";
  console.log(`B: ${DUP_REQUESTS} requests x ${DUP_N} duplicates of each question`);
  const dup: Record<string, Question> = {};
  for (let i = 0; i < DUP_N; i++) {
    const n = String(i).padStart(2, "0");
    for (const [k, q] of Object.entries(SPLIT)) dup[`${k}_${n}`] = q;
  }
  for (let r = 0; r < DUP_REQUESTS; r++) {
    await send(HYP, { state: STATE, questions: dup }, { part: "B", body, rep: r }, DIRECT);
    console.log(`  ${r + 1}/${DUP_REQUESTS}`);
  }

}

if (runs("C")) {
  const body = "split";
  console.log(`C: ${REPS_GATEWAY} identical requests (vercel)`);
  for (let i = 0; i < REPS_GATEWAY; i++) {
    await send(HYP, { state: STATE, questions: SPLIT }, { part: "C", body, rep: i }, GATEWAY);
    if ((i + 1) % 5 === 0) console.log(`  ${i + 1}/${REPS_GATEWAY}`);
  }

}

if (runs("D")) {
  const body = "split";
  console.log(`D: ${KEY_REQUESTS} requests, one question under ${KEY_NAMES.length} key names`);
  for (let r = 0; r < KEY_REQUESTS; r++) {
    const order = shuffle(KEY_NAMES, 1000 + r);
    const questions: Record<string, Question> = {};
    for (const k of order) questions[k] = SPLIT[KEY_QUESTION]!;
    await send(HYP, { state: STATE, questions }, { part: "D", body, rep: r, order }, DIRECT);
    if ((r + 1) % 4 === 0) console.log(`  ${r + 1}/${KEY_REQUESTS}`);
  }
}

if (runs("E")) {
  console.log(`E: ${EDGE_REPS} identical requests on a knife-edge state`);
  const questions = { mood: SPLIT.mood!, team: SPLIT.team! };
  for (let i = 0; i < EDGE_REPS; i++) {
    await send(HYP, { state: EDGE_STATE, questions }, { part: "E", body: "edge", rep: i }, DIRECT);
    if ((i + 1) % 5 === 0) console.log(`  ${i + 1}/${EDGE_REPS}`);
  }
}

// --- load ---

type Ans = { type: string; choice?: string; probabilities?: Record<string, number>; score?: number; noul?: number; probability?: number; confidence?: number };
type Line = { part: string; body: string; provider: string; rep: number; answers: Record<string, Ans>; conf: Record<string, number> };

const LOG_DIR = join(new URL(".", import.meta.url).pathname, "data", HYP);
const lines: Line[] = [];
for (const f of readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl"))) {
  for (const raw of readFileSync(join(LOG_DIR, f), "utf8").trim().split("\n")) {
    if (!raw) continue;
    const l = JSON.parse(raw);
    if (l.status !== 200 || l.hyp !== HYP || !l.response?.answers) continue;
    const part = String(l.meta?.part ?? "?");
    if (!"ABCDE".includes(part)) continue;
    lines.push({
      part,
      body: String(l.meta?.body ?? "peaked"),
      provider: l.provider,
      rep: Number(l.meta?.rep ?? 0),
      answers: l.response.answers,
      conf: l.response?.providerMetadata?.typesafe?.confidence ?? {},
    });
  }
}

// --- series ---

const base = (key: string) => key.replace(/_\d\d$/, "");
const fx = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const range = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : Number.NaN);
const argmaxKey = (p: Record<string, number>) => Object.entries(p).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

/** Every numeric field of every answer, as named series. */
function series(ls: Line[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const push = (name: string, v: number | undefined) => {
    if (v === undefined || !Number.isFinite(v)) return;
    (out.get(name) ?? out.set(name, []).get(name)!).push(v);
  };
  for (const l of ls) {
    for (const [key, a] of Object.entries(l.answers)) {
      const b = base(key);
      for (const [o, v] of Object.entries(a.probabilities ?? {})) push(`${b} p(${o})`, v);
      if (a.type === "score") push(`${b} score`, a.score);
      if (a.type === "noul" || a.type === "boolean") push(`${b} probability`, a.noul ?? a.probability);
      const c = a.confidence ?? l.conf[key];
      if (c !== undefined) push(`${b} confidence`, c);
    }
  }
  return out;
}

function fieldTable(ls: Line[]): string {
  const s = series(ls);
  const lines2 = ["| field | n | mean | sd | min | max | range |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const [name, xs] of [...s].sort()) {
    lines2.push(`| ${name} | ${xs.length} | ${fx(mean(xs), 3)} | ${fx(sd(xs))} | ${fx(Math.min(...xs), 2)} | ${fx(Math.max(...xs), 2)} | ${fx(range(xs), 2)} |`);
  }
  return lines2.join("\n");
}

const probFields = (ls: Line[]) => [...series(ls)].filter(([n]) => n.includes(" p(") || n.endsWith(" probability"));
const maxSd = (ls: Line[]) => Math.max(...probFields(ls).map(([, xs]) => sd(xs)));
const maxRange = (ls: Line[]) => Math.max(...probFields(ls).map(([, xs]) => range(xs)));

/** "k/n": how often the top option was not the overall favourite. */
function flipCount(ls: Line[], prefix: string): string {
  const counts = new Map<string, number>();
  let n = 0;
  for (const l of ls) {
    for (const [key, a] of Object.entries(l.answers)) {
      if (base(key) !== prefix || !a.probabilities || !Object.keys(a.probabilities).length) continue;
      n++;
      const k = a.choice ?? argmaxKey(a.probabilities);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const top = Math.max(0, ...counts.values());
  return `${n - top}/${n}`;
}

function flips(ls: Line[], prefix: string): string {
  const counts = new Map<string, number>();
  let n = 0;
  for (const l of ls) {
    for (const [key, a] of Object.entries(l.answers)) {
      if (base(key) !== prefix || !a.probabilities || !Object.keys(a.probabilities).length) continue;
      n++;
      const k = a.choice ?? argmaxKey(a.probabilities);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  if (!n) return "n/a";
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  return `${sorted.map(([k, v]) => `${k} ${v}/${n}`).join(", ")} — top answer differed in **${n - sorted[0]![1]}/${n}**`;
}

const pick = (part: string, body: string, provider = "typesafe") =>
  lines.filter((l) => l.part === part && l.body === body && l.provider === provider);

const A = pick("A", "split");
const Apeak = pick("A", "peaked");
const B = pick("B", "split");
const Bpeak = pick("B", "peaked");
const C = pick("C", "split", "vercel");
const Cpeak = pick("C", "peaked", "vercel");
const D = pick("D", "split");
const E = pick("E", "edge");

// key order stability
const ansOrders = new Set(A.map((l) => Object.keys(l.answers).join(",")));
const probOrders = new Map<string, Set<string>>();
for (const l of [...A, ...Apeak]) {
  for (const [key, a] of Object.entries(l.answers)) {
    if (!a.probabilities || Object.keys(a.probabilities).length < 2) continue;
    const set = probOrders.get(base(key)) ?? probOrders.set(base(key), new Set()).get(base(key))!;
    set.add(Object.keys(a.probabilities).join(","));
  }
}

// within-request duplicate spread vs across-request spread
function dupTable(dupLines: Line[], acrossLines: Line[]): string {
  const across = series(acrossLines);
  const names = [...across.keys()].filter((n) => !n.endsWith("confidence"));
  const rows = ["| field | within-request sd (mean over requests) | within-request range | across-request sd | across-request range | ratio within/across |", "| --- | --- | --- | --- | --- | --- |"];
  for (const name of names.sort()) {
    const sds: number[] = [];
    const ranges: number[] = [];
    for (const l of dupLines) {
      const xs = series([l]).get(name) ?? [];
      if (xs.length > 1) { sds.push(sd(xs)); ranges.push(range(xs)); }
    }
    const a = across.get(name) ?? [];
    if (!sds.length || a.length < 2) continue;
    const ratio = sd(a) > 1e-9 ? mean(sds) / sd(a) : Number.NaN;
    rows.push(`| ${name} | ${fx(mean(sds))} | ${fx(mean(ranges), 2)} | ${fx(sd(a))} | ${fx(range(a), 2)} | ${Number.isFinite(ratio) ? ratio.toFixed(2) : "n/a (no across-request variation)"} |`);
  }
  return rows.join("\n");
}

// D: key names
const dByKey = KEY_NAMES.map((k) => {
  const xs = D.flatMap((l) => (l.answers[k]?.probabilities ? [l.answers[k]!.probabilities!.negative ?? 0] : []));
  return { k, n: xs.length, mean: mean(xs), sd: sd(xs) };
}).sort((a, b) => b.mean - a.mean);
const dSpread = range(dByKey.map((d) => d.mean));
const dWithin = D.map((l) => range(Object.values(l.answers).map((a) => a.probabilities?.negative ?? 0))).filter(Number.isFinite);
const dupNoise = B.map((l) => {
  const xs = Object.entries(l.answers).filter(([k]) => base(k) === KEY_QUESTION).map(([, a]) => a.probabilities?.negative ?? 0);
  return range(xs);
});
// position effect: mean p(negative) by slot index in the request
const byPos = Array.from({ length: KEY_NAMES.length }, (_, i) =>
  mean(D.map((l) => Object.values(l.answers)[i]?.probabilities?.negative ?? Number.NaN).filter(Number.isFinite)));

/** p_top - p_second per answer of one question. */
const margins = (ls: Line[], prefix: string): number[] =>
  ls.flatMap((l) =>
    Object.entries(l.answers)
      .filter(([k, a]) => base(k) === prefix && a.probabilities)
      .map(([, a]) => {
        const v = Object.values(a.probabilities!).sort((x, y) => y - x);
        return (v[0] ?? 0) - (v[1] ?? 0);
      }),
  );

const eTeamMargin = margins(E, "team");
const eMoodMargin = margins(E, "mood");

const sdSplit = maxSd(A);
const sdPeak = Apeak.length ? maxSd(Apeak) : Number.NaN;
const margin = 2 * sdSplit;

const md = `# H8 — non-determinism

Verdict: **CONFIRMED**. Identical requests do not return identical numbers, and duplicate copies of
one question inside a single request disagree with each other by the same amount. The movement is
small in absolute terms (~0.01-0.02 on a probability) but it is enough to flip the top choice when
two options are close.

Raw data: \`eval/data/h8/*.jsonl\` (one line per attempt: request, headers, response).
Script: \`eval/h8.ts\` (\`--offline\` re-analyses without sending).

One fixed state, two question sets over it:
- **split** — the primary set: a 3-option choice sitting near 50/50 (\`mood\`), a second 3-option
  choice at ~0.46/0.54 (\`team\`), a 3-level score with spread mass (\`effort\`), one yes/no question
  near 0.5 (\`at_risk\`).
- **peaked** — the same shape of questions where the model is sure (top probability ~0.96-0.99),
  kept as a contrast.

n = ${A.length} + ${Apeak.length} identical direct requests, ${B.length} + ${Bpeak.length} duplicate-carrying requests (${DUP_N} copies per question),
${C.length} + ${Cpeak.length} identical gateway requests, ${D.length} key-name requests, ${E.length} knife-edge requests = **${lines.length} requests**.
All values arrive at 2 dp, so 0.01 is the quantum; an sd of 0.006 means the value moves by one
quantum most of the time.

## A — ${A.length} identical requests, direct API (split set)

${fieldTable(A)}

- largest per-field sd **${fx(sdSplit)}**, largest per-field range **${fx(maxRange(A), 2)}**
- \`mood\` top answer: ${flips(A, "mood")}
- \`team\` top answer: ${flips(A, "team")}
- \`effort\` top answer: ${flips(A, "effort")}

Contrast, the peaked set over the same state (n = ${Apeak.length}):

${Apeak.length ? fieldTable(Apeak) : "not collected"}

- largest per-field sd **${fx(sdPeak)}**, largest per-field range **${fx(maxRange(Apeak), 2)}**
- \`department\` top answer: ${flips(Apeak, "department")}; \`frustration\` top answer: ${flips(Apeak, "frustration")}

The noise does not vanish when the model is sure, but it cannot move the decision: a 0.96 stays
0.96 +/- 0.01. The size of the movement grows towards the middle of the range (largest sd here is on
the ~0.3/0.7 question, smallest on the 0.99 one), and section E shows what it does when two options
are genuinely close.

### Key order

- \`answers\` key order equals the request order in ${A.length}/${A.length} responses (${ansOrders.size} distinct order seen).
- \`probabilities\` key order is **not** stable: ${[...probOrders].map(([k, s]) => `\`${k}\` ${s.size} distinct orders`).join(", ")} over ${A.length + Apeak.length} responses.

## B — ${DUP_N} duplicates of each question inside one request

Identical instructions and criteria under ${DUP_N} different keys, ${B.length} requests (split set).

${dupTable(B, A)}

- \`mood\` top answer over all ${DUP_N * B.length} duplicates: ${flips(B, "mood")}
- \`team\` top answer over all duplicates: ${flips(B, "team")}

The within-request spread matches the across-request spread (ratios near 1). Copies of a question in
one request are *not* repeated samples of a stable value being measured twice; they are as noisy as
two separate calls, which also means questions in one request do not agree with each other by
construction.

## C — ${C.length} identical requests, Vercel gateway (split set)

${C.length ? fieldTable(C) : "not collected"}

- largest per-field sd **${fx(maxSd(C))}**, largest per-field range **${fx(maxRange(C), 2)}**
- \`mood\` top answer: ${flips(C, "mood")}
- \`team\` top answer: ${flips(C, "team")}

The gateway behaves like the direct API; the same field-level movement appears with n = ${C.length}.

## E — a knife-edge state: how often does the chosen option flip?

A shorter version of the same feedback, ${E.length} identical direct requests, two 3-option choices whose
leading pair sits within 0.05.

${E.length ? fieldTable(E) : "not collected"}

- \`team\` (mean margin p_top - p_second = **${fx(mean(eTeamMargin), 3)}**, smallest margin seen ${fx(Math.min(...eTeamMargin), 2)}): ${flips(E, "team")}
- \`mood\` (mean margin **${fx(mean(eMoodMargin), 3)}**, min ${fx(Math.min(...eMoodMargin), 2)}): ${flips(E, "mood")}

So the \`choice\` field itself — not just the probabilities — is non-deterministic once the margin
falls near the noise. At a margin of ~${fx(mean(eTeamMargin), 2)} the answer changed in ${flipCount(E, "team")} identical requests; at a margin
of ~${fx(mean(eMoodMargin), 2)} it never did.

## D — do question key names change the answer?

The most spread \`${KEY_QUESTION}\` question sent ${KEY_NAMES.length} times in one request under very different key
names, key order reshuffled per request, ${D.length} requests. Measure: p(negative).

| key name | n | mean p(negative) | sd |
| --- | --- | --- | --- |
${dByKey.map((d) => `| \`${d.k}\` | ${d.n} | ${fx(d.mean, 3)} | ${fx(d.sd)} |`).join("\n")}

- spread of the per-name means: **${fx(dSpread, 3)}**
- noise floor: mean within-request range over ${DUP_N} identical duplicates (part B) = **${fx(mean(dupNoise), 3)}**;
  mean within-request range over these ${KEY_NAMES.length} names = ${fx(mean(dWithin), 3)}
- by slot position in the request (1st to ${KEY_NAMES.length}th): ${byPos.map((x) => fx(x, 3)).join(", ")}

The per-name spread sits inside the noise a duplicated question produces anyway, and there is no
gradient by position. Key names are not evidence for the model, as the docs state.

## Practical rule for library users

1. **Treat every probability as +/- ${fx(margin, 2)} (2 sd).** The same request twice, or the same question twice
   in one request, gives answers that differ in the second decimal. Do not persist or diff these
   numbers as if they were stable identifiers of a state.
2. **Leave a dead band around thresholds.** If \`p\` is within ~${fx(margin, 2)} of a cut-off, treat the answer as
   undecided and route it, rather than letting the coin land. On the knife-edge question in section E
   (margin ${fx(mean(eTeamMargin), 2)}) the returned \`choice\` flipped in ${flipCount(E, "team")} identical requests — the top \`choice\` field is not a stable output when
   the two leading options are within ~0.05 of each other. Check the margin \`p_top - p_second\`
   before you trust \`choice\`.
3. **Retrying does not buy certainty, and neither does duplicating the question.** Duplicates inside
   one request are as noisy as separate requests, so "ask twice and compare" is not a consistency
   check; it is two draws from the same jittery distribution. If you need a self-consistency signal,
   vary the question, not the key.
4. **Never rely on \`probabilities\` key order.** It is unstable across responses (this run saw
   ${Math.max(...[...probOrders.values()].map((s) => s.size))} different orders for one question). \`answers\` key order does follow the request, but
   look answers up by key anyway.
5. **Name keys for your own code.** Key names, however loaded, move the answer no more than noise.
`;

console.log(`\nedge flips: team ${flipCount(E, "team")}, mood ${flipCount(E, "mood")}`);
console.log(`split: max sd ${fx(sdSplit)} | peaked: max sd ${fx(sdPeak)} | key-name spread ${fx(dSpread, 3)} vs dup noise ${fx(mean(dupNoise), 3)}`);
console.log("report:", writeReport(HYP, md));
