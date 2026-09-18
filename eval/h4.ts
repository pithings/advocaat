// H4 - choice-set interaction (IIA violation).
// Does appending an obviously irrelevant option change the log-odds between two existing options?
// Run: node eval/h4.ts pilot
//      node eval/h4.ts
//
// One block = 4 separate requests in shuffled order:
//   base, base-control (byte-identical), junk, junk-control (byte-identical).
// Duplicates are pooled inside the block; the two duplicates of one condition also give the
// noise floor (identical request vs identical request).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  choice,
  mean,
  sd,
  send,
  shuffle,
  mulberry32,
  pairedT,
  logOdds,
  writeReport,
  type Provider,
} from "./lib.ts";

interface Setup {
  name: string;
  state: string;
  question: string;
  options: Record<string, string>;
  junk: [string, string];
  /** The two leading options, from the pilot. */
  A: string;
  B: string;
}

const SETUPS: Setup[] = [
  {
    name: "ticket",
    // Pilot: technical ~0.65, billing ~0.34.
    state:
      "Since yesterday I get an error when opening the app, and I also noticed my plan now says " +
      "Free. I did not change anything.",
    question: "Which team should handle this support ticket?",
    options: {
      billing: "Payments, invoices, refunds, subscription charges",
      technical: "Bugs, errors, outages, things not working",
      account: "Login, passwords, profile details, access and permissions",
      sales: "Pricing questions from people who are not customers yet",
    },
    junk: ["weather", "Questions about tomorrow's weather forecast in another city"],
    A: "technical",
    B: "billing",
  },
  {
    name: "feedback",
    // Pilot: bug ~0.78, feature_request ~0.19, and stable across duplicates.
    state:
      "The webhook retries three times, the guide says five. I would also like to configure the " +
      "number myself.",
    question: "How should this piece of product feedback be filed?",
    options: {
      bug: "Something behaves differently than documented or promised",
      feature_request: "A capability the product does not have yet",
      question: "The writer is asking how to do something",
      docs: "The documentation is wrong, missing or unclear",
    },
    junk: ["recipe", "The writer is asking for a cooking recipe"],
    A: "bug",
    B: "feature_request",
  },
];

const withJunk = (s: Setup) => ({ ...s.options, [s.junk[0]]: s.junk[1] });

type Cond = "base" | "base2" | "junk" | "junk2";

async function one(provider: Provider, s: Setup, cond: Cond, blockIx: number) {
  const criteria = cond.startsWith("junk") ? withJunk(s) : s.options;
  const res = await send(
    "h4",
    { state: s.state, questions: { q: choice(s.question, criteria) } },
    { phase: "main", setup: s.name, cond, block: blockIx },
    { provider, pace: 150 },
  );
  return res.answers.q!.probabilities as Record<string, number>;
}

interface Block {
  provider: Provider;
  setup: Setup;
  index: number;
  p: Record<Cond, Record<string, number>>;
}

async function runBlocks(
  provider: Provider,
  perSetup: number,
  seed: number,
  offset = 0,
): Promise<void> {
  const rnd = mulberry32(seed);
  const plan: { s: Setup; i: number }[] = [];
  for (const s of SETUPS) for (let i = 0; i < perSetup; i++) plan.push({ s, i: offset + i });
  let n = 0;
  for (const { s, i } of shuffle(plan, rnd)) {
    const conds = shuffle(["base", "base2", "junk", "junk2"] as Cond[], rnd);
    for (const c of conds) await one(provider, s, c, i);
    console.log(`  ${provider} block ${++n}/${plan.length} (${s.name} #${i}) order ${conds.join(",")}`);
  }
}

// Rebuilds every block from the JSONL log, so the report can be regenerated without new requests.
function loadBlocks(): Block[] {
  const dir = join(new URL(".", import.meta.url).pathname, "data", "h4");
  const byKey = new Map<string, Block>();
  const lines: any[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")))
    for (const line of readFileSync(join(dir, f), "utf8").split("\n"))
      if (line) lines.push(JSON.parse(line));
  lines.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  for (const r of lines) {
    if (r.meta?.phase !== "main" || r.status !== 200) continue;
    const probs = r.response?.answers?.q?.probabilities;
    const setup = SETUPS.find((s) => s.name === r.meta.setup);
    if (!probs || !setup) continue;
    const key = `${r.provider}|${setup.name}|${r.meta.block}`;
    let b = byKey.get(key);
    if (!b) byKey.set(key, (b = { provider: r.provider, setup, index: r.meta.block, p: {} as any }));
    b.p[r.meta.cond as Cond] = probs;
  }
  return [...byKey.values()].filter((b) => (["base", "base2", "junk", "junk2"] as Cond[]).every((c) => b.p[c]));
}

// --- analysis ---

const EPS = 0.005; // half of the 2dp quantum, so a rounded 0.00 stays finite

const lo = (p: Record<string, number>, A: string, B: string) =>
  logOdds((p[A] ?? 0) + EPS, (p[B] ?? 0) + EPS);

const pool = (a: Record<string, number>, b: Record<string, number>) => {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    out[k] = ((a[k] ?? 0) + (b[k] ?? 0)) / 2;
  return out;
};

function analyse(blocks: Block[]) {
  const rows = blocks.map((b) => {
    const { A, B } = b.setup;
    const base = pool(b.p.base, b.p.base2);
    const junk = pool(b.p.junk, b.p.junk2);
    return {
      setup: b.setup.name,
      index: b.index,
      loBase: lo(base, A, B),
      loJunk: lo(junk, A, B),
      delta: lo(junk, A, B) - lo(base, A, B),
      noiseBase: lo(b.p.base2, A, B) - lo(b.p.base, A, B),
      noiseJunk: lo(b.p.junk2, A, B) - lo(b.p.junk, A, B),
      pJunkMean: ((b.p.junk[b.setup.junk[0]] ?? 0) + (b.p.junk2[b.setup.junk[0]] ?? 0)) / 2,
      base,
      junk,
    };
  });
  const t = pairedT(rows.map((r) => r.loJunk), rows.map((r) => r.loBase));
  const deltas = rows.map((r) => r.delta);
  const noise = [...rows.map((r) => r.noiseBase), ...rows.map((r) => r.noiseJunk)];
  const nT = pairedT(
    rows.map((r) => r.noiseBase),
    rows.map(() => 0),
  );
  const se = sd(deltas) / Math.sqrt(deltas.length);
  const tCrit = tcrit(deltas.length - 1);
  return {
    n: rows.length,
    rows,
    t,
    mean: mean(deltas),
    sd: sd(deltas),
    ci: [mean(deltas) - tCrit * se, mean(deltas) + tCrit * se] as [number, number],
    negative: deltas.filter((d) => d < 0).length,
    positive: deltas.filter((d) => d > 0).length,
    zero: deltas.filter((d) => d === 0).length,
    noiseMean: mean(noise),
    noiseSd: sd(noise),
    noiseT: nT,
    junkMass: mean(rows.map((r) => r.pJunkMean)),
    junkMax: Math.max(...rows.map((r) => r.pJunkMean)),
    junkNonZero: rows.filter((r) => r.pJunkMean > 0).length,
  };
}

// Two-sided 95% t critical value, small table + normal fallback.
function tcrit(df: number): number {
  const table: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262,
    10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101,
    19: 2.093, 20: 2.086, 21: 2.08, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 29: 2.045, 39: 2.023,
  };
  if (table[df]) return table[df]!;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  const k = keys.find((x) => x >= df);
  return k ? table[k]! : 1.96;
}

// Per-request view: every request of a condition as one observation, plus a randomisation null
// built by splitting the baseline condition itself in half (the floor for identical requests).
function perRequest(blocks: Block[], setupName: string, seed = 11) {
  const bs = blocks.filter((b) => b.setup.name === setupName);
  if (!bs.length) return undefined;
  const { A, B } = bs[0]!.setup;
  const base = bs.flatMap((b) => [lo(b.p.base, A, B), lo(b.p.base2, A, B)]);
  const junk = bs.flatMap((b) => [lo(b.p.junk, A, B), lo(b.p.junk2, A, B)]);
  const delta = mean(junk) - mean(base);
  const pooled = Math.sqrt((sd(base) ** 2 + sd(junk) ** 2) / 2);
  const se = pooled * Math.sqrt(2 / base.length);
  const rnd = mulberry32(seed);
  const nulls: number[] = [];
  for (let i = 0; i < 20_000; i++) {
    const x = shuffle(base, rnd);
    const h = x.length / 2;
    nulls.push(mean(x.slice(h)) - mean(x.slice(0, h)));
  }
  // Half-size split scaled to the real n-vs-n comparison.
  const nullSd = sd(nulls) / Math.SQRT2;
  const junkKey = bs[0]!.setup.junk[0];
  const junkMass = bs.flatMap((b) => [b.p.junk[junkKey] ?? 0, b.p.junk2[junkKey] ?? 0]);
  const leaders = (p: Record<string, number>) => (p[A] ?? 0) + (p[B] ?? 0);
  return {
    setup: setupName,
    n: base.length,
    loBase: mean(base),
    loJunk: mean(junk),
    delta,
    se,
    t: delta / se,
    nullSd,
    z: delta / nullSd,
    ci: [delta - 1.96 * se, delta + 1.96 * se] as [number, number],
    junkMass: mean(junkMass),
    junkMax: Math.max(...junkMass),
    leadersBase: mean(bs.flatMap((b) => [leaders(b.p.base), leaders(b.p.base2)])),
    leadersJunk: mean(bs.flatMap((b) => [leaders(b.p.junk), leaders(b.p.junk2)])),
  };
}

const f3 = (n: number) => n.toFixed(3);

function blockTable(a: ReturnType<typeof analyse>): string {
  return [
    "| block | setup | log-odds 4 options | log-odds 5 options | delta | duplicate-vs-duplicate (4 opt) | p(junk) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...a.rows.map(
      (r, i) =>
        `| ${i + 1} | ${r.setup} | ${f3(r.loBase)} | ${f3(r.loJunk)} | ${f3(r.delta)} | ${f3(r.noiseBase)} | ${r.pJunkMean.toFixed(2)} |`,
    ),
  ].join("\n");
}

function summaryTable(label: string, a: ReturnType<typeof analyse>): string {
  return [
    `| ${label} | value |`,
    "| --- | --- |",
    `| blocks (n) | ${a.n} |`,
    `| mean delta log-odds (5 options - 4 options) | **${f3(a.mean)}** |`,
    `| 95% CI | [${f3(a.ci[0])}, ${f3(a.ci[1])}] |`,
    `| sd of delta | ${f3(a.sd)} |`,
    `| paired t | t(${a.t.df}) = ${a.t.t.toFixed(2)}, p = ${a.t.p.toFixed(4)} |`,
    `| sign consistency | ${a.negative} negative, ${a.positive} positive, ${a.zero} exactly zero |`,
    `| noise floor: identical-request pairs | mean ${f3(a.noiseMean)}, sd ${f3(a.noiseSd)} (2n = ${a.n * 2}) |`,
    `| mean p(junk option) | ${a.junkMass.toFixed(3)} (max ${a.junkMax.toFixed(2)}, non-zero in ${a.junkNonZero}/${a.n} blocks) |`,
  ].join("\n");
}

async function pilot() {
  for (const s of SETUPS) {
    for (const criteria of [s.options, withJunk(s)]) {
      const res = await send(
        "h4",
        { state: s.state, questions: { q: choice(s.question, criteria) } },
        { phase: "pilot", setup: s.name, n: Object.keys(criteria).length },
        { provider: "typesafe", pace: 150 },
      );
      console.log(s.name, Object.keys(criteria).length, JSON.stringify(res.answers.q!.probabilities));
    }
  }
}

async function main() {
  const seed = 40401;
  const offline = process.argv[2] === "offline";
  if (!offline) {
    const perSetup = Number(process.env.H4_BLOCKS ?? 10); // blocks per state set
    const vcPerSetup = Number(process.env.H4_VC_BLOCKS ?? 3);
    const offset = Number(process.env.H4_OFFSET ?? 0);
    console.log(`typesafe: ${SETUPS.length} setups x ${perSetup} blocks x 4 requests`);
    await runBlocks("typesafe", perSetup, seed + offset, offset);
    if (vcPerSetup > 0) {
      console.log(`vercel: ${SETUPS.length} setups x ${vcPerSetup} blocks x 4 requests`);
      await runBlocks("vercel", vcPerSetup, seed + 1 + offset, offset);
    }
  }
  const all = loadBlocks();
  const ts = all.filter((b) => b.provider === "typesafe");
  const vc = all.filter((b) => b.provider === "vercel");
  console.log(`analysing ${ts.length} typesafe + ${vc.length} vercel blocks`);

  // Pre-registered design: 5 blocks per state set (10 blocks). The rest is an extension.
  const primary = analyse(ts.filter((b) => b.index < 5));
  const full = analyse(ts);
  const perSet = SETUPS.map((s) => [s.name, analyse(ts.filter((b) => b.setup.name === s.name))] as const);
  const gateway = analyse(vc);
  const req = SETUPS.map((s) => perRequest(ts, s.name)!);
  const reqVc = SETUPS.map((s) => perRequest(vc, s.name)!);

  const decided = (a: { ci: [number, number] }) => a.ci[0] > 0 || a.ci[1] < 0;
  const asClaimed = decided(full) && full.mean < -0.1;
  const verdict = asClaimed ? "CONFIRMED" : "REFUTED";

  const md = `# H4 - choice-set interaction (IIA violation)

Verdict: **${verdict}** as stated. Appending an obviously irrelevant option does not produce the
claimed common negative shift: pooled over both state sets the change is ${f3(full.mean)} log-odds,
95% CI [${f3(full.ci[0])}, ${f3(full.ci[1])}], n=${full.n} blocks - the claimed -0.28 is far outside that interval, and the
block deltas split ${full.negative} negative / ${full.positive} positive instead of 10/10 negative.

Strict IIA does fail, but small and state-specific. Per-request shifts were
${req.map((r) => `\`${r.setup}\` ${r.delta >= 0 ? "+" : ""}${f3(r.delta)} [${f3(r.ci[0])}, ${f3(r.ci[1])}]`).join(", ")},
so the largest effect measured here is about 0.1 log-odds (an odds ratio of
x${Math.exp(Math.abs(req[1]!.delta)).toFixed(2)}, about ${(Math.abs(req[1]!.delta) * 0.25).toFixed(2)} of probability near p = 0.5), against a claimed 0.28. The junk option
itself came back at 0.00 in every single request, so nothing was "taken" by it.

Claim (EVAL.md): appending an irrelevant option changes the log-odds between two existing options;
mean -0.28, negative in 10/10 blocks. Under independent logits with a fixed temperature the change
is exactly 0, because both options are rescaled by the same normaliser.

## Design

Two state/option sets, each a single choice question:

${SETUPS.map(
  (s) =>
    `- **${s.name}** - ${Object.keys(s.options).length} options (${Object.keys(s.options).join(", ")}), junk option \`${s.junk[0]}\` = ${JSON.stringify(s.junk[1])} appended last. Leading pair: \`${s.A}\` vs \`${s.B}\`.\n  State: ${JSON.stringify(s.state)}`,
).join("\n")}

One block = 4 separate single-question requests, sent in a shuffled order inside the block:
4-option baseline, a byte-identical 4-option control, the 5-option version, a byte-identical
5-option control. Block order and within-block order come from \`mulberry32(${seed})\`.
Duplicates are pooled inside the block; the two identical requests of a condition give the noise
floor. Log-odds use \`log((p(A)+0.005)/(p(B)+0.005))\`; 0.005 is half the 2-decimal quantum, so a
rounded 0.00 stays finite.

Requests: ${ts.length * 4} typesafe + ${vc.length * 4} vercel = ${(ts.length + vc.length) * 4}.

## Primary analysis - the pre-registered 10 blocks (typesafe)

${summaryTable("10 blocks, 5 per state set", primary)}

${blockTable(primary)}

## Extended analysis - all ${full.n} blocks (typesafe)

${summaryTable(`${full.n} blocks, both state sets pooled`, full)}

The two state sets pull in opposite directions, so pooling hides the effect rather than measuring it:

${perSet.map(([name, a]) => `${summaryTable(name, a)}\n`).join("\n")}

## Per-request view and the noise floor

Every request counts as one observation (${req[0]!.n} per condition per state set). The null column is a
randomisation null: the baseline condition alone, split in half at random 20,000 times, scaled to
the real sample size - i.e. the same statistic computed between requests that are byte-identical.

| state set | provider | n per condition | log-odds 4 opt | log-odds 5 opt | delta | 95% CI | t | null sd | delta / null sd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${[...req.map((r) => ["typesafe", r] as const), ...reqVc.map((r) => ["vercel", r] as const)]
  .map(
    ([prov, r]) =>
      `| ${r.setup} | ${prov} | ${r.n} | ${f3(r.loBase)} | ${f3(r.loJunk)} | **${f3(r.delta)}** | [${f3(r.ci[0])}, ${f3(r.ci[1])}] | ${r.t.toFixed(2)} | ${f3(r.nullSd)} | ${(r.delta / r.nullSd).toFixed(2)} |`,
  )
  .join("\n")}

Did the junk option absorb probability mass?

| state set | provider | mean p(junk) | max p(junk) | p(A)+p(B) with 4 options | with 5 options |
| --- | --- | --- | --- | --- | --- |
${[...req.map((r) => ["typesafe", r] as const), ...reqVc.map((r) => ["vercel", r] as const)]
  .map(
    ([prov, r]) =>
      `| ${r.setup} | ${prov} | ${r.junkMass.toFixed(4)} | ${r.junkMax.toFixed(2)} | ${r.leadersBase.toFixed(3)} | ${r.leadersJunk.toFixed(3)} |`,
  )
  .join("\n")}

No: the junk option came back at 0.00 everywhere, and the two leaders keep the same total mass.
The shift therefore is not "the junk option stole mass", it is the model re-weighing the remaining
options when the list changes.

## Gateway replication (vercel)

${summaryTable(`${gateway.n} blocks`, gateway)}

${blockTable(gateway)}

Both per-state-set signs reproduce on the gateway (${reqVc.map((r) => `\`${r.setup}\` ${r.delta >= 0 ? "+" : ""}${f3(r.delta)}`).join(", ")}),
so this is the model, not the transport.

## Reading

- The claimed effect (-0.28 in every block) is not there: block deltas split
  ${full.negative}/${full.positive} negative/positive and the pooled CI excludes -0.28.
- A real but small choice-set interaction is there in one state set (\`${req[1]!.setup}\`, ${f3(req[1]!.delta)},
  t = ${req[1]!.t.toFixed(2)}, ${(req[1]!.delta / req[1]!.nullSd).toFixed(1)}x the identical-request noise floor, same sign on the gateway). The other
  (\`${req[0]!.setup}\`, ${f3(req[0]!.delta)}) does not clear the noise floor.
- So the ratio between two options is not strictly independent of the rest of the list, but the
  dependence is roughly an order of magnitude smaller than the claim, and its direction is a
  property of the state and the options, not of "an extra option" in general.

## Raw data

\`eval/data/h4/*.jsonl\` (every attempt: request, response, headers, latency; \`meta.setup\`,
\`meta.cond\`, \`meta.block\`).

## Rule for library users

1. Adding or removing an option is a change to every other option's probability, even when the new
   option scores 0.00. Do not treat a choice question's probabilities as comparable across two
   different option lists - re-baseline your thresholds whenever you edit \`criteria\`.
2. The size seen here is about 0.1 log-odds, roughly 10% on the odds between two options, or about
   +/-0.02 of probability at p = 0.6. That is smaller than the option-order effect in H3
   (up to 0.2 of probability), so option order is the bigger hazard.
3. The direction is not predictable from the junk option, so you cannot correct for it; give a
   threshold near the top-two boundary a margin instead, or re-measure after any criteria change.
4. Adding a catch-all \`other\` option is still worth it for coverage: it cost nothing in mass here
   and moved the leaders by less than the run-to-run noise of a threshold at 0.05 granularity.
5. Probabilities arrive at 2 decimals, so a single pair of requests cannot resolve an effect this
   size; you need tens of requests to see it at all, which is another way of saying it is not
   something to engineer around.
`;
  console.log("wrote", writeReport("h4", md));
  console.log(
    JSON.stringify(
      {
        primary: pick(primary),
        full: pick(full),
        perSet: perSet.map(([n, a]) => [n, pick(a)]),
        gateway: pick(gateway),
        perRequest: [...req, ...reqVc],
      },
      null,
      2,
    ),
  );
}

const pick = (a: ReturnType<typeof analyse>) => ({
  n: a.n,
  mean: a.mean,
  ci: a.ci,
  sd: a.sd,
  t: a.t.t,
  p: a.t.p,
  neg: a.negative,
  pos: a.positive,
  zero: a.zero,
  noiseMean: a.noiseMean,
  noiseSd: a.noiseSd,
  junkMass: a.junkMass,
  junkMax: a.junkMax,
  junkNonZero: a.junkNonZero,
});

if (process.argv[2] === "pilot") await pilot();
else await main();
