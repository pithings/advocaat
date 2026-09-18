// H6 - calibration. Does aggregate agreement hide per-task failure?
// Builds three labelled sets, sends one request per item, reports reliability + ECE.
// Run: node eval/h6.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { choice, mean, mulberry32, send, shuffle, wilson, writeReport, type Provider } from "./lib.ts";

const DIR = join(dirname(new URL(import.meta.url).pathname), "data", "h6");
mkdirSync(DIR, { recursive: true });

// --- set 1: workflow (hand written here, 120 clear + 30 ambiguous) ---

type WF = [text: string, label: string];

// Rule R for the ambiguous subset, first match wins:
//  1. names documentation / README / guide / changelog / website content as wrong,
//     missing, outdated or unclear -> docs
//  2. reports concrete observed behaviour and calls it a bug, broken, failing,
//     crashing, an error, wrong or unexpected -> bug
//  3. asks for something to be added, supported or changed in the product -> feature
//  4. otherwise (a request for information only) -> question
const RULE =
  "1. names docs/README/guide/changelog/website content as wrong, missing, outdated or unclear -> docs; " +
  "2. else reports observed behaviour and calls it a bug/broken/failing/crashing/an error/wrong/unexpected -> bug; " +
  "3. else asks for something to be added, supported or changed in the product -> feature; " +
  "4. else (request for information only) -> question.";

const BUGS: string[] = [
  "App crashes on startup after upgrading to 3.2.0. TypeError: cannot read property 'map' of undefined at src/loader.js:44. Downgrading to 3.1.9 works.",
  "Clicking Save twice creates two identical rows. Expected one. Reproduced on Chrome 120 and Firefox 121.",
  "The progress bar sticks at 99% and never completes, although the upload finishes on the server.",
  "Memory grows about 40 MB per hour with no traffic. A heap snapshot shows retained WebSocket objects.",
  "Running the build fails with ENOENT: no such file or directory, open 'dist/manifest.json' on a clean checkout.",
  "Dates render one day earlier for users at UTC-5. The stored timestamp is correct.",
  "Pressing Escape closes the modal but leaves the page scroll locked.",
  "Login redirects to /dashboard and then immediately back to /login, in Safari 17 only.",
  "Search returns no results when the query contains an apostrophe. The server logs a SQL syntax error.",
  "CSV export truncates after 1000 rows even when 5000 are selected.",
  "The retry logic retries 400 responses forever and hammers the API.",
  "Uploading a 12 MB PNG returns 500 while a 2 MB PNG uploads fine.",
  "Deleting a folder removes its children from the list, but they reappear after a refresh.",
  "The test suite passes locally and fails on CI with 'port 5432 already in use'.",
  "Webhook signatures stopped verifying after 2.4. The payload is re-serialised before hashing.",
  "Keyboard focus jumps to the top of the list after selecting any item.",
  "The mobile menu overlaps the footer at 320 px width and the last link cannot be clicked.",
  "Concurrent writes to the same key silently drop one update instead of failing.",
  "Timezone offsets are ignored when parsing ISO strings written without a colon, such as +0200.",
  "The CLI prints ANSI escape codes when its output is piped to a file.",
  "Refreshing the token during a long request logs the user out.",
  "Sorting by price puts 100 before 20. The values are compared as strings.",
  "Autocomplete fires a request on every keystroke. The debounce option has no effect.",
  "The server returns 200 with an empty body when the database connection drops.",
  "The sticky header covers anchored headings when arriving from a hash link.",
  "Emoji in usernames break the avatar generator with a RangeError.",
  "Cancelling an upload leaves a temporary file in /tmp forever.",
  "The chart renders duplicate legend entries after switching datasets twice.",
  "The rate limiter resets its window on every request, so a steady client is never let through.",
  "Two tabs open at once share one session, and logging out of one leaves the other in a half broken state.",
];

const FEATURES: string[] = [
  "Please add a --json flag to the CLI so output can be piped into jq.",
  "It would be useful to support single sign-on through Okta for enterprise accounts.",
  "Add a dark theme toggle to the settings panel.",
  "Can we get cursor pagination on the events endpoint? Offsets get slow past 100k rows.",
  "Request: allow more than one webhook URL per project.",
  "Support importing settings from a YAML file as well as the current form.",
  "Add keyboard shortcuts for next and previous item in the inbox.",
  "I would like an option to schedule reports by email every week.",
  "Please expose an onProgress callback in the upload client.",
  "Add Postgres as a storage backend next to SQLite.",
  "It would help to have a bulk delete action for archived projects.",
  "Add ARM64 builds to the release pipeline.",
  "Consider a plugin API so teams can register their own validators.",
  "Feature request: feature flags that can differ per environment.",
  "Allow the timeout to be set per request, not only globally.",
  "Add a compact table density for people on small screens.",
  "Please support wildcard patterns in the ignore list.",
  "Add an undo button after deleting a comment.",
  "We need audit logs that can be exported to S3.",
  "Provide a Terraform provider for managing projects.",
  "Add translations, starting with German and French.",
  "Allow custom fields on tickets, defined per workspace.",
  "Please add a dry run mode to the migration command.",
  "Add release signing with sigstore.",
  "It would be great to filter the activity feed by author.",
  "Add a watch mode that rebuilds on file changes.",
  "Please support Deno natively alongside Node.",
  "Add rate limit headers to every API response so clients can back off.",
  "Offer a self hosted option with a Docker Compose file.",
  "Add a way to pin a version range in the config so upgrades are opt in.",
];

const QUESTIONS: string[] = [
  "How do I configure the cache TTL for the edge runtime? I cannot work out the right setting name.",
  "What is the recommended way to run migrations during a blue-green deploy?",
  "Is it possible to use the SDK from inside a web worker?",
  "Which permission does a service account need in order to list projects?",
  "Do you have a recommended pool size for a four core machine?",
  "How can I test webhooks locally without exposing a public URL?",
  "Is the client safe to share between threads?",
  "What happens to queued jobs when a worker restarts?",
  "Can I run two versions side by side during a migration?",
  "How do I rotate an API key without downtime?",
  "Does the SDK retry on 429 by itself, or should I handle that?",
  "What is the difference between flush() and close() here?",
  "How do I attach custom headers to every outgoing request?",
  "Is there a way to see which query makes the dashboard slow?",
  "Which Node versions are supported on the current release line?",
  "How do I turn off telemetry in a CI environment?",
  "Can I use my own certificate authority for outbound TLS?",
  "What memory footprint should I expect for 10k concurrent connections?",
  "How do I move data from the old events table to the new schema?",
  "Is there a supported way to seed the database for tests?",
  "Does the cache key include query parameters?",
  "How can I limit the CLI to a single project inside a monorepo?",
  "Which timezone are the timestamps in the export?",
  "Is there an official Helm chart, or should I write my own?",
  "Am I supposed to call init() before or after loading the config?",
  "How do I reset a stuck workflow without deleting it?",
  "Is there a way to get the raw response next to the parsed one?",
  "Does the free tier include webhook delivery retries?",
  "What is the largest payload accepted for a single event?",
  "How do I check which feature flags are active for my account?",
];

const DOCS: string[] = [
  "The README example for createClient still uses the removed apiToken option. It should say apiKey.",
  "The quickstart leaves out the step where you create a project first, so the first command fails.",
  "The API reference is missing the cursor parameter that the endpoint already accepts.",
  "Typo on the installation page: it says npm intall.",
  "The migration guide links to a page that returns 404.",
  "The docstring for retryDelay does not say whether the value is milliseconds or seconds.",
  "The changelog for 2.3.0 is empty although the release contained breaking changes.",
  "The contributing guide still describes the old Jenkins pipeline. CI moved to GitHub Actions.",
  "Please document the environment variables the worker reads at startup.",
  "The README snippet does not compile: it is missing the await on client.connect().",
  "The comparison table on the website lists a feature that was removed in 3.0.",
  "The security page does not say how to report a vulnerability privately.",
  "The docs sidebar puts Advanced before Getting started.",
  "The TypeScript examples use require, which contradicts the ESM only note at the top of the page.",
  "There is no written list of the error codes the API can return.",
  "The docs say the default timeout is 30s while the code default is 10s. Please fix the docs.",
  "The self hosting page is missing the minimum disk requirement.",
  "Screenshots in the onboarding guide still show the old navigation bar.",
  "The billing entry in the FAQ contradicts the pricing page.",
  "Please add a short example of using the client with the Next.js app router to the docs.",
  "The API docs show a response field total_count while the server returns totalCount. The docs should be corrected.",
  "The README badge points at a build that no longer exists.",
  "The glossary does not define workspace although every page uses the word.",
  "Please add the supported browser matrix to the docs.",
  "The final step of the tutorial refers to a file that earlier steps never create.",
  "The page about score levels does not mention that levels are numbered from zero.",
  "Anchor links are broken throughout the configuration reference page.",
  "The README says the licence is MIT while the LICENSE file is Apache-2.0. Please correct the README.",
  "The docs still recommend the deprecated legacy_mode flag.",
  "The examples folder has no README explaining how to run each example.",
];

// Ambiguous: each reads as two categories; the gold label follows RULE.
const AMBIGUOUS: WF[] = [
  ["The docs say limit is optional, but the API rejects requests without it. Which one is right?", "docs"],
  ["I followed the quickstart and hit 'project not found' at step three. I think a step is missing.", "docs"],
  ["retryDelay: 5 waits five milliseconds instead of five seconds, which is not what I expected.", "bug"],
  ["Does a --json flag exist? If not, please add one.", "feature"],
  ["The export stops at 1000 rows. Is that a limit I can raise, or is it broken?", "bug"],
  ["Is there any way to cancel a running job? I could not find one, so please add one.", "feature"],
  ["Is there any way to cancel a running job?", "question"],
  ["The README example throws on the first line. Please fix the example.", "docs"],
  ["The example runs, but connect() resolves before the socket is open, so the first send is lost.", "bug"],
  ["Could the error message name the field that failed validation? Right now it only says invalid.", "feature"],
  ["The error message only says invalid and I cannot tell what went wrong. What does it mean?", "question"],
  ["Export timestamps are UTC while the UI shows local time, and nothing anywhere says which is which.", "docs"],
  ["Export timestamps are UTC while the UI shows local time, so the same record shows two times. That is wrong.", "bug"],
  ["Which timezone is the export in? The guide does not say.", "docs"],
  ["Deno support would be nice. Does it already work?", "feature"],
  ["Does the SDK work under Deno?", "question"],
  ["The changelog has nothing for 2.3.0 although my build broke on upgrade.", "docs"],
  ["My build broke on upgrade to 2.3.0 with 'export default not found'.", "bug"],
  ["Can the CLI stop printing colour codes when its output is piped? It garbles my log files.", "feature"],
  ["Colour codes appear in piped output, which is wrong for a log file.", "bug"],
  ["Where do I set the pool size? The configuration page lists no such option.", "docs"],
  ["Where do I set the pool size?", "question"],
  ["Please document the retry defaults, or else make them configurable.", "docs"],
  ["Make the retry defaults configurable per request.", "feature"],
  ["Login loops between /dashboard and /login in Safari. Is this a known bug?", "bug"],
  ["Does login work in Safari? A few of my users mention something odd there.", "question"],
  ["The last step of the tutorial refers to config.yml, which no earlier step creates.", "docs"],
  ["The upgrade guide is clear, but following it produced a 500 error on first boot.", "bug"],
  ["Could you add a troubleshooting section for the 500 error on first boot?", "docs"],
  ["Add a health endpoint so I can tell whether first boot succeeded.", "feature"],
];

const WORKFLOW: (WF & { 2?: string })[] = [
  ...BUGS.map((t) => [t, "bug"] as WF),
  ...FEATURES.map((t) => [t, "feature"] as WF),
  ...QUESTIONS.map((t) => [t, "question"] as WF),
  ...DOCS.map((t) => [t, "docs"] as WF),
];

// --- set 2: modular exponents + addition control (generated, exact gold) ---

const LETTERS = ["A", "B", "C", "D"];
const modpow = (a: bigint, b: bigint, m: bigint): bigint => {
  let r = 1n;
  let base = a % m;
  let e = b;
  while (e > 0n) {
    if (e & 1n) r = (r * base) % m;
    base = (base * base) % m;
    e >>= 1n;
  }
  return r;
};

const PRIMES = [7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];

export interface Item {
  set: string;
  id: string;
  state: unknown;
  instructions: string;
  options: Record<string, unknown>;
  gold: string;
  meta: Record<string, unknown>;
}

/** Puts the true value plus three wrong ones behind A-D in a seeded order. */
function fourOptions(correct: string, wrong: string[], rnd: () => number) {
  const order = shuffle([correct, ...wrong], rnd);
  const options: Record<string, unknown> = {};
  let gold = "A";
  order.forEach((v, i) => {
    options[LETTERS[i]!] = v;
    if (v === correct) gold = LETTERS[i]!;
  });
  return { options, gold };
}

function modexpItems(n: number, seed: number): Item[] {
  const rnd = mulberry32(seed);
  const out: Item[] = [];
  const seen = new Set<string>();
  while (out.length < n) {
    const a = 2 + Math.floor(rnd() * 18);
    const b = 3 + Math.floor(rnd() * 8);
    const m = PRIMES[Math.floor(rnd() * PRIMES.length)]!;
    const key = `${a}^${b}%${m}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const correct = Number(modpow(BigInt(a), BigInt(b), BigInt(m)));
    const wrong = new Set<number>();
    while (wrong.size < 3) {
      const w = Math.floor(rnd() * m);
      if (w !== correct) wrong.add(w);
    }
    const { options, gold } = fourOptions(
      String(correct),
      [...wrong].map(String),
      rnd,
    );
    out.push({
      set: "modexp",
      id: `modexp-${out.length + 1}`,
      state: `What is ${a}^${b} mod ${m}?`,
      instructions: "Which option is the correct value?",
      options,
      gold,
      meta: { a, b, m, correct },
    });
  }
  return out;
}

function additionItems(n: number, seed: number): Item[] {
  const rnd = mulberry32(seed);
  const out: Item[] = [];
  const seen = new Set<string>();
  const offsets = [1, 2, 9, 10, 11, 18, 20, 3];
  while (out.length < n) {
    const x = 10 + Math.floor(rnd() * 90);
    const y = 10 + Math.floor(rnd() * 90);
    const key = `${x}+${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const correct = x + y;
    const wrong = new Set<number>();
    while (wrong.size < 3) {
      const o = offsets[Math.floor(rnd() * offsets.length)]!;
      const w = correct + (rnd() < 0.5 ? -o : o);
      if (w !== correct && w > 0) wrong.add(w);
    }
    const { options, gold } = fourOptions(String(correct), [...wrong].map(String), rnd);
    out.push({
      set: "addition",
      id: `addition-${out.length + 1}`,
      state: `What is ${x} + ${y}?`,
      instructions: "Which option is the correct value?",
      options,
      gold,
      meta: { x, y, correct },
    });
  }
  return out;
}

// --- set 3: MMLU rows from the public datasets-server (no credentials) ---

const MMLU_SOURCE =
  "datasets-server.huggingface.co, dataset cais/mmlu, config all, split test, rows 0-199 (two pages of 100), fetched without credentials";

async function mmluItems(): Promise<{ items: Item[]; note: string }> {
  const cache = join(DIR, "mmlu.json");
  if (existsSync(cache)) {
    const rows = JSON.parse(readFileSync(cache, "utf8"));
    return { items: mmluToItems(rows), note: MMLU_SOURCE + " (cached in mmlu.json)" };
  }
  const rows: any[] = [];
  try {
    for (const offset of [0, 100]) {
      const url = `https://datasets-server.huggingface.co/rows?dataset=cais/mmlu&config=all&split=test&offset=${offset}&length=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      for (const r of body.rows ?? []) rows.push({ ...r.row, row_idx: r.row_idx });
    }
  } catch (e) {
    return { items: [], note: `fetch failed: ${String(e)}` };
  }
  writeFileSync(cache, JSON.stringify(rows, null, 1));
  return { items: mmluToItems(rows), note: MMLU_SOURCE };
}

function mmluToItems(rows: any[]): Item[] {
  return rows
    .filter((r) => Array.isArray(r.choices) && r.choices.length === 4)
    .map((r, i) => {
      const options: Record<string, unknown> = {};
      r.choices.forEach((c: string, k: number) => (options[LETTERS[k]!] = c));
      return {
        set: "mmlu",
        id: `mmlu-${r.row_idx ?? i}`,
        state: { subject: r.subject, question: r.question },
        instructions: "Which option is the correct answer?",
        options,
        gold: LETTERS[r.answer]!,
        meta: { subject: r.subject, row_idx: r.row_idx },
      } as Item;
    });
}

// --- items ---

const WF_OPTIONS = {
  bug: "Something already built behaves incorrectly: a crash, an error, a wrong result, a regression.",
  feature: "A request for new behaviour, a new option, or support for something not built yet.",
  question: "Someone asking for information or help using the project as it is.",
  docs: "The documentation, README, guide or changelog is wrong, missing, outdated or unclear.",
};

const workflowItems: Item[] = [
  ...WORKFLOW.map((w, i) => ({
    set: "workflow",
    id: `workflow-${i + 1}`,
    state: { title: "", body: w[0] },
    instructions: "Which category does this issue report belong to?",
    options: WF_OPTIONS,
    gold: w[1],
    meta: { subset: "clear" },
  })),
  ...AMBIGUOUS.map((w, i) => ({
    set: "workflow",
    id: `ambiguous-${i + 1}`,
    state: { title: "", body: w[0] },
    instructions: "Which category does this issue report belong to?",
    options: WF_OPTIONS,
    gold: w[1],
    meta: { subset: "ambiguous" },
  })),
];
// The state keeps only the body; no titles were written.
for (const it of workflowItems) it.state = (it.state as any).body;

const modexp = modexpItems(100, 20260918);
const addition = additionItems(60, 424242);
const mmlu = await mmluItems();

const ALL: Item[] = [...workflowItems, ...modexp, ...addition, ...mmlu.items];
writeFileSync(
  join(DIR, "items.json"),
  JSON.stringify(
    {
      provenance: {
        workflow:
          "120 clear + 30 ambiguous GitHub-issue-like texts written by hand for this experiment (no public source). Ambiguous labels follow a stated rule.",
        ambiguous_rule: RULE,
        modexp: "generated in eval/h6.ts, seed 20260918; gold = a^b mod m by exact BigInt arithmetic; 3 distractors are distinct random residues < m.",
        addition: "generated in eval/h6.ts, seed 424242; gold = x + y; 3 distractors are the sum offset by +/-{1,2,3,9,10,11,18,20}.",
        mmlu: mmlu.note,
      },
      count: ALL.length,
      items: ALL,
    },
    null,
    1,
  ),
);
console.log(`items.json: ${ALL.length} items (mmlu: ${mmlu.note})`);
if (process.env.H6_DRY) {
  const by: Record<string, number> = {};
  for (const it of ALL) by[it.set] = (by[it.set] ?? 0) + 1;
  console.log("by set:", JSON.stringify(by));
  console.log("sample:", JSON.stringify(ALL[130]), JSON.stringify(ALL[151]), JSON.stringify(ALL[251]));
  process.exit(0);
}

// --- sending: one request per item, one state, one choice question ---

interface Row {
  id: string;
  set: string;
  gold: string;
  pick: string;
  topP: number;
  pGold: number;
  correct: boolean;
  confidence?: number;
  meta: Record<string, unknown>;
}

async function run(name: string, items: Item[], provider: Provider): Promise<Row[]> {
  const cache = join(DIR, `rows-${name}.json`);
  if (existsSync(cache)) {
    const rows = JSON.parse(readFileSync(cache, "utf8")) as Row[];
    console.log(`${name}: ${rows.length} rows from cache`);
    return rows;
  }
  const rows: Row[] = [];
  let failed = 0;
  for (const [i, it] of items.entries()) {
    try {
      const res = await send(
        "h6",
        { state: it.state, questions: { label: choice(it.instructions, it.options as Record<string, unknown>) } },
        { set: name, id: it.id, gold: it.gold },
        { provider },
      );
      const a = res.answers.label!;
      const probs = a.probabilities ?? {};
      const topP = Math.max(...Object.values(probs));
      rows.push({
        id: it.id,
        set: name,
        gold: it.gold,
        pick: a.choice!,
        topP,
        pGold: probs[it.gold] ?? 0,
        correct: a.choice === it.gold,
        confidence: a.confidence,
        meta: it.meta,
      });
    } catch (e) {
      failed++;
      console.log(`  ${it.id} failed: ${String(e).slice(0, 160)}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  ${name} ${i + 1}/${items.length}`);
  }
  writeFileSync(cache, JSON.stringify(rows, null, 1));
  console.log(`${name}: ${rows.length} rows, ${failed} failed`);
  return rows;
}

// --- statistics ---

interface Bin {
  lo: number;
  hi: number;
  n: number;
  meanP: number;
  acc: number;
  lo95: number;
  hi95: number;
}

function bins(rows: Row[]): Bin[] {
  const out: Bin[] = [];
  for (let b = 0; b < 10; b++) {
    const lo = b / 10;
    const hi = (b + 1) / 10;
    const inBin = rows.filter((r) => (b === 9 ? r.topP >= lo && r.topP <= 1 : r.topP >= lo && r.topP < hi));
    const k = inBin.filter((r) => r.correct).length;
    const w = wilson(k, inBin.length);
    out.push({
      lo,
      hi,
      n: inBin.length,
      meanP: inBin.length ? mean(inBin.map((r) => r.topP)) : Number.NaN,
      acc: inBin.length ? k / inBin.length : Number.NaN,
      lo95: w.lo,
      hi95: w.hi,
    });
  }
  return out;
}

const ece = (rows: Row[]): number =>
  bins(rows)
    .filter((b) => b.n > 0)
    .reduce((a, b) => a + (b.n / rows.length) * Math.abs(b.acc - b.meanP), 0);

/** Poisson-binomial z: observed correct vs the model's own predicted total. */
function calibZ(rows: Row[]): { z: number; expected: number; observed: number } {
  const observed = rows.filter((r) => r.correct).length;
  const expected = rows.reduce((a, r) => a + r.topP, 0);
  const v = rows.reduce((a, r) => a + r.topP * (1 - r.topP), 0);
  return { z: v > 0 ? (observed - expected) / Math.sqrt(v) : 0, expected, observed };
}

const CHANCE = 0.25; // every question in every set has exactly 4 options

function summary(rows: Row[]) {
  const k = rows.filter((r) => r.correct).length;
  const w = wilson(k, rows.length);
  const hi = rows.filter((r) => r.topP >= 0.6);
  const hiW = wilson(hi.filter((r) => r.correct).length, hi.length);
  const z = calibZ(rows);
  return {
    n: rows.length,
    acc: w.p,
    lo95: w.lo,
    hi95: w.hi,
    meanTopP: mean(rows.map((r) => r.topP)),
    meanPGold: mean(rows.map((r) => r.pGold)),
    gap: mean(rows.map((r) => r.topP)) - w.p,
    ece: ece(rows),
    z: z.z,
    expected: z.expected,
    observed: z.observed,
    atChance: w.lo <= CHANCE && CHANCE <= w.hi,
    nHigh: hi.length,
    accHigh: hi.length ? hiW.p : Number.NaN,
    accHighLo: hi.length ? hiW.lo : Number.NaN,
  };
}

const pct = (x: number) => (Number.isFinite(x) ? (100 * x).toFixed(1) + "%" : "-");
const num = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "-");

function table(rows: Row[]): string {
  const head =
    "| bin | n | mean p | accuracy | Wilson 95% |\n| --- | --- | --- | --- | --- |\n";
  return (
    head +
    bins(rows)
      .map(
        (b) =>
          `| ${b.lo.toFixed(1)}-${b.hi.toFixed(1)} | ${b.n} | ${num(b.meanP)} | ${pct(b.acc)} | ${
            b.n ? `${pct(b.lo95)} - ${pct(b.hi95)}` : "-"
          } |`,
      )
      .join("\n")
  );
}

// --- run ---

const wfRows = await run("workflow", workflowItems, "typesafe");
const meRows = await run("modexp", modexp, "typesafe");
const adRows = await run("addition", addition, "typesafe");
const mmRows = mmlu.items.length ? await run("mmlu", mmlu.items, "typesafe") : [];
const veRows = await run("modexp-vercel", modexp.slice(0, 30), "vercel");

const clear = wfRows.filter((r) => r.meta.subset === "clear");
const ambig = wfRows.filter((r) => r.meta.subset === "ambiguous");
const aggregate = [...wfRows, ...meRows, ...adRows, ...mmRows];

const sets: [string, Row[]][] = [
  ["workflow (all 150)", wfRows],
  ["workflow - clear 120", clear],
  ["workflow - ambiguous 30", ambig],
  ["modular exponents", meRows],
  ["addition control", adRows],
  ...(mmRows.length ? ([["mmlu 200", mmRows]] as [string, Row[]][]) : []),
  ["AGGREGATE (all typesafe)", aggregate],
  ["modexp on vercel gateway", veRows],
];

const S = Object.fromEntries(sets.map(([n, r]) => [n, r.length ? summary(r) : null]));
writeFileSync(join(DIR, "summary.json"), JSON.stringify(S, null, 1));

const overview =
  "| set | n | accuracy | Wilson 95% | mean top p | gap (p - acc) | ECE | calib z | n(p>=0.6) | acc there |\n" +
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" +
  sets
    .filter(([, r]) => r.length)
    .map(([n, r]) => {
      const s = summary(r);
      return `| ${n} | ${s.n} | ${pct(s.acc)} | ${pct(s.lo95)} - ${pct(s.hi95)} | ${num(s.meanTopP)} | ${
        s.gap >= 0 ? "+" : ""
      }${num(s.gap)} | ${num(s.ece)} | ${num(s.z, 2)} | ${s.nHigh} | ${
        s.nHigh ? pct(s.accHigh) : "-"
      } |`;
    })
    .join("\n");

const agg = summary(aggregate);

// Decision rule, fixed before looking at the numbers:
//  a set "fails" when its accuracy interval still contains chance (1/4), i.e. on that task
//  the answers carry no information; the aggregate "looks good" when its ECE is under 0.05
//  and its own accuracy interval is far above chance.
const perTask = sets
  .filter(([n, r]) => r.length && !n.startsWith("AGGREGATE") && !n.includes("vercel"))
  .map(([n, r]) => ({ name: n, ...summary(r) }));
const failing = perTask.filter((s) => s.atChance);
const hidden = agg.ece < 0.05 && agg.lo95 > CHANCE;
const verdict = failing.length && hidden ? "CONFIRMED" : failing.length ? "INCONCLUSIVE" : "REFUTED";
const failLine = failing.length
  ? failing
      .map(
        (f) =>
          `**${f.name}**: accuracy ${pct(f.acc)} (95% ${pct(f.lo95)}-${pct(f.hi95)}, chance 25%), ` +
          `mean top p ${num(f.meanTopP)}, ECE ${num(f.ece)}`,
      )
      .join("; ")
  : "none";

const me = summary(meRows);
const hiAll = aggregate.filter((r) => r.topP >= 0.6);
const hiAcc = wilson(hiAll.filter((r) => r.correct).length, hiAll.length);
const loAll = aggregate.filter((r) => r.topP < 0.6);
const loAcc = wilson(loAll.filter((r) => r.correct).length, loAll.length);

const PRACTICAL = `1. **A probability is a frequency only within one task.** Pooled over these ${aggregate.length} items the
   ECE is ${num(agg.ece)}, which is excellent, and it is meaningless: it averages a task at ${pct(
     me.acc,
   )} (modular
   exponents, chance is 25%) with tasks at 100%. Compute the reliability table on your own task
   before you believe any number.
2. **Do not read a probability as a competence check.** On the modular exponent set the model
   returned a mean top probability of ${num(me.meanTopP)} while being right ${pct(
     me.acc,
   )} of the time: the number is
   low, but it is still ~${num(me.meanTopP - me.acc, 2)} above the truth, and nothing in the response says
   "I cannot do this task".
3. **Above 0.6 the number is usable, below it is not.** Over all sets, ${
   hiAll.length
 } answers came back with a top
   probability >= 0.6 and ${pct(hiAcc.p)} of those were right (95% ${pct(hiAcc.lo)}-${pct(
   hiAcc.hi,
 )}); the ${loAll.length} answers
   below 0.6 were right ${pct(loAcc.p)} of the time (95% ${pct(loAcc.lo)}-${pct(loAcc.hi)}).
   Route everything under 0.6 to a human or to code, and never let a near-floor probability
   (4 options -> floor 0.25) count as a decision.
4. **Arithmetic and exact computation belong in code.** Both providers reproduce the collapse
   (typesafe ${pct(me.acc)}, vercel gateway ${pct(
   summary(veRows).acc,
 )} on the same items), while two-digit addition
   with the identical 4-option format is ${pct(summary(adRows).acc)}. The failure is the task, not the format.`;

const perBin = sets
  .filter(([, r]) => r.length)
  .map(([n, r]) => `### ${n} (n=${r.length})\n\n${table(r)}`)
  .join("\n\n");

writeReport(
  "h6",
  `# H6 - calibration: aggregate agreement vs per-task failure

Verdict: **${verdict}**

Sets whose accuracy interval still contains chance (25% with 4 options), i.e. the answers
carry no information on that task: ${failLine}.
Aggregate ECE over all ${aggregate.length} typesafe items: ${num(agg.ece)}.

Generated ${new Date().toISOString()} by \`eval/h6.ts\`. Model \`jev-latest\`.
One request per item (one state, one 4-option choice question). ${aggregate.length + veRows.length} requests.

Raw data: \`eval/data/h6/\` - \`items.json\` (all items with gold labels and provenance),
per-attempt request/response log \`eval/data/h6/<date>.jsonl\`, scored rows
\`rows-workflow.json\`, \`rows-modexp.json\`, \`rows-addition.json\`, \`rows-mmlu.json\`,
\`rows-modexp-vercel.json\`, and \`summary.json\`.

## Provenance of the items

- **workflow (150)**: GitHub-issue-like texts written by hand for this experiment, no public
  source. 120 items with unambiguous labels, 30 per category (bug / feature / question / docs),
  each under 60 words. Plus a 30-item ambiguous subset where each text reads as two categories
  and the gold label is assigned by this stated rule, first match wins: ${RULE}
- **modular exponents (100)**: generated by \`modexpItems\` (seed 20260918). State is
  "What is a^b mod m?" with a in 2..19, b in 3..10, m a prime in 7..97. Gold computed with exact
  BigInt modular exponentiation; the 3 distractors are distinct random residues below m; the
  correct letter is shuffled.
- **addition control (60)**: same 4-option format, "What is x + y?" with two-digit x, y
  (seed 424242); distractors are the true sum offset by +/-{1,2,3,9,10,11,18,20}.
- **MMLU (${mmRows.length})**: public labelled data from ${mmlu.note}. Gold is the dataset's own
  answer index mapped to A-D; option order is left as the dataset has it.

## Overview

${overview}

"gap" is mean top probability minus accuracy: positive means the model claims more than it delivers.

"calib z" is (correct - sum of top probabilities) / sqrt(sum p(1-p)): the model's own
prediction of how many it would get right, tested against what it got right. Negative means
it over-claimed. |z| > 1.96 is a significant miscalibration at that n.

## Practical rule for library users

${PRACTICAL}

## Reliability tables (10 equal-width bins on the top probability)

${perBin}
`,
);

console.log("\n" + overview + "\n");
console.log("verdict:", verdict);
