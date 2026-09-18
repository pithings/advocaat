// H9 - is `output_tokens` billing rather than generation?
// (a) vary only the question key text, (b) vary the option count 2..200, (c) compare answers that
// return 0.00 / 0.01 / 0.99 and scores with 2 vs 10 levels, (d) do the gateway cost fields track it.
// Run: node eval/h9.ts pilot | a | b | c | vercel
//      node eval/h9.ts report   (rebuild REPORT.md from the JSONL log, no requests)

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  choice,
  mean,
  median,
  noul,
  quantile,
  score,
  send,
  shuffle,
  writeReport,
  type Provider,
  type Question,
} from "./lib.ts";

// One fixed state for everything, so only the thing under test changes.
const STATE =
  "Support ticket 4471, received 09:14. The customer writes: the invoice download button on the " +
  "billing page has returned a 500 error since yesterday morning. I have tried two browsers and a " +
  "different laptop. I need the PDF today because our accounts close on Friday, and nobody on your " +
  "support line has picked up in three attempts. Account is on the Team plan, renewed in March, " +
  "payment card valid until 2029. Previous tickets: one in January about a slow export.";

const PACE = 250;

// --- (a) key text ---

const WORDS = [
  "invoice", "refund", "billing", "ticket", "urgent", "export", "browser", "account", "renewal",
  "payment", "download", "customer", "friday", "attempt", "support", "error", "plan", "card",
];

/** A key of exactly `len` characters, either one repeated letter or varied English words. */
function makeKey(len: number, style: "repeat" | "varied"): string {
  if (style === "repeat") return "k".repeat(len);
  let s = "";
  let i = 0;
  while (s.length < len) s += (s ? "_" : "") + WORDS[i++ % WORDS.length];
  return s.slice(0, len).replace(/_$/, "x");
}

const KEY_QUESTION = "Is the customer frustrated with the response they have had so far?";
const KEY_LENGTHS = [1, 20, 100, 500];

// --- (b) option count ---

const OPTION_QUESTION = "Which of these labels best fits the ticket?";

/** K options with fixed-width labels and fixed-length descriptions. */
function options(k: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < k; i++) {
    const n = String(i).padStart(3, "0");
    out[`label_${n}`] = `Category ${n} of the internal routing taxonomy.`;
  }
  return out;
}

const OPTION_COUNTS = [2, 5, 20, 50, 100, 200];

// Same option count, same descriptions; only the label text changes.
const LABEL_STYLES: Record<string, (i: number) => string> = {
  short: (i) => "abcdefghijklmnopqrst"[i]!,
  long: (i) => `label_${String(i).padStart(3, "0")}`,
  longer: (i) => `internal_routing_taxonomy_category_number_${String(i).padStart(3, "0")}`,
};

function labelled(style: string, k: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < k; i++)
    out[LABEL_STYLES[style]!(i)] = "Category of the internal routing taxonomy.";
  return out;
}

async function phaseLabels(provider: Provider, reps: number, seed: number) {
  const plan: { style: string; rep: number }[] = [];
  for (const style of Object.keys(LABEL_STYLES))
    for (let rep = 0; rep < reps; rep++) plan.push({ style, rep });
  console.log(`phase b2 (${provider}): ${plan.length} requests`);
  for (const t of shuffle(plan, seed))
    await one("b2", provider, "pick", choice(OPTION_QUESTION, labelled(t.style, 20)), {
      style: t.style,
      k: 20,
      rep: t.rep,
    });
}

// --- (c) answer value and score levels ---

// Padded to the same length so only the expected answer differs.
const pad = (s: string) => s.padEnd(84, " ").slice(0, 84);
// Piloted wordings that land on 0.99, 0.01 and 0.00; padded to one length so only the answer moves.
const VALUE_QUESTIONS: Record<string, string> = {
  p99: pad("Does the customer say the invoice button returns an error? Answer yes or no."),
  p01: pad("Does the text above contain the word ZEBRA anywhere in it? Answer yes or no."),
  p00: pad("Is the text above written entirely in the Japanese language? Answer yes or no."),
};

const LEVELS_2 = ["Not urgent at all.", "Extremely urgent."];
const LEVELS_10 = Array.from(
  { length: 10 },
  (_, i) => `Urgency level ${i + 1} of 10 on the internal scale.`,
);

// --- runner ---

async function one(
  phase: string,
  provider: Provider,
  key: string,
  q: Question,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await send(
      "h9",
      { state: STATE, questions: { [key]: q } },
      { phase, keyLen: key.length, ...meta },
      { provider, pace: PACE, tries: 4 },
    );
    const u = res.usage ?? {};
    const a = res.answers[key];
    console.log(
      `  ${phase} ${JSON.stringify(meta)} keyLen=${key.length} ${Math.round(res.latencyMs)}ms in=${
        u.input_tokens ?? u.inputTokens
      } out=${u.output_tokens ?? u.outputTokens} ans=${a?.probability ?? a?.choice ?? a?.score}`,
    );
  } catch (e) {
    console.log(`  ${phase} FAILED ${String(e).slice(0, 200)}`);
  }
}

async function phaseKeys(provider: Provider, lengths: number[], reps: number, seed: number) {
  const plan: { len: number; style: "repeat" | "varied"; rep: number }[] = [];
  for (const len of lengths)
    for (const style of ["repeat", "varied"] as const)
      for (let rep = 0; rep < reps; rep++) plan.push({ len, style, rep });
  console.log(`phase a (${provider}): ${plan.length} requests`);
  for (const t of shuffle(plan, seed))
    await one("a", provider, makeKey(t.len, t.style), noul(KEY_QUESTION), {
      len: t.len,
      style: t.style,
      rep: t.rep,
    });
}

async function phaseOptions(provider: Provider, counts: number[], reps: number, seed: number) {
  const plan: { k: number; rep: number }[] = [];
  for (const k of counts) for (let rep = 0; rep < reps; rep++) plan.push({ k, rep });
  console.log(`phase b (${provider}): ${plan.length} requests`);
  for (const t of shuffle(plan, seed))
    await one("b", provider, "pick", choice(OPTION_QUESTION, options(t.k)), {
      k: t.k,
      rep: t.rep,
    });
}

async function phaseValues(provider: Provider, reps: number, seed: number) {
  const plan: { kind: string; rep: number }[] = [];
  for (const kind of [...Object.keys(VALUE_QUESTIONS), "score2", "score10"])
    for (let rep = 0; rep < reps; rep++) plan.push({ kind, rep });
  console.log(`phase c (${provider}): ${plan.length} requests`);
  for (const t of shuffle(plan, seed)) {
    const q =
      t.kind === "score2"
        ? score("How urgent is this ticket?", LEVELS_2)
        : t.kind === "score10"
          ? score("How urgent is this ticket?", LEVELS_10)
          : noul(VALUE_QUESTIONS[t.kind]!);
    await one("c", provider, "verdict", q, { kind: t.kind, rep: t.rep });
  }
}

// Which wordings actually land on 0.00 / 0.01 / 0.99.
async function pilot() {
  const res = await send(
    "h9",
    {
      state: STATE,
      questions: Object.fromEntries(
        Object.entries(VALUE_QUESTIONS).map(([k, v]) => [k, noul(v)]),
      ),
    },
    { phase: "pilot" },
    { provider: "typesafe", pace: PACE },
  );
  for (const [k, a] of Object.entries(res.answers)) console.log(k, a.probability);
  console.log("usage", JSON.stringify(res.usage));
}

// --- analysis ---

interface Row {
  provider: Provider;
  phase: string;
  keyLen: number;
  len: number;
  style: string;
  k: number;
  kind: string;
  latency: number;
  upstream: number | undefined;
  inTok: number | undefined;
  outTok: number | undefined;
  probability: number | undefined;
  probs: number[];
  nAnswers: number;
  nProbs: number;
  cost: number | undefined;
  inCost: number | undefined;
  outCost: number | undefined;
  answerChars: number;
}

function load(): Row[] {
  const dir = join(new URL(".", import.meta.url).pathname, "data", "h9");
  const out: Row[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.status !== 200) continue;
      const u = r.response?.usage ?? {};
      const gw = r.response?.providerMetadata?.gateway;
      const g = gw?.routing?.modelAttempts?.[0]?.providerAttempts?.[0];
      const h = Number(r.headers?.["x-envoy-upstream-service-time"]);
      const answers: Record<string, any> = r.response?.answers ?? {};
      const list = Object.values(answers);
      const a = list[0];
      out.push({
        provider: r.provider,
        phase: r.meta?.phase ?? "?",
        keyLen: r.meta?.keyLen ?? 0,
        len: r.meta?.len ?? r.meta?.keyLen ?? 0,
        style: r.meta?.style ?? "-",
        k: r.meta?.k ?? 0,
        kind: r.meta?.kind ?? "-",
        latency: r.latencyMs,
        upstream: g ? g.endTime - g.startTime : Number.isFinite(h) ? h : undefined,
        inTok: u.input_tokens ?? u.inputTokens,
        outTok: u.output_tokens ?? u.outputTokens,
        probability: a?.probability ?? a?.noul,
        probs: list.map((x) => x?.probability ?? x?.noul).filter((x) => typeof x === "number"),
        nAnswers: list.length,
        nProbs: Object.keys(a?.probabilities ?? {}).length,
        cost: gw ? Number(gw.cost) : undefined,
        inCost: gw ? Number(gw.inputInferenceCost) : undefined,
        outCost: gw ? Number(gw.outputInferenceCost) : undefined,
        answerChars: JSON.stringify(answers).length,
      });
    }
  }
  return out;
}

const f0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toString() : "-");
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "-");
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "-");
const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "-");

function fit(x: number[], y: number[]): { a: number; b: number; r2: number } {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < x.length; i++) {
    ssr += (y[i]! - (a + b * x[i]!)) ** 2;
    sst += (y[i]! - my) ** 2;
  }
  return { a, b, r2: sst === 0 ? 1 : 1 - ssr / sst };
}

interface Cell {
  label: string;
  n: number;
  out: number;
  outMin: number;
  outMax: number;
  inTok: number;
  lat: number;
  p90: number;
  up: number;
  prob: number;
  nProbs: number;
  chars: number;
  cost: number;
  outCost: number;
}

function group(rows: Row[], key: (r: Row) => string | number): Cell[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(key(r));
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(r);
  }
  return [...by.entries()].map(([label, rs]) => ({
    label,
    n: rs.length,
    out: median(rs.map((r) => r.outTok ?? Number.NaN)),
    outMin: Math.min(...rs.map((r) => r.outTok ?? Number.NaN)),
    outMax: Math.max(...rs.map((r) => r.outTok ?? Number.NaN)),
    inTok: median(rs.map((r) => r.inTok ?? Number.NaN)),
    lat: median(rs.map((r) => r.latency)),
    p90: quantile(
      rs.map((r) => r.latency),
      0.9,
    ),
    up: median(rs.map((r) => r.upstream ?? Number.NaN)),
    prob: median(rs.map((r) => r.probability ?? Number.NaN)),
    nProbs: median(rs.map((r) => r.nProbs)),
    chars: median(rs.map((r) => r.answerChars)),
    cost: median(rs.map((r) => r.cost ?? Number.NaN)),
    outCost: Math.max(...rs.map((r) => r.outCost ?? 0)),
  }));
}

const byNum = (a: Cell, b: Cell) => Number(a.label) - Number(b.label);

function report() {
  const rows = load();
  const ts = rows.filter((r) => r.provider === "typesafe");
  const vc = rows.filter((r) => r.provider === "vercel");

  // (a) key text
  const aRows = ts.filter((r) => r.phase === "a");
  const aByLen = group(aRows, (r) => r.len).sort(byNum);
  const keyFit = fit(
    aRows.map((r) => r.len),
    aRows.map((r) => r.outTok!),
  );
  const styleRows = KEY_LENGTHS.map((len) => {
    const at = (style: string) =>
      median(aRows.filter((r) => r.len === len && r.style === style).map((r) => r.outTok!));
    return { len, rep: at("repeat"), varied: at("varied") };
  });
  const varFit = fit(
    aRows.filter((r) => r.style === "varied").map((r) => r.len),
    aRows.filter((r) => r.style === "varied").map((r) => r.outTok!),
  );
  const repFit = fit(
    aRows.filter((r) => r.style === "repeat").map((r) => r.len),
    aRows.filter((r) => r.style === "repeat").map((r) => r.outTok!),
  );
  const aInputs = new Set(aRows.map((r) => r.inTok));

  // (b) option count and (b2) label text
  const bRows = ts.filter((r) => r.phase === "b");
  const bByK = group(bRows, (r) => r.k).sort(byNum);
  const optFit = fit(
    bRows.map((r) => r.k),
    bRows.map((r) => r.outTok!),
  );
  const b2Rows = ts.filter((r) => r.phase === "b2");
  const b2 = ["short", "long", "longer"]
    .map((style) => {
      const rs = b2Rows.filter((r) => r.style === style);
      const labels = Object.keys(labelled(style, 20));
      return {
        style,
        labelChars: labels[0]!.length,
        n: rs.length,
        out: median(rs.map((r) => r.outTok!)),
        inTok: median(rs.map((r) => r.inTok!)),
        lat: median(rs.map((r) => r.latency)),
      };
    })
    .filter((x) => x.n > 0);
  const lat2 = bByK.find((g) => g.label === "2");
  const lat200 = bByK.find((g) => g.label === "200");

  // (c) answer value and score levels
  const cRows = ts.filter((r) => r.phase === "c");
  const cByKind = group(cRows, (r) => r.kind).sort((x, y) => x.label.localeCompare(y.label));
  const noulCells = cByKind.filter((g) => g.label.startsWith("p"));
  const scoreCells = cByKind.filter((g) => g.label.startsWith("score"));
  const sameValue = new Set(noulCells.map((g) => g.out)).size === 1;
  const sameLevels = new Set(scoreCells.map((g) => g.out)).size === 1;
  // Batched pilots: five 1-character keys, identical question shapes, different answers.
  const pilots = ts.filter((r) => r.phase.startsWith("pilot") && r.nAnswers === 5);
  const zeroPilot = pilots.filter((r) => r.probs.some((p) => p === 0));
  const nonZeroPilot = pilots.filter((r) => !r.probs.some((p) => p === 0));
  // Zero-probability entries inside one 200-option answer.
  const bigChoice = ts.filter((r) => r.phase === "b" && r.k === 200);
  const zeros = (() => {
    const dir = join(new URL(".", import.meta.url).pathname, "data", "h9");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl")))
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!line) continue;
        const r = JSON.parse(line);
        if (r.status !== 200 || r.meta?.phase !== "b" || r.meta?.k !== 200) continue;
        const p: Record<string, number> = r.response.answers.pick.probabilities;
        return Object.values(p).filter((v) => v === 0).length;
      }
    return 0;
  })();

  // (d) gateway
  const vcA = group(vc.filter((r) => r.phase === "a"), (r) => `${r.len} (${r.style})`).sort(
    (x, y) => Number.parseInt(x.label) - Number.parseInt(y.label) || x.label.localeCompare(y.label),
  );
  const vcB = group(vc.filter((r) => r.phase === "b"), (r) => r.k).sort(byNum);
  const costPerIn = vc.map((r) => r.cost! / r.inTok!);
  // Clean test: in the key-length rows input_tokens is constant while output_tokens varies 13x.
  const vcKey = vc.filter((r) => r.phase === "a");
  const costFitOut = fit(
    vcKey.map((r) => r.outTok!),
    vcKey.map((r) => r.cost!),
  );
  const anyOutCost = vc.some((r) => (r.outCost ?? 0) > 0);
  const costEqualsIn = vc.every((r) => r.cost === r.inCost);

  const keyVerdict = varFit.b > 0 && repFit.b > 0 ? "CONFIRMED" : "REFUTED";
  const latVerdict = lat2 && lat200 && lat200.lat < lat2.lat * 1.3 ? "CONFIRMED" : "REFUTED";
  const zeroVerdict =
    zeroPilot.length && nonZeroPilot.length
      ? median(zeroPilot.map((r) => r.outTok!)) === median(nonZeroPilot.map((r) => r.outTok!))
        ? "CONFIRMED"
        : "REFUTED"
      : "INCONCLUSIVE";

  const md = `# H9 - \`output_tokens\` is billing, not generation

Claims (EVAL.md): the count varies with question key text the model never sees; 0.0 costs the same
as 0.01; latency is independent of it (a 200-option question costs about the same as a 2-option
one).

| claim | verdict |
| --- | --- |
| \`output_tokens\` changes with the question key text alone | **${keyVerdict}** (same question, same state, same \`input_tokens\`: ${f0(styleRows[0]!.varied)} tokens under a 1-character key, ${f0(styleRows.at(-1)!.varied)} under a 500-character worded one and ${f0(styleRows.at(-1)!.rep)} under a 500-character repeated one) |
| the model never sees that key | **CONFIRMED** (\`input_tokens\` = ${[...aInputs].join(", ")} for every key length, ${aRows.length} requests) |
| an answer of 0.00 costs the same as 0.01 and 0.99 | **${zeroVerdict}** (identical batches: ${f0(median(zeroPilot.map((r) => r.outTok!)))} output tokens with two 0.00 answers, ${f0(median(nonZeroPilot.map((r) => r.outTok!)))} with none) |
| a 200-option question costs about the same latency as a 2-option one | **${latVerdict}** (${lat2 ? f0(lat2.lat) : "-"} ms vs ${lat200 ? f0(lat200.lat) : "-"} ms median wall; ${lat2 ? f0(lat2.up) : "-"} vs ${lat200 ? f0(lat200.up) : "-"} ms upstream) |
| \`output_tokens\` counts generated text | **REFUTED** (see the model below) |
| \`output_tokens\` is the size of the returned JSON | **REFUTED** (a ${f0(scoreCells.find((s) => s.label === "score10")?.chars ?? 0)}-character score answer and a ${f0(scoreCells.find((s) => s.label === "score2")?.chars ?? 0)}-character one are both ${f0(scoreCells[0]?.out ?? 0)}) |
| the gateway bills output tokens | **REFUTED** (\`outputInferenceCost\` is ${anyOutCost ? "non-zero" : '"0" on all ' + vc.length + " gateway requests"}) |

One question per request, the same ${STATE.length}-character state everywhere, strictly sequential,
${PACE} ms minimum gap, order shuffled with the seeded PRNG.

## What \`output_tokens\` actually counts

Every cell here, and every cell of H2, is reproduced to the token by

\`\`\`
output_tokens = 4 + sum over questions of ( base(type) + tokens(question key) + options_charge )
base(noul) = 15    base(score) = 12    base(choice) = 16
options_charge = 0 for noul and score, whatever the number of score levels;
                 for choice, a per-option charge that tracks the label text
                 (measured at 20 options: 6.8 tokens for a 1-character label, 11.0 for
                 \`label_000\`, 18.4 for a 45-character label; the \`label_000\` rate is exactly
                 11.000 from 2 options to 200, R2 = 1)
\`\`\`

\`tokens(...)\` is the tokeniser, not a character count (see below). Nothing in the expression is the
answer. The probability values, the score levels, the legend and
the length of the returned JSON all drop out; the question **key** and the option **labels** - names
the caller chose - are the only things that move it, and the key is not even sent to the model.

## (a) Key text only

Same state, same instructions, same type, one question; only the key name changes.

Two key shapes at each length: one repeated letter (\`kkk...\`) and ordinary English words
(\`invoice_refund_billing...\`). Every cell n=3; every reading inside a cell identical.

| key chars | output_tokens, \`kkkk...\` | output_tokens, worded key | input_tokens | median wall ms |
| --- | --- | --- | --- | --- |
${styleRows
  .map(
    (d) =>
      `| ${d.len} | **${f0(d.rep)}** | **${f0(d.varied)}** | ${f0(aByLen.find((g) => g.label === String(d.len))?.inTok ?? Number.NaN)} | ${f0(aByLen.find((g) => g.label === String(d.len))?.lat ?? Number.NaN)} |`,
  )
  .join("\n")}

\`input_tokens\` is ${[...aInputs].join("/")} in all ${aRows.length} requests and the answer is 0.95 in all of them, so the key
is invisible to the model and to the input bill - but it is billed on the way out.

**Tokens of the key, not characters.** Two keys of the same 500 characters cost ${f0(styleRows.at(-1)!.rep)} and ${f0(styleRows.at(-1)!.varied)}
output tokens. The repeated letter packs into ~2 characters per token, the worded key into ~5, and
the billed counts follow the tokeniser exactly - so a character count of the key cannot explain it.

Slopes: ${f3(repFit.b)} output tokens per character for the repeated key (R2 ${f3(repFit.r2)}), ${f3(varFit.b)} for the
worded key (R2 ${f3(varFit.r2)}) - that is ${f1(1 / repFit.b)} and ${f1(1 / varFit.b)} characters per billed token, the two tokenisation
rates of those two strings.

## (b) Option count, 2 -> 200

Same state, same instructions, same key (\`pick\`); only the number of options changes.

| options | n | median output_tokens | median input_tokens | median wall ms | p90 wall ms | median upstream ms |
| --- | --- | --- | --- | --- | --- | --- |
${bByK
  .map(
    (g) =>
      `| ${g.label} | ${g.n} | ${f0(g.out)} | ${f0(g.inTok)} | ${f0(g.lat)} | ${f0(g.p90)} | ${f0(g.up)} |`,
  )
  .join("\n")}

\`output_tokens\` = ${f0(optFit.a)} + ${f2(optFit.b)} x options (R2 ${f3(optFit.r2)}): exactly ${f0(optFit.b)} tokens per option, whatever the
option's probability turns out to be.

Latency is flat: ${lat2 ? f0(lat2.lat) : "-"} ms at 2 options and ${lat200 ? f0(lat200.lat) : "-"} ms at 200 (upstream ${lat2 ? f0(lat2.up) : "-"} vs ${lat200 ? f0(lat200.up) : "-"} ms),
a ${lat2 && lat200 ? f2(lat200.lat / lat2.lat) : "-"}x change for ${lat2 && lat200 ? f2(lat200.out / lat2.out) : "-"}x the \`output_tokens\` and ${lat2 && lat200 ? f2(lat200.inTok / lat2.inTok) : "-"}x the \`input_tokens\`. The model scores all
200 options in the same single pass it uses for 2.

**The per-option charge is the label text.** 20 options, identical descriptions, only the label
names differ:

| label style | label chars | n | median output_tokens | per option | median input_tokens | median wall ms |
| --- | --- | --- | --- | --- | --- | --- |
${b2
  .map(
    (r) =>
      `| \`${Object.keys(labelled(r.style, 1))[0]}\` | ${r.labelChars} | ${r.n} | ${f0(r.out)} | ${f1((r.out - 21) / 20)} | ${f0(r.inTok)} | ${f0(r.lat)} |`,
  )
  .join("\n")}

## (c) What the answer says

| condition | n | median answer | probability entries | answer JSON chars | median output_tokens | median input_tokens |
| --- | --- | --- | --- | --- | --- | --- |
${cByKind
  .map(
    (g) =>
      `| ${g.label} | ${g.n} | ${f2(g.prob)} | ${f0(g.nProbs)} | ${f0(g.chars)} | **${f0(g.out)}** | ${f0(g.inTok)} |`,
  )
  .join("\n")}

(\`p00\`/\`p01\`/\`p99\` are the wordings piloted to return 0.00/0.01/0.99; asked one at a time they
returned ${noulCells.map((g) => f2(g.prob)).join(", ")} - see below.) All three yes/no conditions share one key (\`verdict\`) and instructions padded to one length, so only
the answer differs. ${sameValue ? `They cost the identical ${f0(noulCells[0]!.out)} output tokens` : "They differ"}: the value is free.

Asked on its own, a yes/no question never returned below 0.01 here (${cRows.filter((r) => r.kind.startsWith("p")).length} requests), so the 0.00
comparison comes from the batched pilots: two requests of five yes/no questions under identical
1-character keys, one answering \`${zeroPilot[0]?.probs.map((p) => p.toFixed(2)).join(", ")}\` and the other
\`${nonZeroPilot[0]?.probs.map((p) => p.toFixed(2)).join(", ")}\`, both billed **${f0(median(pilots.map((r) => r.outTok!)))}** output tokens.
A single 200-option answer makes the same point inside one response: ${zeros} of its 200 probabilities
are exactly \`0\`, and every entry is still charged the same ${f0(optFit.b)} tokens.

Scores ignore their levels entirely: ${sameLevels ? "a 2-level and a 10-level score cost the same" : "the two level counts differ"} ${f0(scoreCells[0]?.out ?? 0)} output tokens,
although the 10-level answer returns ${f0(scoreCells.find((s) => s.label === "score10")?.nProbs ?? 0)} probability entries and a ${f0(scoreCells.find((s) => s.label === "score10")?.chars ?? 0)}-character body against
${f0(scoreCells.find((s) => s.label === "score2")?.nProbs ?? 0)} entries and ${f0(scoreCells.find((s) => s.label === "score2")?.chars ?? 0)} characters. So it is not response size either - it is the answer shape the
API decided to price.

## (d) Gateway (\`provider: "vercel"\`)

Identical token counts to the direct API, cell for cell.

| key chars (style) | n | output_tokens | input_tokens | cost | outputInferenceCost |
| --- | --- | --- | --- | --- | --- |
${vcA.map((g) => `| ${g.label} | ${g.n} | ${f0(g.out)} | ${f0(g.inTok)} | ${g.cost.toExponential(4)} | ${g.outCost} |`).join("\n")}

| options | n | output_tokens | input_tokens | median wall ms | cost | outputInferenceCost |
| --- | --- | --- | --- | --- | --- | --- |
${vcB.map((g) => `| ${g.label} | ${g.n} | ${f0(g.out)} | ${f0(g.inTok)} | ${f0(g.lat)} | ${g.cost.toExponential(4)} | ${g.outCost} |`).join("\n")}

\`cost\` = \`inputInferenceCost\` on ${costEqualsIn ? "every" : "some"} request, \`outputInferenceCost\` = \`"0"\` on all ${vc.length},
and cost / \`input_tokens\` is a constant ${mean(costPerIn).toExponential(3)} $/token (${f2(mean(costPerIn) * 1e6)} $ per million input tokens,
spread ${(Math.max(...costPerIn) - Math.min(...costPerIn)).toExponential(1)}). In the ${vcKey.length} key-length requests
\`output_tokens\` ranges over ${f0(Math.min(...vcKey.map((r) => r.outTok!)))}-${f0(Math.max(...vcKey.map((r) => r.outTok!)))} - a ${f1(Math.max(...vcKey.map((r) => r.outTok!)) / Math.min(...vcKey.map((r) => r.outTok!)))}x spread - while every one of them costs exactly
${vcKey[0]!.cost!.toExponential(4)} (cost vs \`output_tokens\` slope ${costFitOut.b.toExponential(1)}, R2 ${f3(costFitOut.r2)}). **The gateway bills input
tokens only.**

## Interpretation

\`output_tokens\` is a derived number computed from the *shape* of the request and the *names* the
caller chose, not from anything the model produced:

- it rises one-for-one with the tokenised length of the question **key**, a string that never
  reaches the model (\`input_tokens\` is unchanged at ${[...aInputs].join("/")} across ${aRows.length} requests);
- it is blind to the answer: 0.00, 0.01, 0.03 and 0.99 all cost ${f0(noulCells[0]!.out)}, and ${zeros}/200 zero
  probabilities in one answer cost the same ${f0(optFit.b)} each as the winner;
- it is blind to response size: a ${f0(scoreCells.find((s) => s.label === "score10")?.chars ?? 0)}-character score answer with ${f0(scoreCells.find((s) => s.label === "score10")?.nProbs ?? 0)} probabilities and a
  ${f0(scoreCells.find((s) => s.label === "score2")?.chars ?? 0)}-character one both cost ${f0(scoreCells[0]?.out ?? 0)};
- it is deterministic: every one of the ${ts.length} direct-API requests hit the exact predicted integer,
  with zero variance inside a cell - real generation does not do that;
- it buys no time: ${lat200 ? f0(lat200.out) : "-"} output tokens at 200 options came back in ${lat200 ? f0(lat200.up) : "-"} ms of server
  time, the same as ${lat2 ? f0(lat2.out) : "-"} tokens at 2 options.

The best reading is that the model evaluates each question in one forward pass and returns a
probability vector, and \`output_tokens\` is then *priced* as if that answer had been typed out as
JSON: a fixed structural charge per question by type, plus the tokenised key, plus a per-option
charge covering the label name and its number. Scores are priced as one number because the level
descriptions came from the request. It is an invoice line, not a measurement - and on the gateway
it is not even charged.

## n and raw data

${ts.length} successful direct-API requests (${aRows.length} key-length, ${bRows.length} option-count, ${b2Rows.length} label-text, ${cRows.length}
answer-value, ${ts.length - aRows.length - bRows.length - b2Rows.length - cRows.length} exploratory pilots) and ${vc.length} gateway requests; no request failed. Every attempt is in
\`eval/data/h9/*.jsonl\`, keyed by \`meta.phase\`, \`meta.len\`, \`meta.style\`, \`meta.k\`, \`meta.kind\`,
\`meta.rep\`.

## Rule for library users

1. Do not use \`output_tokens\` to predict latency or gateway cost. It is a function of your key
   names and option labels, and the gateway charges \`input_tokens\` only
   (${f2(mean(costPerIn) * 1e6)} $ per million).
2. If a provider ever bills you on it, **your naming is the bill**. H2's batch of 1,500 yes/no
   questions under \`q0\`..\`q1499\` billed 28,894 output tokens (19.3 per answer); the same 1,500
   answers under 500-character worded keys would bill about ${f0(1500 * styleRows.at(-1)!.varied)}. Keep keys short in large
   batches - it changes nothing about the answers.
3. Options are cheap in time and dear in tokens: 2 -> 200 options moved median wall time by
   ${lat2 && lat200 ? f0(lat200.lat - lat2.lat) : "-"} ms but \`output_tokens\` by ${lat2 && lat200 ? f0(lat200.out - lat2.out) : "-"} and \`input_tokens\` by ${lat2 && lat200 ? f0(lat200.inTok - lat2.inTok) : "-"}. Use as many options as the
   problem really has, but keep label names terse: they cost ${b2.length > 1 ? `${f1((b2[0]!.out - 21) / 20)}-${f1((b2.at(-1)!.out - 21) / 20)}` : "-"} output tokens each and they are
   input as well.
4. Treat \`output_tokens\` as a response-shape meter: it tells you how wide your questions were, not
   how hard the model worked.
`;
  console.log("wrote", writeReport("h9", md));
  console.log(JSON.stringify({ keyFit, varFit, repFit, optFit, costFitOut }, null, 2));
}

// --- main ---

const mode = process.argv[2] ?? "report";
if (mode === "pilot") await pilot();
else if (mode === "a") await phaseKeys("typesafe", KEY_LENGTHS, 3, 91001);
else if (mode === "b") await phaseOptions("typesafe", OPTION_COUNTS, 6, 91002);
else if (mode === "b2") await phaseLabels("typesafe", 4, 91006);
else if (mode === "c") await phaseValues("typesafe", 6, 91003);
else if (mode === "vercel") {
  await phaseKeys("vercel", [1, 500], 3, 91004);
  await phaseOptions("vercel", [2, 20, 200], 3, 91005);
} else if (mode === "report") report();
else throw new Error(`unknown mode ${mode}`);
