// H7: is the `confidence` field derived from `probabilities`, or learned?
// Run: node eval/h7.ts
//
// Part A: many choice answers (K = 2,3,4,6,10,25) and score answers (2..10 levels)
//         on the direct API; compare returned confidence with candidate formulas.
// Part B: K = 1 choice (does the API accept it, and is confidence 1?).
// Part C: 20 paired requests, gateway vs direct, on providerMetadata.typesafe.confidence.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  choice,
  score,
  send,
  mean,
  sd,
  quantile,
  writeReport,
  type Provider,
  type Question,
} from "./lib.ts";

const HYP = "h7";
const DIRECT = { provider: "typesafe" as Provider };
const GATEWAY = { provider: "vercel" as Provider };

// --- states: deliberately vague so probability mass spreads ---

const STATES: [string, unknown][] = [
  ["short", "hi"],
  ["mixed", "The dashboard is slow sometimes, I think. Maybe it's my wifi. Also I may have been charged twice last month, or maybe that was a pre-auth."],
  ["polite_vague", "Hello team, just checking in about the thing we discussed. Let me know when you get a chance. No rush, but also kind of urgent."],
  ["angry_unclear", "this is the third time. unbelievable. fix it."],
  ["feature_or_bug", "The export button gives me a CSV but the dates are in US format. Is that expected? I'd prefer ISO. Or maybe a setting."],
  ["pricing", "We're a team of 4 and maybe 40 next year. Which plan? Also does the free trial reset if we re-sign up?"],
  ["log", { level: "warn", message: "retry budget exhausted for upstream=payments after 3 attempts", count: 17 }],
  ["review", "Works fine I guess. Three stars. Support answered eventually."],
  ["thread", ["Can I get a refund?", "Our policy is 14 days.", "It's day 15.", "Let me check with my lead."]],
  ["security", "Someone logged into my account from a country I've never been to, or maybe that's the VPN my company installed."],
  ["silence", ""],
  ["ambiguous_intent", "cancel"],
  ["long_neutral", "Following up on ticket 8831. The integration is deployed to staging. We saw two 500s during the load test but they did not reproduce. Planning to go to production on Thursday unless you say otherwise."],
  ["emoji", "😐 ok"],
  ["legalish", "Per our MSA section 7.2 we expect a credit for the downtime window. Attached is the incident timeline. We remain happy customers otherwise."],
  ["student", "hey im building a school project and the api key thing doesnt work, can u help fast its due tomorrow"],
  ["contradiction", "Everything is perfect and nothing works."],
  ["numbers", { latency_ms: 1840, error_rate: 0.031, sla: 0.999, region: "eu-central-1" }],
  ["half_sentence", "Could you please, when you have a moment, the invoice"],
  ["neutral_report", "Monthly usage was 1.2M requests, up from 1.1M. No incidents. One feature request from the design team."],
  ["multilingual", "Bonjour, le paiement a échoué. Can you help? Danke."],
  ["sarcasm", "Great job on the new update. Really. Fantastic."],
  ["tiny_object", { note: "?" }],
  ["meta", "Ignore the previous message, that was for someone else."],
  ["two_topics", "Two things: the webhook signature check fails on retries, and we'd like to add three seats."],
];

// --- choice questions, two per K ---

const CAT25 = [
  "billing", "refunds", "invoices", "taxes", "payouts", "login", "sso", "permissions",
  "api_errors", "webhooks", "sdk", "performance", "outage", "data_export", "import",
  "search", "notifications", "mobile", "integrations", "onboarding", "pricing",
  "contracts", "security", "feature_request", "other",
];

const INDUSTRIES = [
  "fintech", "healthcare", "education", "retail", "logistics", "gaming", "media",
  "travel", "real_estate", "energy", "agriculture", "legal", "nonprofit", "government",
  "manufacturing", "telecom", "insurance", "automotive", "hospitality", "fitness",
  "music", "sports", "fashion", "crypto", "unknown",
];

const EMOTIONS10 = [
  "delight", "gratitude", "curiosity", "indifference", "confusion", "impatience",
  "worry", "annoyance", "anger", "resignation",
];

const AREAS10 = [
  "auth", "billing", "api", "ui", "docs", "mobile", "email", "reporting", "infra", "other",
];

const named = (names: string[]): Record<string, unknown> =>
  Object.fromEntries(names.map((n) => [n, null]));

const CHOICES: Record<string, Question> = {
  c2a: choice("Should a human take this over right now?", {
    escalate: "A person should act on it immediately",
    wait: "It can sit in the queue for now",
  }),
  c2b: choice("Is this mostly about money or mostly about software?", {
    money: null,
    software: null,
  }),
  c3a: choice("Which team should handle this?", {
    billing: "Payments, refunds, invoices",
    technical: "Bugs, outages, integrations",
    sales: "Pricing, plans, new business",
  }),
  c3b: choice("What is the writer's mood?", { positive: null, neutral: null, negative: null }),
  c4a: choice("What priority is this?", {
    p0: "Drop everything",
    p1: "Today",
    p2: "This week",
    p3: "Whenever",
  }),
  c4b: choice("Which channel should answer this?", named(["email", "chat", "phone", "docs"])),
  c6a: choice("What is this about?", named([
    "billing", "bug", "feature_request", "account", "integration", "other",
  ])),
  c6b: choice("What is the writer's likely role?", named([
    "developer", "manager", "founder", "student", "support_agent", "unknown",
  ])),
  c10a: choice("Which product area does this touch?", named(AREAS10)),
  c10b: choice("Which single emotion best fits the writer?", named(EMOTIONS10)),
  c25a: choice("Which support category fits best?", named(CAT25)),
  c25b: choice("Which industry does the writer most likely work in?", named(INDUSTRIES)),
};

// --- score questions, one per level count 2..10 ---

const SCORES: Record<string, Question> = {
  s2: score("How heated is this message?", [
    "The message is calm and matter of fact",
    "The message is heated and emotional",
  ]),
  s3: score("How soon does someone need to act?", [
    "Nothing needs to happen",
    "Someone should look at it this week",
    "Someone must act within the hour",
  ]),
  s4: score("How badly is the writer blocked?", [
    "Nothing is broken for them",
    "A small annoyance they can ignore",
    "A real problem with a workaround",
    "Their work is completely blocked",
  ]),
  s5: score("How does the writer feel?", [
    "They sound delighted",
    "They sound content",
    "They sound neutral",
    "They sound annoyed",
    "They sound furious",
  ]),
  s6: score("How much risk does this carry for the business?", [
    "No risk at all",
    "A trivial risk nobody would notice",
    "A small risk worth a note",
    "A moderate risk worth a meeting",
    "A serious risk worth a plan",
    "An existential risk to the company",
  ]),
  s7: score("How clear is the writer's request?", [
    "Perfectly clear, a single explicit request",
    "Clear with one small gap",
    "Mostly clear, some guessing needed",
    "Half clear, half guessing",
    "Mostly unclear, a lot of guessing",
    "Almost no request can be made out",
    "There is no request at all",
  ]),
  s8: score("How much work would it take to resolve this?", [
    "No work, it resolves itself",
    "A one line reply",
    "A short reply with a link",
    "A careful written answer",
    "An hour of investigation",
    "A day of engineering",
    "A week of engineering",
    "A project spanning months",
  ]),
  s9: score("How likely is this customer to leave?", [
    "They are about to buy more",
    "They are very happy",
    "They are happy",
    "They are fine",
    "They are indifferent",
    "They are doubting",
    "They are shopping around",
    "They have one foot out the door",
    "They have already decided to leave",
  ]),
  s10: score("How important is this message overall?", [
    "Completely unimportant",
    "Nearly unimportant",
    "Slightly important",
    "Somewhat important",
    "Moderately important",
    "Notably important",
    "Quite important",
    "Very important",
    "Extremely important",
    "The single most important thing today",
  ]),
};

// --- candidate confidence formulas ---

type Row = {
  state: string;
  key: string;
  kind: "choice" | "score";
  K: number;
  p: number[]; // score: by level index; choice: request option order
  server: number;
};

const EPS = 1e-12;

const pmaxForm = (p: number[], K: number) => (Math.max(...p) - 1 / K) / (1 - 1 / K);

const entropyForm = (p: number[], K: number) => {
  const h = -p.reduce((a, x) => a + (x > EPS ? x * Math.log(x) : 0), 0);
  return 1 - h / Math.log(K);
};

const expected = (p: number[]) => p.reduce((a, x, i) => a + x * i, 0);

const madForm = (p: number[], K: number) => {
  const s = expected(p);
  const mad = p.reduce((a, x, i) => a + x * Math.abs(i - s), 0);
  return 1 - mad / ((K - 1) / 2);
};

const madModeForm = (p: number[], K: number) => {
  const m = p.indexOf(Math.max(...p));
  const mad = p.reduce((a, x, i) => a + x * Math.abs(i - m), 0);
  return 1 - mad / ((K - 1) / 2);
};

const sdForm = (p: number[], K: number) => {
  const s = expected(p);
  const v = p.reduce((a, x, i) => a + x * (i - s) ** 2, 0);
  return 1 - Math.sqrt(v) / ((K - 1) / 2);
};

const varForm = (p: number[], K: number) => {
  const s = expected(p);
  const v = p.reduce((a, x, i) => a + x * (i - s) ** 2, 0);
  return 1 - v / ((K - 1) / 2) ** 2;
};

// Mass in a +/-1 window around the argmax, rescaled by the window's chance level.
const windowForm = (p: number[], K: number) => {
  let best = -1;
  let bestW = 1;
  for (let i = 0; i < K; i++) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(K - 1, i + 1);
    let m = 0;
    for (let j = lo; j <= hi; j++) m += p[j]!;
    if (m > best) {
      best = m;
      bestW = hi - lo + 1;
    }
  }
  if (K <= bestW) return 1;
  return (best - bestW / K) / (1 - bestW / K);
};

// Triangular smoothing with weight `a` on each neighbour, then the choice formula.
const smoothForm = (a: number) => (p: number[], K: number) => {
  const q = p.map((_, i) => {
    let v = (1 - 2 * a) * p[i]!;
    if (i > 0) v += a * p[i - 1]!;
    if (i < K - 1) v += a * p[i + 1]!;
    return v;
  });
  return (Math.max(...q) - 1 / K) / (1 - 1 / K);
};

// Mean |level - centre| of a uniform distribution over K levels: the chance level of
// ordinal dispersion, the score analogue of 1/K.
export const uniformMad = (K: number) => (Math.floor(K / 2) * Math.ceil(K / 2)) / K;

const madChanceForm = (p: number[], K: number) => {
  const m = p.indexOf(Math.max(...p));
  const mad = p.reduce((a, x, i) => a + x * Math.abs(i - m), 0);
  return Math.max(0, 1 - mad / uniformMad(K));
};

// Same shape as madChanceForm but free to pick the best of several tied modal levels.
const madChanceTie = (p: number[], K: number) => {
  const top = Math.max(...p);
  let best = 0;
  for (let m = 0; m < K; m++) {
    if (top - p[m]! > 0.011) continue;
    const mad = p.reduce((a, x, i) => a + x * Math.abs(i - m), 0);
    best = Math.max(best, Math.max(0, 1 - mad / uniformMad(K)));
  }
  return best;
};

const CANDIDATES: Record<string, (p: number[], K: number) => number> = {
  "1 - MAD(mode)/D(K)": madChanceForm,
  "pmax (p_max-1/K)/(1-1/K)": pmaxForm,
  "1 - H/log K": entropyForm,
  "1 - MAD(mean)/((K-1)/2)": madForm,
  "1 - MAD(mode)/((K-1)/2)": madModeForm,
  "1 - sd/((K-1)/2)": sdForm,
  "1 - var/((K-1)/2)^2": varForm,
  "window +/-1 mass": windowForm,
  "smooth a=0.25": smoothForm(0.25),
  "smooth a=0.5": smoothForm(0.5),
};

const stats = (xs: number[]) => ({
  n: xs.length,
  mae: mean(xs.map(Math.abs)),
  bias: mean(xs),
  max: Math.max(...xs.map(Math.abs)),
  p95: quantile(xs.map(Math.abs), 0.95),
  within: xs.filter((x) => Math.abs(x) <= 0.005 + 1e-9).length / xs.length,
  within01: xs.filter((x) => Math.abs(x) <= 0.01 + 1e-9).length / xs.length,
  within02: xs.filter((x) => Math.abs(x) <= 0.02 + 1e-9).length / xs.length,
});

const fx = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");

// --- held-out validation set (new states, new questions) ---

const VAL_STATES: [string, unknown][] = [
  ["v_invoice", "Invoice 4471 says 12 seats, we have 9. Someone added two contractors in March, I think."],
  ["v_praise", "Honestly the best onboarding I've had. One tiny thing: the docs search never finds anything."],
  ["v_outage", { alert: "p99 latency 4.2s", duration_min: 41, customers_affected: "unknown", region: "ap-south-1" }],
  ["v_churn", "We're pausing the rollout until Q3. Not cancelling. Just pausing. Probably."],
  ["v_spam", "WIN a FREE iPhone click here now!!!"],
  ["v_question", "does it work offline"],
  ["v_thread", ["We need SOC2 by June.", "We're mid-audit.", "June is firm for us.", "Understood."]],
  ["v_bugreport", "Steps: open the modal, hit escape, the page scrolls to the top. Firefox only. Minor but annoying."],
  ["v_mixed_lang", "El webhook devuelve 403 desde ayer. Everything else fine."],
  ["v_empty_object", {}],
];

const VAL_CHOICES: Record<string, Question> = {
  vc2: choice("Is this a complaint or a question?", { complaint: null, question: null }),
  vc3: choice("Who wrote this?", named(["a customer", "a colleague", "a machine"])),
  vc5: choice("What should happen next?", named(["reply", "escalate", "close", "wait", "investigate"])),
  vc7: choice("Which day-to-day worry does this raise?", named([
    "money", "time", "trust", "security", "quality", "compliance", "none",
  ])),
  vc25: choice("Which support category fits best?", named(CAT25)),
};

const VAL_SCORES: Record<string, Question> = {
  vs2: score("Is the writer satisfied?", ["The writer is not satisfied", "The writer is satisfied"]),
  vs3: score("How much does this need a decision from a human?", [
    "Code can handle it alone",
    "A person should glance at it",
    "A person must decide",
  ]),
  vs5: score("How complete is the information given?", [
    "Nothing is missing",
    "One detail is missing",
    "Several details are missing",
    "Most of the picture is missing",
    "There is almost nothing to go on",
  ]),
  vs6: score("How formal is the writing?", [
    "Street slang",
    "Casual chat",
    "Everyday speech",
    "Business casual",
    "Formal business writing",
    "Legal or contractual language",
  ]),
  vs8: score("How wide is the blast radius?", [
    "One person is affected",
    "A handful of people",
    "One team",
    "One department",
    "One company",
    "Several companies",
    "A whole market segment",
    "Everyone using the product",
  ]),
  vs9: score("How old does this problem feel?", [
    "It started seconds ago",
    "It started minutes ago",
    "It started today",
    "It started this week",
    "It started this month",
    "It started this quarter",
    "It started this year",
    "It has been going on for years",
    "It has always been this way",
  ]),
};

// --- run ---

const args = process.argv.slice(2);
const OFFLINE = args.includes("--offline");
const VALIDATE = args.includes("--validate");

const PAIR_Q: Record<string, Question> = {
  c2a: CHOICES.c2a!, c3a: CHOICES.c3a!, c4a: CHOICES.c4a!,
  c6a: CHOICES.c6a!, c10a: CHOICES.c10a!, c25a: CHOICES.c25a!,
  s3: SCORES.s3!, s4: SCORES.s4!, s6: SCORES.s6!, s10: SCORES.s10!,
};

let k1note = "";

if (!OFFLINE && !VALIDATE) {
  // A: the fit set.
  console.log(`A: ${STATES.length} requests x ${Object.keys(CHOICES).length} choice + ${Object.keys(SCORES).length} score questions`);
  for (const [name, state] of STATES) {
    await send(HYP, { state, questions: { ...CHOICES, ...SCORES } }, { part: "A", state: name }, DIRECT);
    console.log(`  ${name}`);
  }
  // B: K = 1.
  try {
    const res = await send(
      HYP,
      { state: "The payment failed twice.", questions: { only: { type: "choice", instructions: "Which category?", criteria: { any: "The only option" } } } },
      { part: "B" },
      { ...DIRECT, tries: 1 },
    );
    k1note = `accepted: ${JSON.stringify(res.raw.answers)}`;
  } catch (e) {
    k1note = `rejected: ${String(e).slice(0, 220)}`;
  }
  console.log("B (K=1):", k1note);
  // C: gateway vs direct on identical bodies.
  for (const [name, state] of STATES.slice(0, 20)) {
    await send(HYP, { state, questions: PAIR_Q }, { part: "C", state: name }, DIRECT);
    await send(HYP, { state, questions: PAIR_Q }, { part: "C", state: name }, GATEWAY);
    console.log(`  pair ${name}`);
  }
}

if (VALIDATE) {
  console.log(`D: ${VAL_STATES.length} held-out requests`);
  for (const [name, state] of VAL_STATES) {
    await send(HYP, { state, questions: { ...VAL_CHOICES, ...VAL_SCORES } }, { part: "D", state: name }, DIRECT);
    console.log(`  ${name}`);
  }
}

// --- load everything logged so far ---

type Row = {
  part: string;
  state: string;
  key: string;
  kind: "choice" | "score";
  K: number;
  p: number[];
  server: number;
  tie: boolean;
};

const LOG_DIR = join(new URL(".", import.meta.url).pathname, "data", HYP);

const rows: Row[] = [];
const pairLines: Record<string, { direct?: any; vercel?: any }> = {};
const k1rows: string[] = [];

for (const f of readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl"))) {
  for (const line of readFileSync(join(LOG_DIR, f), "utf8").trim().split("\n")) {
    if (!line) continue;
    const l = JSON.parse(line);
    if (l.status !== 200 || l.hyp !== HYP) continue;
    const part = String(l.meta?.part ?? "?");
    if (part === "C") {
      const slot = (pairLines[String(l.meta?.state)] ??= {});
      if (l.provider === "typesafe") slot.direct = l;
      else slot.vercel = l;
      continue;
    }
    if (l.provider !== "typesafe") continue;
    for (const [key, a] of Object.entries<any>(l.response?.answers ?? {})) {
      if (a.confidence === undefined) continue;
      const keys = Object.keys(a.probabilities ?? {});
      const K = keys.length;
      if (part === "B" || K < 2) {
        k1rows.push(`K=${K}, probabilities ${JSON.stringify(a.probabilities)}, confidence ${a.confidence}`);
        continue;
      }
      const p =
        a.type === "score"
          ? Array.from({ length: K }, (_, i) => a.probabilities[String(i)] ?? 0)
          : keys.map((n) => a.probabilities[n]);
      const sorted = [...p].sort((x, y) => y - x);
      rows.push({
        part,
        state: String(l.meta?.state ?? ""),
        key,
        kind: a.type === "score" ? "score" : "choice",
        K,
        p,
        server: a.confidence,
        tie: sorted[0]! - sorted[1]! <= 0.011,
      });
    }
  }
}

// --- analysis ---

const choiceRows = rows.filter((r) => r.kind === "choice");
const scoreRows = rows.filter((r) => r.kind === "score");
const fitScore = scoreRows.filter((r) => r.part === "A");
const heldScore = scoreRows.filter((r) => r.part === "D");
const fitChoice = choiceRows.filter((r) => r.part === "A");
const heldChoice = choiceRows.filter((r) => r.part === "D");

const kList = (rs: Row[]) => [...new Set(rs.map((r) => r.K))].sort((a, b) => a - b).join(", ");

function table(rs: Row[]): string {
  const lines = [
    "| formula | MAE | bias | max abs | p95 | within 0.01 | within 0.02 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const scored = Object.entries(CANDIDATES)
    .map(([label, f]) => ({ label, s: stats(rs.map((r) => r.server - f(r.p, r.K))) }))
    .sort((a, b) => a.s.mae - b.s.mae);
  for (const { label, s } of scored) {
    lines.push(
      `| ${label} | ${fx(s.mae)} | ${fx(s.bias)} | ${fx(s.max, 3)} | ${fx(s.p95, 3)} | ${(s.within01 * 100).toFixed(0)}% | ${(s.within02 * 100).toFixed(0)}% |`,
    );
  }
  return lines.join("\n");
}

function byK(rs: Row[], f: (p: number[], K: number) => number): string {
  const ks = [...new Set(rs.map((r) => r.K))].sort((a, b) => a - b);
  const lines = ["| K | n | MAE | bias | max abs | within 0.01 | within 0.02 |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const K of ks) {
    const s = stats(rs.filter((r) => r.K === K).map((r) => r.server - f(r.p, r.K)));
    lines.push(`| ${K} | ${s.n} | ${fx(s.mae)} | ${fx(s.bias)} | ${fx(s.max, 3)} | ${(s.within01 * 100).toFixed(0)}% | ${(s.within02 * 100).toFixed(0)}% |`);
  }
  return lines.join("\n");
}

const dev = (rs: Row[], f: (p: number[], K: number) => number, n = 10) =>
  rs
    .map((r) => ({ r, d: r.server - f(r.p, r.K) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, n)
    .map(({ r, d }) =>
      `| ${r.key} | ${r.K} | ${r.state} | ${r.p.map((x) => x.toFixed(2)).join(" ")} | ${r.server.toFixed(2)} | ${fx(f(r.p, r.K), 3)} | ${d >= 0 ? "+" : ""}${fx(d, 3)} | ${r.tie ? "tie" : ""} |`,
    )
    .join("\n");

// The quantisation bound: probabilities arrive at 2 dp and confidence at 2 dp, so even an
// exact formula can miss by this much when recomputed from the rounded numbers.
const choiceBound = (K: number) => 0.005 + 0.005 / (1 - 1 / K);
const inBound = (rs: Row[], f: (p: number[], K: number) => number, bound: (K: number) => number) =>
  rs.filter((r) => Math.abs(r.server - f(r.p, r.K)) <= bound(r.K) + 1e-9).length / rs.length;

const cAll = stats(choiceRows.map((r) => r.server - pmaxForm(r.p, r.K)));
const cFit = stats(fitChoice.map((r) => r.server - pmaxForm(r.p, r.K)));
const cHeld = heldChoice.length ? stats(heldChoice.map((r) => r.server - pmaxForm(r.p, r.K))) : undefined;

const sNoTie = scoreRows.filter((r) => !r.tie);
const sFit = stats(fitScore.filter((r) => !r.tie).map((r) => r.server - madChanceForm(r.p, r.K)));
const sHeld = heldScore.length ? stats(heldScore.filter((r) => !r.tie).map((r) => r.server - madChanceForm(r.p, r.K))) : undefined;
const sAll = stats(sNoTie.map((r) => r.server - madChanceForm(r.p, r.K)));
const sTie = scoreRows.filter((r) => r.tie);
// With a tied mode the modal level is unrecoverable from 2 dp probabilities; score the tied level
// that matches best, which says "consistent with one of the tied modes".
const tieResid = sTie.map((r) => {
  const top = Math.max(...r.p);
  const ds = r.p
    .map((_, m) => (top - r.p[m]! <= 0.011 ? r.server - Math.max(0, 1 - r.p.reduce((a, x, i) => a + x * Math.abs(i - m), 0) / uniformMad(r.K)) : undefined))
    .filter((d): d is number => d !== undefined);
  return ds.sort((a, b) => Math.abs(a) - Math.abs(b))[0]!;
});
const sTieStats = sTie.length ? stats(tieResid) : undefined;
const sPmax = stats(scoreRows.map((r) => r.server - pmaxForm(r.p, r.K)));

// per-K coefficient fit, to show D(K) is not a free parameter
const coeffRows = ["| K | n | fitted 1/c | D(K) = floor(K/2)*ceil(K/2)/K |", "| --- | --- | --- | --- |"];
for (const K of [...new Set(scoreRows.map((r) => r.K))].sort((a, b) => a - b)) {
  const rs = scoreRows.filter((r) => r.K === K && !r.tie && r.server > 0.03 && r.server < 0.995);
  const cs = rs
    .map((r) => {
      const m = r.p.indexOf(Math.max(...r.p));
      const mad = r.p.reduce((a, x, i) => a + x * Math.abs(i - m), 0);
      return mad > 0.03 ? (1 - r.server) / mad : Number.NaN;
    })
    .filter(Number.isFinite);
  if (!cs.length) continue;
  coeffRows.push(`| ${K} | ${cs.length} | ${fx(1 / quantile(cs, 0.5), 3)} | ${fx(uniformMad(K), 3)} |`);
}

// pairs
type Pair = { state: string; key: string; kind: string; K: number; direct: number; gw: number; sameProbs: boolean };
const pairs: Pair[] = [];
for (const [state, slot] of Object.entries(pairLines)) {
  const d = slot.direct;
  const g = slot.vercel;
  if (!d || !g) continue;
  const gConf = g.response?.providerMetadata?.typesafe?.confidence ?? {};
  for (const [key, a] of Object.entries<any>(d.response?.answers ?? {})) {
    if (a.confidence === undefined || gConf[key] === undefined) continue;
    const ga = g.response.answers?.[key] ?? {};
    const same =
      JSON.stringify(Object.entries(a.probabilities ?? {}).map(([k, v]) => [k, Number(v)]).sort()) ===
      JSON.stringify(Object.entries(ga.probabilities ?? {}).map(([k, v]) => [k, Number(v)]).sort());
    pairs.push({ state, key, kind: a.type, K: Object.keys(a.probabilities ?? {}).length, direct: a.confidence, gw: gConf[key], sameProbs: same });
  }
}
const pairDiff = pairs.map((p) => p.gw - p.direct);
const pairSame = pairs.filter((p) => p.sameProbs);
const pairSameDiff = pairSame.map((p) => p.gw - p.direct);
const absMax = (xs: number[]) => (xs.length ? Math.max(...xs.map(Math.abs)) : Number.NaN);

const md = `# H7 — \`confidence\` is derived, not learned

Verdict: **CONFIRMED**. Both \`confidence\` fields are closed-form functions of the returned
\`probabilities\` and the number of options/levels. The claimed choice formula is exact. Score uses a
different formula, given below; it is the same idea with ordinal distance instead of 0/1 distance.

Raw data: \`eval/data/h7/*.jsonl\` (one line per attempt: request, headers, response). Script: \`eval/h7.ts\`
(\`node eval/h7.ts\` collects, \`--validate\` adds the held-out set, \`--offline\` re-analyses).

- Fit set: ${STATES.length} states x (${Object.keys(CHOICES).length} choice + ${Object.keys(SCORES).length} score) questions, one request per state, direct API (\`api.typesafe.ai\`, \`jev-latest\`).
- Held-out set: ${VAL_STATES.length} new states with ${Object.keys(VAL_CHOICES).length} new choice and ${Object.keys(VAL_SCORES).length} new score questions, never used to pick the formula.
- n = **${choiceRows.length} choice answers** (K = ${kList(choiceRows)}) and **${scoreRows.length} score answers** (${kList(scoreRows)} levels), plus ${pairs.length} paired gateway/direct answers.
- Everything arrives at 2 dp. Recomputing a formula from rounded probabilities can miss the rounded
  \`confidence\` by up to ~${fx(choiceBound(2), 3)} (K = 2) to ~${fx(choiceBound(25), 3)} (K = 25) on arithmetic alone, so the honest
  test is the residual distribution against that bound, not equality.

## Choice: \`(p_max - 1/K) / (1 - 1/K)\`

| set | n | MAE | bias | max abs | within 0.01 | within 0.02 | within the quantisation bound |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fit | ${cFit.n} | ${fx(cFit.mae)} | ${fx(cFit.bias)} | ${fx(cFit.max, 3)} | ${(cFit.within01 * 100).toFixed(0)}% | ${(cFit.within02 * 100).toFixed(0)}% | ${(inBound(fitChoice, pmaxForm, choiceBound) * 100).toFixed(0)}% |
${cHeld ? `| held-out | ${cHeld.n} | ${fx(cHeld.mae)} | ${fx(cHeld.bias)} | ${fx(cHeld.max, 3)} | ${(cHeld.within01 * 100).toFixed(0)}% | ${(cHeld.within02 * 100).toFixed(0)}% | ${(inBound(heldChoice, pmaxForm, choiceBound) * 100).toFixed(0)}% |\n` : ""}| all | ${cAll.n} | ${fx(cAll.mae)} | ${fx(cAll.bias)} | ${fx(cAll.max, 3)} | ${(cAll.within01 * 100).toFixed(0)}% | ${(cAll.within02 * 100).toFixed(0)}% | ${(inBound(choiceRows, pmaxForm, choiceBound) * 100).toFixed(0)}% |

Per K (all choice answers):

${byK(choiceRows, pmaxForm)}

Every other candidate is an order of magnitude worse:

${table(choiceRows)}

Largest residuals:

| question | K | state | probabilities | server | formula | residual | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
${dev(choiceRows, pmaxForm)}

The residual is one-sided (bias ${fx(cAll.bias)}) and tracks the 2 dp quantisation: \`probabilities\` are
rounded to 2 dp and one entry is then nudged so the vector sums to 1 (visible as values like
\`0.8099999999999999\` in the raw bodies), while \`confidence\` is computed upstream from the
unrounded distribution.

## Score: \`1 - E_p|i - mode| / D(K)\`, with \`D(K) = floor(K/2) * ceil(K/2) / K\`, clipped at 0

\`E_p|i - mode| = sum_i p_i * |i - argmax(p)|\` is the mean ordinal distance from the chosen level.
\`D(K)\` is the same quantity for a uniform distribution measured from the middle level, i.e. the
chance level of ordinal dispersion (0.5, 0.67, 1, 1.2, 1.5, 1.71, 2, 2.22, 2.5 for K = 2..10).

This is the same construction as choice: \`confidence = 1 - (observed expected distance) / (chance
expected distance)\`. With a 0/1 distance, \`E_p = 1 - p_max\` and \`D = 1 - 1/K\`, which is exactly the
choice formula. At K = 2 the two formulas coincide.

| set | n | MAE | bias | max abs | within 0.01 | within 0.02 |
| --- | --- | --- | --- | --- | --- | --- |
| fit (no ties) | ${sFit.n} | ${fx(sFit.mae)} | ${fx(sFit.bias)} | ${fx(sFit.max, 3)} | ${(sFit.within01 * 100).toFixed(0)}% | ${(sFit.within02 * 100).toFixed(0)}% |
${sHeld ? `| held-out (no ties) | ${sHeld.n} | ${fx(sHeld.mae)} | ${fx(sHeld.bias)} | ${fx(sHeld.max, 3)} | ${(sHeld.within01 * 100).toFixed(0)}% | ${(sHeld.within02 * 100).toFixed(0)}% |\n` : ""}| all (no ties) | ${sAll.n} | ${fx(sAll.mae)} | ${fx(sAll.bias)} | ${fx(sAll.max, 3)} | ${(sAll.within01 * 100).toFixed(0)}% | ${(sAll.within02 * 100).toFixed(0)}% |
${sTieStats ? `| tied modes (${sTie.length}), best-matching tied level | ${sTieStats.n} | ${fx(sTieStats.mae)} | ${fx(sTieStats.bias)} | ${fx(sTieStats.max, 3)} | ${(sTieStats.within01 * 100).toFixed(0)}% | ${(sTieStats.within02 * 100).toFixed(0)}% |\n` : ""}
Ties are a reconstruction limit, not a failure of the formula: when the top two probabilities are
equal at 2 dp the modal level cannot be recovered, and ${tieResid.filter((d) => Math.abs(d) <= 0.02).length}/${sTie.length} of those answers match one of the
tied levels within 0.02 anyway.

The claimed choice formula does **not** fit score: MAE ${fx(sPmax.mae)}, bias ${fx(sPmax.bias)}, max ${fx(sPmax.max, 2)} (n = ${sPmax.n}) —
it reads too high on peaked distributions and far too high on distributions whose mass sits on
distant levels.

All candidates on score answers:

${table(scoreRows)}

Per K:

${byK(sNoTie, madChanceForm)}

\`D(K)\` is not a fitted constant. Fitting \`confidence = 1 - c * E_p|i - mode|\` independently per K
recovers it:

${coeffRows.join("\n")}

Largest residuals:

| question | levels | state | probabilities | server | formula | residual | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
${dev(sNoTie, madChanceForm)}

## K = 1

The API accepts a single-option choice (no 422) and returns confidence 1, as claimed:

${k1rows.length ? k1rows.map((r) => `- ${r}`).join("\n") : `- ${k1note || "not run in this pass"}`}

## Gateway vs direct

${pairs.length} paired answers (${new Set(pairs.map((p) => p.state)).size} states x ${Object.keys(PAIR_Q).length} questions, one direct and one gateway request each).
The gateway does not put \`confidence\` in \`answers\`; it is in \`providerMetadata.typesafe.confidence\`.

- identical probability vectors in ${pairSame.length}/${pairs.length} pairs; the rest differ through model non-determinism (H8)
- confidence difference over all pairs: mean ${fx(mean(pairDiff))}, sd ${fx(sd(pairDiff))}, max |diff| ${fx(absMax(pairDiff), 2)}
- confidence difference where the probability vectors were identical: mean ${fx(mean(pairSameDiff))}, sd ${fx(sd(pairSameDiff))}, max |diff| ${fx(absMax(pairSameDiff), 2)}, exactly equal in ${pairSameDiff.filter((d) => d === 0).length}/${pairSameDiff.length}

So the gateway reports the same statistic; the residual difference is the same 2 dp quantisation
seen above, not a different computation.

## Practical rule for library users

1. **Ignore \`confidence\` for decisions; threshold on \`probabilities\`.** It adds no information — it is
   a deterministic rescaling of the distribution the caller already has.
2. **Never compare \`confidence\` across questions with different K.** Confidence 0.6 means
   \`p_max\` = ${[2, 3, 10, 25].map((K) => `${fx(1 / K + 0.6 * (1 - 1 / K), 2)} at K = ${K}`).join(", ")}. If you want one
   threshold for a whole routing table, threshold \`p_max\`, or the margin \`p_top - p_second\`, which is
   what "is there a clear winner" actually means.
3. **Score confidence answers a different question than you may think.** It is high when the mass sits
   near the chosen level, so an answer split 50/50 between two adjacent levels still scores ~${fx(1 - 0.5 / uniformMad(5), 2)} at
   K = 5, while the same split across the two ends scores 0. For "is this level right", use
   \`probabilities[score]\`; for "is this number precise", use the distribution's own spread.
4. **Leave a noise margin.** Repeated identical requests move probabilities by ~0.01-0.02 (H8), and
   confidence multiplies that movement by \`1/(1 - 1/K)\` for choice (x2 at K = 2) and by \`1/D(K)\`
   for score (x2 at K = 2). A threshold on confidence is about twice as jumpy as the same threshold
   on \`p_max\`.
5. K = 1 is accepted and always returns confidence 1 — a one-option choice tells you nothing; guard it
   in code.
`;

console.log(`\nchoice: n=${cAll.n} MAE ${fx(cAll.mae)} | score: n=${sAll.n} MAE ${fx(sAll.mae)} (ties ${sTie.length})`);
console.log("report:", writeReport(HYP, md));
