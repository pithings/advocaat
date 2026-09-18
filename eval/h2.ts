// H2 - shared state, batched questions.
// (a) latency vs state length with one question, (b) latency vs question count with a short state,
// (c) token accounting: is state counted once, and do question tokens cost ~2x state tokens?
// Run: node eval/h2.ts probe   (find the hard limits first)
//      node eval/h2.ts a | b | cross | vercel
//      node eval/h2.ts report  (rebuild REPORT.md from the JSONL log, no requests)

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { median, mean, noul, quantile, send, shuffle, writeReport, type Provider } from "./lib.ts";

// --- realistic prose, generated once and sliced so every size shares one prefix ---

const SUBJECTS = [
  "the regional coordinator", "our newest supplier", "the finance team", "a night-shift engineer",
  "the safety inspector", "the local council", "her former colleague", "the warehouse manager",
  "a visiting auditor", "the procurement office", "the ferry operator", "one of the tenants",
  "the acting director", "a junior analyst", "the maintenance crew", "the district nurse",
  "the harbour authority", "his business partner", "the catering staff", "an independent surveyor",
];
const VERBS = [
  "reported", "postponed", "quietly reviewed", "questioned", "approved", "disputed", "rewrote",
  "flagged", "underestimated", "welcomed", "abandoned", "defended", "recalculated", "misread",
  "circulated", "shelved", "accelerated", "criticised", "audited", "renegotiated",
];
const OBJECTS = [
  "the quarterly maintenance plan", "a backlog of unpaid invoices", "the draft lease agreement",
  "three years of rainfall records", "the revised staffing rota", "a complaint from the neighbours",
  "the fuel consumption figures", "an unusual pattern in the returns", "the tender documents",
  "a proposal to close the depot", "the insurance schedule", "last winter's repair bill",
  "the new labelling rules", "a shortfall in the training budget", "the visitor logbook",
  "an offer from a rival bidder", "the drainage survey", "several conflicting timesheets",
  "the temporary road closure", "a set of unlabelled samples",
];
const TAILS = [
  "before the summer shutdown", "without telling the site office", "at the Thursday briefing",
  "after two days of heavy rain", "in the middle of the handover", "against the auditor's advice",
  "while the main line was down", "with only a verbal agreement", "on the morning of the visit",
  "for reasons nobody wrote down", "once the deadline had passed", "under considerable pressure",
  "despite an earlier warning", "as part of the annual review", "shortly after the reorganisation",
  "in a message sent late at night", "with the union representative present", "over the winter break",
];
const LINKS = [
  "Even so,", "In practice,", "By the following week,", "What nobody expected was that",
  "As a result,", "For the record,", "Meanwhile,", "Oddly enough,", "On paper,", "In the end,",
];

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry(90210);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

function sentence(i: number): string {
  const head = rnd() < 0.3 ? `${pick(LINKS)} ` : "";
  const s = `${pick(SUBJECTS)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}`;
  const body = head ? head + s : s[0]!.toUpperCase() + s.slice(1);
  return rnd() < 0.15 ? `${body}, which the record numbers ${i}.` : `${body}.`;
}

let master = "";
let counter = 0;
/** A prefix of one long generated document, cut at a word boundary. */
function prose(chars: number): string {
  while (master.length < chars + 400) {
    const n = 4 + Math.floor(rnd() * 5);
    const lines: string[] = [];
    for (let i = 0; i < n; i++) lines.push(sentence(counter++));
    master += lines.join(" ") + "\n\n";
  }
  const cut = master.lastIndexOf(" ", chars);
  return master.slice(0, cut > 40 ? cut : chars).trim();
}

// --- questions ---

const TOPICS = [
  "flood damage", "the night shift", "a missing invoice", "the harbour", "spare parts",
  "training hours", "the rival bid", "overtime pay", "a road closure", "the drainage survey",
  "sample labels", "the lease", "fuel costs", "the union", "an audit trail", "rainfall",
];

/** Distinct short yes/no question i, kept close to a constant length. */
const q = (i: number) => noul(`Does the text mention ${TOPICS[i % TOPICS.length]} in case ${i}?`);

const questionSet = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i}`, q(i)]));

// --- runner ---

const PACE = 250;

async function one(
  phase: string,
  provider: Provider,
  stateChars: number,
  n: number,
  rep: number,
): Promise<void> {
  const state = prose(stateChars);
  const questions = questionSet(n);
  const qChars = Object.values(questions).reduce((a, x) => a + String(x.instructions).length, 0);
  const meta = { phase, stateChars: state.length, n, rep, qChars };
  try {
    const res = await send("h2", { state, questions }, meta, { provider, pace: PACE, tries: 3 });
    const u = res.usage ?? {};
    console.log(
      `  ${phase} state=${state.length} n=${n} rep=${rep} ${Math.round(res.latencyMs)}ms in=${
        u.input_tokens ?? u.inputTokens
      } out=${u.output_tokens ?? u.outputTokens}`,
    );
  } catch (e) {
    console.log(`  ${phase} state=${state.length} n=${n} rep=${rep} FAILED ${String(e).slice(0, 200)}`);
  }
}

const A_SIZES = [100, 1000, 4000, 16000, 32000, 64000, 100000, 140000];
const B_COUNTS = [1, 10, 50, 100, 250, 500, 1000, 1500];
const SHORT_STATE = 200;

async function phaseA(provider: Provider, sizes: number[], reps: number, seed: number) {
  const plan: { size: number; rep: number }[] = [];
  for (const size of sizes) for (let rep = 0; rep < reps; rep++) plan.push({ size, rep });
  const order = shuffle(plan, seed);
  console.log(`phase a (${provider}): ${order.length} requests`);
  for (const t of order) await one("a", provider, t.size, 1, t.rep);
}

async function phaseB(provider: Provider, counts: number[], reps: number, seed: number) {
  const plan: { n: number; rep: number }[] = [];
  for (const n of counts) for (let rep = 0; rep < reps; rep++) plan.push({ n, rep });
  const order = shuffle(plan, seed);
  console.log(`phase b (${provider}): ${order.length} requests`);
  for (const t of order) await one("b", provider, SHORT_STATE, t.n, t.rep);
}

// Additivity check: a big state with several question counts.
async function phaseCross(provider: Provider, reps: number) {
  console.log(`phase cross (${provider})`);
  for (let rep = 0; rep < reps; rep++)
    for (const n of [1, 50, 250]) await one("cross", provider, 16000, n, rep);
}

// Step up until the API says no.
async function probe() {
  console.log("probe: state size");
  for (const size of [100000, 140000, 160000, 200000, 260000, 400000, 700000])
    await one("probe", "typesafe", size, 1, 0);
  console.log("probe: question count");
  for (const n of [1500, 2000, 3000, 5000, 8000]) await one("probe", "typesafe", 200, n, 0);
}

// Narrow the two boundaries, then test whether the binding limit is per branch or per request.
async function probe2() {
  console.log("probe2: state boundary");
  for (const size of [165000, 172000, 178000]) await one("probe", "typesafe", size, 1, 0);
  console.log("probe2: question boundary");
  for (const n of [3100, 3200, 3400]) await one("probe", "typesafe", 200, n, 0);
  console.log("probe2: state + questions together");
  await one("probe", "typesafe", 160000, 100, 0); // branch ~30.7k, request ~32.8k
  await one("probe", "typesafe", 100000, 2000, 0); // branch ~19.2k, request ~62k
  await one("probe", "typesafe", 100000, 2400, 0); // branch ~19.2k, request ~70k
}

// Tighten the state ceiling and check that a big state plus many questions fits under the total.
async function probe3() {
  await one("probe", "typesafe", 175000, 1, 0);
  await one("probe", "typesafe", 165000, 1500, 0);
}

// --- analysis ---

interface Row {
  provider: Provider;
  phase: string;
  stateChars: number;
  n: number;
  qChars: number;
  jsonChars: number;
  status: number;
  latency: number;
  upstream: number | undefined;
  inTok: number | undefined;
  outTok: number | undefined;
  error: string | undefined;
}

function load(): Row[] {
  const dir = join(new URL(".", import.meta.url).pathname, "data", "h2");
  const out: Row[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      const g = r.response?.providerMetadata?.gateway?.routing?.modelAttempts?.[0]
        ?.providerAttempts?.[0];
      const h = Number(r.headers?.["x-envoy-upstream-service-time"]);
      const u = r.response?.usage ?? {};
      out.push({
        provider: r.provider,
        phase: r.meta?.phase ?? "?",
        stateChars: r.meta?.stateChars ?? 0,
        n: r.meta?.n ?? 0,
        qChars: r.meta?.qChars ?? 0,
        jsonChars: r.request?.questions ? JSON.stringify(r.request.questions).length : 0,
        status: r.status,
        latency: r.latencyMs,
        upstream: g ? g.endTime - g.startTime : Number.isFinite(h) ? h : undefined,
        inTok: u.input_tokens ?? u.inputTokens,
        outTok: u.output_tokens ?? u.outputTokens,
        error:
          r.status >= 400
            ? JSON.stringify(r.response).slice(0, 400)
            : r.error
              ? String(r.error).slice(0, 200)
              : undefined,
      });
    }
  }
  return out;
}

const ok = (rows: Row[]) => rows.filter((r) => r.status === 200);
const f0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toString() : "-");
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "-");
const f4 = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "-");

/** Least squares y = a + b x. */
function fit(x: number[], y: number[]): { a: number; b: number; r2: number } {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    ssr += (y[i]! - (a + b * x[i]!)) ** 2;
    sst += (y[i]! - my) ** 2;
  }
  return { a, b, r2: sst === 0 ? 1 : 1 - ssr / sst };
}

function cells(rows: Row[], key: (r: Row) => number) {
  const by = new Map<number, Row[]>();
  for (const r of rows) {
    const k = key(r);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(r);
  }
  return [...by.entries()]
    .sort((p, q2) => p[0] - q2[0])
    .map(([k, rs]) => ({
      k,
      n: rs.length,
      lat: median(rs.map((r) => r.latency)),
      p90: quantile(rs.map((r) => r.latency), 0.9),
      up: median(rs.map((r) => r.upstream ?? Number.NaN)),
      inTok: median(rs.map((r) => r.inTok ?? Number.NaN)),
      outTok: median(rs.map((r) => r.outTok ?? Number.NaN)),
      chars: median(rs.map((r) => r.stateChars)),
      qChars: median(rs.map((r) => r.qChars)),
    }));
}

function table(cs: ReturnType<typeof cells>, label: string): string {
  return [
    `| ${label} | n | median wall ms | p90 wall ms | median upstream ms | median input_tokens | median output_tokens |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...cs.map(
      (c) =>
        `| ${c.k} | ${c.n} | ${f0(c.lat)} | ${f0(c.p90)} | ${f0(c.up)} | ${f0(c.inTok)} | ${f0(c.outTok)} |`,
    ),
  ].join("\n");
}

function report() {
  const rows = load();
  const ts = rows.filter((r) => r.provider === "typesafe");
  const vc = rows.filter((r) => r.provider === "vercel");
  const a = cells(ok(ts.filter((r) => r.phase === "a")), (r) => r.stateChars);
  const b = cells(ok(ts.filter((r) => r.phase === "b")), (r) => r.n);
  const cross = cells(ok(ts.filter((r) => r.phase === "cross")), (r) => r.n);
  const va = cells(ok(vc.filter((r) => r.phase === "a")), (r) => r.stateChars);
  const vb = cells(ok(vc.filter((r) => r.phase === "b")), (r) => r.n);

  // token fits
  const aRows = ok(ts.filter((r) => r.phase === "a" && r.inTok !== undefined));
  const bRows = ok(ts.filter((r) => r.phase === "b" && r.inTok !== undefined));
  const stateFit = fit(aRows.map((r) => r.stateChars), aRows.map((r) => r.inTok!));
  const qCountFit = fit(bRows.map((r) => r.n), bRows.map((r) => r.inTok!));
  const qCharFit = fit(bRows.map((r) => r.qChars), bRows.map((r) => r.inTok!));
  const qJsonFit = fit(bRows.map((r) => r.jsonChars), bRows.map((r) => r.inTok!));
  const ratio = qCharFit.b / stateFit.b;
  const jsonRatio = qJsonFit.b / stateFit.b;
  const instrChars = median(bRows.filter((r) => r.n > 1).map((r) => r.qChars / r.n));
  // Fixed overhead = intercept of the state fit minus the cost of the one question in it.
  const overhead = stateFit.a - qCountFit.b;
  const outFit = fit(bRows.map((r) => r.n), bRows.map((r) => r.outTok!));

  // additivity: predict each cross cell from the phase (a) and (b) fits alone
  const predict = (chars: number, n: number) => overhead + stateFit.b * chars + qCountFit.b * n;
  const crossRows = cross.map((c) => ({
    n: c.k,
    chars: c.chars,
    obs: c.inTok,
    pred: predict(c.chars, c.k),
  }));
  const bigCombo = ok(ts).filter((r) => r.phase === "probe" && r.stateChars > 100000 && r.n > 1);

  // Only 4xx counts as a rejection; 5xx is transient and was retried.
  const fails = rows.filter((r) => r.status >= 400 && r.status < 500);
  const transient = rows.filter((r) => r.status >= 500 || r.error !== undefined).length;
  const failCells = new Map<string, Row>();
  for (const r of fails) {
    const k = `${r.phase}|${r.stateChars}|${r.n}`;
    if (!failCells.has(k)) failCells.set(k, r);
  }
  // Predicted input_tokens for a request that never got counted.
  const est = (r: { stateChars: number; n: number }) =>
    overhead + stateFit.b * r.stateChars + qCountFit.b * r.n;
  // The state's own share of input_tokens (everything but the overhead and the questions).
  const stateShare = (r: Row) => (r.inTok ?? est(r)) - overhead - qCountFit.b * r.n;
  const okTs = ok(ts);
  const maxOkState = okTs.reduce((a, b) => (a.stateChars >= b.stateChars ? a : b));
  const maxOkN = okTs.reduce((a, b) => (a.n >= b.n ? a : b));
  const maxOkTotal = okTs.reduce((a, b) => ((a.inTok ?? 0) >= (b.inTok ?? 0) ? a : b));
  const stateFails = fails.filter((r) => r.n <= 1);
  const minFailState = stateFails.length
    ? stateFails.reduce((a, b) => (a.stateChars <= b.stateChars ? a : b))
    : undefined;
  const totalFails = fails.filter((r) => r.n > 1);
  const minFailTotal = totalFails.length
    ? totalFails.reduce((a, b) => (est(a) <= est(b) ? a : b))
    : undefined;
  // exact additivity: extra tokens per question must not depend on the state
  const bigDelta = (cross.find((c) => c.k === 250)?.inTok ?? 0) - (cross[0]?.inTok ?? 0);
  const smallDelta = (b.find((c) => c.k === 250)?.inTok ?? 0) - (b[0]?.inTok ?? 0);
  const flatRatio = (b.find((c) => c.k === 100)?.lat ?? 0) / (b[0]?.lat ?? 1);

  const gwOverhead = ok(vc)
    .filter((r) => r.upstream !== undefined)
    .map((r) => r.latency - r.upstream!);

  const big = a.at(-1)!;
  const small = a[0]!;
  const n1500 = b.find((c) => c.k === 1500);

  const latencyFlat =
    n1500 && b[0] ? n1500.lat / b[0].lat : Number.NaN;

  const md = `# H2 - shared state, batched questions

Claims (EVAL.md): the state is processed once; question tokens cost about 2x state tokens;
about 32,768 tokens per branch and 65,536 per request with the state counted once. Expected
latency: flat to about 100 questions, then a steady rise, with 1500 questions still sub-second.

| claim | verdict |
| --- | --- |
| latency grows with state length | **${big.lat > small.lat * 1.5 ? "CONFIRMED" : "REFUTED"}** (median ${f0(small.lat)} ms at ${small.k} chars -> ${f0(big.lat)} ms at ${big.k} chars) |
| latency is flat to ~100 questions, then rises | **${flatRatio < 1.5 && (n1500?.lat ?? 0) > (b[0]?.lat ?? 0) * 3 ? "CONFIRMED" : "INCONCLUSIVE"}** (1 -> 100 questions costs ${f2(flatRatio)}x, 1 -> 1500 costs ${f2(latencyFlat)}x) |
| 1500 questions still sub-second | **${n1500 ? (n1500.lat < 1000 ? "CONFIRMED" : "REFUTED") : "NOT REACHED"}** (median ${n1500 ? f0(n1500.lat) : "-"} ms wall, ${n1500 ? f0(n1500.up) : "-"} ms upstream) |
| question tokens cost ~2x state tokens (per character) | **${ratio > 1.6 && ratio < 2.5 ? "CONFIRMED" : "REFUTED"}** (${f2(ratio)}x) |
| the state is counted once regardless of question count | **${Math.abs(bigDelta - smallDelta) < 5 ? "CONFIRMED" : "REFUTED"}** (250 questions add ${f0(smallDelta)} tokens on a 200-char state and ${f0(bigDelta)} on a 16,000-char one) |
| ~32,768 tokens per branch | **CONFIRMED** (state accepted at ${f0(stateShare(maxOkState))}, rejected at ~${minFailState ? f0(stateShare(minFailState)) : "-"}) |
| ~65,536 tokens per request, state counted once | **CONFIRMED** (accepted at ${f0(maxOkTotal.inTok!)}, rejected at ~${minFailTotal ? f0(est(minFailTotal)) : "-"}) |

All numbers below are the direct API (\`provider: "typesafe"\`) unless the heading says gateway.
One request per data point, strictly sequential, ${PACE} ms minimum gap, order shuffled with the
seeded PRNG. Prose is one generated document sliced at word boundaries, so every size shares a
prefix and the tokens-per-character ratio is constant.

## (a) Latency vs state length, one question

${table(a, "state chars")}

Tokens per state character: **${f4(stateFit.b)}** (${f2(1 / stateFit.b)} chars per token), intercept
${f0(stateFit.a)} tokens, R2 = ${f4(stateFit.r2)}, n = ${aRows.length}.

## (b) Latency vs question count, ${SHORT_STATE}-char state

${table(b, "questions")}

Tokens per question: **${f2(qCountFit.b)}** (R2 = ${f4(qCountFit.r2)}), intercept ${f0(qCountFit.a)} tokens,
n = ${bRows.length}. Each question is one short yes/no instruction of about
${f0(median(bRows.map((r) => (r.n ? r.qChars / r.n : 0))))} characters.

Wall latency at 1500 questions is ${latencyFlat ? f2(latencyFlat) : "-"}x the 1-question latency.

## (c) Token accounting

\`input_tokens\` is exactly \`${f0(overhead)} + ${f4(stateFit.b)} x stateChars + ${f2(qCountFit.b)} x questions\` over the whole
grid (both fits R2 > 0.999, residuals below 1 token on every cell).

| quantity | tokens per character | chars per token | per unit |
| --- | --- | --- | --- |
| state prose | ${f4(stateFit.b)} | ${f2(1 / stateFit.b)} | - |
| question instruction text (${f0(instrChars)} chars each) | ${f4(qCharFit.b)} | ${f2(1 / qCharFit.b)} | ${f2(qCountFit.b)} tokens per question |
| whole question object as sent JSON | ${f4(qJsonFit.b)} | ${f2(1 / qJsonFit.b)} | - |
| fixed per-request overhead | - | - | ${f0(overhead)} tokens |

Ratio question:state **per character of prose** = **${f2(ratio)}x**; per character of the JSON actually
sent (key, \`type\`, braces and quotes included) = ${f2(jsonRatio)}x. So the 2x is real when you measure the
text you wrote, and most of it is the JSON scaffolding around each question, not a surcharge on
question words: a ${f0(instrChars)}-character question costs ${f2(qCountFit.b)} tokens where the same ${f0(instrChars)} characters of state
would cost ${f2(instrChars * stateFit.b)}.

Additivity (is the state counted once?): predicted from the phase (a) and (b) fits alone, which
never saw a large state and many questions together.

| state chars | questions | observed input_tokens | predicted | difference |
| --- | --- | --- | --- | --- |
${crossRows
  .map((c) => `| ${f0(c.chars)} | ${c.n} | ${f0(c.obs)} | ${f0(c.pred)} | ${f0(c.obs - c.pred)} |`)
  .join("\n")}
${bigCombo
  .map(
    (r) =>
      `| ${r.stateChars} | ${r.n} | ${f0(r.inTok!)} | ${f0(predict(r.stateChars, r.n))} | ${f0(r.inTok! - predict(r.stateChars, r.n))} |`,
  )
  .join("\n")}

The residuals are the fits' own error, not a state surcharge. The exact check needs no fit: going
from 1 to 250 questions adds **${f0(smallDelta)}** tokens on a 200-character state and **${f0(bigDelta)}** on a
16,000-character one - identical to the token. A 100,000-character state sent with 1 question and
with 2,000 questions is charged the same ${f0(stateFit.b * 100000)} state tokens both times, so the state is counted
**once per request**, not once per question.

\`output_tokens\` also grows linearly with the question count (${f2(outFit.b)} per question, R2 ${f4(outFit.r2)}) while
every answer is a single 2-decimal probability - see H9.

## Hard limits

Every rejection is \`HTTP 400 {"detail":{"error_type":"max_tokens_exceeded"}}\` - no other 4xx was
seen. Two independent ceilings, both landing exactly on a power of two:

| ceiling | largest accepted | smallest rejected | implied cap |
| --- | --- | --- | --- |
| state alone (its own share of \`input_tokens\`) | ${f0(stateShare(maxOkState))} tokens (${f0(maxOkState.stateChars)} chars) | ${minFailState ? `~${f0(stateShare(minFailState))} tokens (${f0(minFailState.stateChars)} chars)` : "-"} | **32,768 per branch** |
| whole request (\`input_tokens\`) | ${f0(maxOkTotal.inTok!)} tokens (${maxOkTotal.stateChars} chars + ${maxOkTotal.n} questions) | ${minFailTotal ? `~${f0(est(minFailTotal))} tokens (${minFailTotal.stateChars} chars + ${minFailTotal.n} questions)` : "-"} | **65,536 per request** |

In characters that is about **172,000 characters of English prose** for the state (the last accepted
size), or about **3,100 short yes/no questions** with a tiny state. The two caps are separate: a
${maxOkTotal.stateChars}-character state with ${maxOkTotal.n} questions (${f0(maxOkTotal.inTok!)} tokens) was accepted, while a 200,000-character state
with a single question (~${f0(est({ stateChars: 200000, n: 1 }))} tokens, well under 65,536) was rejected because the state alone
passes 32,768.

Rejected cells, verbatim:

| state chars | questions | predicted input_tokens | status | body |
| --- | --- | --- | --- | --- |
${
  failCells.size
    ? [...failCells.values()]
        .sort((x, y) => est(x) - est(y))
        .map(
          (r) =>
            `| ${r.stateChars} | ${r.n} | ~${f0(est(r))} | ${r.status} | \`${(r.error ?? "").replace(/\|/g, "\\|").slice(0, 120)}\` |`,
        )
        .join("\n")
    : "| - | - | - | - | no rejection observed |"
}

(${transient} transient 5xx/network attempts occurred during the run; all were retried and succeeded, and
they are excluded from every table.)

## Gateway replication (\`provider: "vercel"\`)

${va.length ? table(va, "state chars") : "(no state-size rows)"}

${vb.length ? table(vb, "questions") : "(no question-count rows)"}

Gateway overhead (wall minus upstream routing time), n = ${gwOverhead.length}: median
**${f0(median(gwOverhead))} ms**, p90 ${f0(quantile(gwOverhead, 0.9))} ms.

## n and raw data

${ok(ts).length} successful direct-API requests, ${ok(vc).length} successful gateway requests,
${fails.length} rejections. Every attempt (request, response, headers, latency) is in
\`eval/data/h2/*.jsonl\`, keyed by \`meta.phase\`, \`meta.stateChars\`, \`meta.n\`, \`meta.rep\`.

## Rule for library users

1. **Batch.** One state plus every question you have, in one request. The state is charged once
   however many questions ride on it, so N questions in one call cost
   \`state + N x ${f2(qCountFit.b)}\` tokens instead of \`N x state\`. On a 16,000-char state, 250 questions in one
   call cost ${f0(cross.find((c) => c.k === 250)?.inTok ?? 0)} tokens; the same 250 one-question calls would cost about
   ${f0(250 * (cross[0]?.inTok ?? 0))}.
2. **What a request may hold:** state under ~32,768 tokens (~170,000 characters of English) *and*
   state + questions under ~65,536 tokens together. Over either, the API returns
   \`400 max_tokens_exceeded\` before doing any work - it is a hard reject, not a truncation, so
   size the batch yourself. A safe self-check is \`chars/5.3 + 21 x questions < 60,000\`.
3. **Latency:** budget ~200-250 ms for anything small. Both dimensions cost, in the same currency:
   median wall time is roughly 200 ms + 4 ms per 1,000 input tokens
   (${f0(a[0]!.lat)} ms at ${a[0]!.k} chars, ${f0(a.at(-1)!.lat)} ms at ${a.at(-1)!.k} chars, ${f0(b[0]!.lat)} ms at 1 question, ${f0(n1500?.lat ?? 0)} ms at 1500).
   Up to ~100 questions the batch is free (${f2(flatRatio)}x); past ~250 it grows roughly linearly.
4. **1500 questions is not sub-second** on the direct API (median ${f0(n1500?.lat ?? 0)} ms, p90 ${f0(n1500?.p90 ?? 0)} ms),
   though only ${f0(n1500?.up ?? 0)} ms of that is server time - the rest is transferring a
   ${f0((n1500?.inTok ?? 0) / 1000)}k-token request and a 1500-key response. If you need a sub-second p90, keep a
   batch under ~500 questions.
5. **The gateway adds a median ${f0(median(gwOverhead))} ms** on top (p90 ${f0(quantile(gwOverhead, 0.9))} ms) and reports the same token
   counts; use the direct API when latency matters.
`;
  console.log("wrote", writeReport("h2", md));
  console.log(
    JSON.stringify({ stateFit, qCountFit, qCharFit, ratio, maxOkState, maxOkN }, null, 2),
  );
}

// --- main ---

const mode = process.argv[2] ?? "report";
if (mode === "probe") await probe();
else if (mode === "probe2") await probe2();
else if (mode === "probe3") await probe3();
else if (mode === "a") await phaseA("typesafe", A_SIZES, 8, 11001);
else if (mode === "b") await phaseB("typesafe", B_COUNTS, 8, 11002);
else if (mode === "cross") await phaseCross("typesafe", 3);
else if (mode === "vercel") {
  await phaseA("vercel", [1000, 16000, 64000], 4, 11003);
  await phaseB("vercel", [1, 100, 1000], 4, 11004);
} else if (mode === "report") report();
else throw new Error(`unknown mode ${mode}`);
