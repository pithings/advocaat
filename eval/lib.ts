// Experiment harness for the TypeSafe "Jev" evaluation model.
// Sends the same questions to the Vercel AI Gateway or the direct System One API.
// Run: node eval/<script>.ts   (Node >= 22.18 strips types natively; keys are read from .env here)

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const EVAL_DIR = dirname(new URL(import.meta.url).pathname);
const DATA_DIR = join(EVAL_DIR, "data");
const ENDPOINTS = {
  vercel: "https://ai-gateway.vercel.sh/v4/ai/evaluation-model",
  typesafe: "https://api.typesafe.ai/v1/systemone",
};

export type Provider = keyof typeof ENDPOINTS;

// --- .env ---

// Reads the repo .env without --env-file, and takes commented-out keys too.
function envFile(): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(join(EVAL_DIR, "..", ".env"), "utf8");
  } catch {}
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^#+\s*/, "");
    const eq = line.indexOf("=");
    if (eq < 1 || !/^[A-Z_][A-Z0-9_]*$/i.test(line.slice(0, eq))) continue;
    out[line.slice(0, eq)] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const FILE_ENV = envFile();

/** Value from the process environment, else from .env (commented lines included). */
export const env = (name: string): string | undefined =>
  process.env[name]?.trim() || FILE_ENV[name]?.trim() || undefined;

// --- questions (provider-neutral; converted at send time) ---

export type Entry = unknown;

export type Question =
  | { type: "noul"; instructions: Entry; criteria?: unknown }
  | { type: "choice"; instructions: Entry; criteria: Record<string, unknown> }
  | { type: "score"; instructions: Entry; criteria: unknown[] };

/** Yes/no question; sent as "boolean" through the gateway. */
export const noul = (instructions: Entry, criteria?: { true?: Entry; false?: Entry }): Question => ({
  type: "noul",
  instructions,
  ...(criteria ? { criteria } : {}),
});

/** One label out of 2-255 options. */
export const choice = (instructions: Entry, criteria: Record<string, unknown>): Question => ({
  type: "choice",
  instructions,
  criteria,
});

/** One level out of 2-10 ordered descriptions. */
export const score = (instructions: Entry, levels: unknown[]): Question => ({
  type: "score",
  instructions,
  criteria: levels,
});

/** (max(p) - 1/n) / (1 - 1/n) over the values of a probability map or array. */
export function confidence(probabilities: Record<string, number> | number[]): number {
  const p = Array.isArray(probabilities) ? probabilities : Object.values(probabilities);
  const n = p.length;
  if (n < 2) return 1;
  const sum = p.reduce((a, b) => a + b, 0);
  const max = Math.max(...(sum > 0 ? p.map((v) => v / sum) : p));
  return (max - 1 / n) / (1 - 1 / n);
}

/** The model's own confidence per question, from `providerMetadata.typesafe` (gateway only). */
export const serverConfidence = (raw: any): Record<string, number> =>
  raw?.providerMetadata?.typesafe?.confidence ?? {};

/** Server-side time in ms: gateway routing metadata (vercel) or the envoy header (typesafe). */
export function upstreamMs(res: any): number | undefined {
  const raw = res?.raw ?? res;
  const a = raw?.providerMetadata?.gateway?.routing?.modelAttempts?.[0]?.providerAttempts?.[0];
  if (a) return a.endTime - a.startTime;
  const h = Number(res?.headers?.["x-envoy-upstream-service-time"]);
  return Number.isFinite(h) ? h : undefined;
}

// --- transport ---

export interface Body {
  state: unknown;
  questions: Record<string, Question>;
  providerOptions?: unknown;
}

/** One answer shape for both providers. */
export interface Answer {
  type: "noul" | "choice" | "score";
  probability?: number;
  choice?: string;
  score?: number;
  probabilities: Record<string, number>;
  confidence?: number;
  legend?: Record<string, unknown>;
}

export interface SendResult {
  provider: Provider;
  answers: Record<string, Answer>;
  usage: Record<string, number> | undefined;
  headers: Record<string, string>;
  latencyMs: number;
  status: number;
  raw: any;
}

export interface SendOptions {
  /** Which API to use. Default `"vercel"`. */
  provider?: Provider;
  /** Minimum gap between requests in this process. */
  pace?: number;
  /** Max attempts including the first. */
  tries?: number;
}

let queue: Promise<unknown> = Promise.resolve();
let lastSentAt = 0;

/** Runs `fn` after every earlier call, one at a time. */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST one request, retrying 429/529/network errors, logging every attempt to JSONL. */
export function send(
  hyp: string,
  body: Body,
  meta: Record<string, unknown> = {},
  options: SendOptions = {},
): Promise<SendResult> {
  const provider = options.provider ?? "vercel";
  const pace = options.pace ?? 150;
  const tries = options.tries ?? 6;
  const request = toWire(provider, body);
  return serial(async () => {
    const wait = pace - (Date.now() - lastSentAt);
    if (wait > 0) await sleep(wait);

    let retries = 0;
    for (;;) {
      lastSentAt = Date.now();
      const started = performance.now();
      let status = 0;
      let headers: Record<string, string> = {};
      let text = "";
      let error: string | undefined;
      try {
        const res = await fetch(ENDPOINTS[provider], {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key(provider)}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(provider === "vercel"
              ? {
                  "ai-gateway-protocol-version": "0.0.1",
                  "ai-gateway-auth-method": "api-key",
                  "ai-evaluation-model-specification-version": "4",
                  "ai-model-id": "typesafe-ai/jev",
                }
              : {}),
          },
          body: JSON.stringify(request),
        });
        status = res.status;
        headers = Object.fromEntries(res.headers.entries());
        text = await res.text();
      } catch (e) {
        error = String(e);
      }
      const latencyMs = performance.now() - started;
      let raw: unknown = text;
      try {
        raw = JSON.parse(text);
      } catch {}

      log(hyp, {
        ts: new Date().toISOString(),
        hyp,
        provider,
        meta,
        request,
        status,
        headers,
        response: raw,
        error,
        latencyMs,
        retries,
      });

      const retryable = error !== undefined || status === 429 || status === 529 || status >= 500;
      if (!error && status >= 200 && status < 300) {
        const r = raw as any;
        return {
          provider,
          answers: normalize(provider, body.questions, r),
          usage: r?.usage,
          headers,
          latencyMs,
          status,
          raw: r,
        };
      }
      if (!retryable || retries >= tries - 1) {
        throw new Error(`${hyp} (${provider}): ${error ?? `HTTP ${status} ${text.slice(0, 300)}`}`);
      }
      const after = Number(headers["retry-after"]);
      retries++;
      await sleep(
        Number.isFinite(after) && after > 0
          ? Math.min(after * 1000, 60_000)
          : 500 * 2 ** (retries - 1) * (1 + Math.random() * 0.25),
      );
    }
  });
}

function key(provider: Provider): string {
  const name = provider === "vercel" ? "AI_GATEWAY_API_KEY" : "TYPESAFE_API_KEY";
  const k = env(name);
  if (!k) throw new Error(`${name} is not set in the environment or .env.`);
  return k;
}

// The gateway calls noul "boolean" and rejects null instructions; System One wants a model name.
function toWire(provider: Provider, body: Body) {
  const questions: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(body.questions)) {
    questions[name] =
      provider === "vercel"
        ? {
            type: q.type === "noul" ? "boolean" : q.type,
            instructions: q.instructions ?? "",
            ...(q.criteria === undefined ? {} : { criteria: q.criteria }),
          }
        : { ...q };
  }
  return provider === "vercel"
    ? { state: body.state, questions, ...(body.providerOptions ? { providerOptions: body.providerOptions } : {}) }
    : { state: body.state, model: "jev-latest", questions };
}

// One answer shape for both providers; gateway confidence comes from providerMetadata.
function normalize(
  provider: Provider,
  questions: Record<string, Question>,
  raw: any,
): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  const extra = provider === "vercel" ? serverConfidence(raw) : {};
  for (const [name, a] of Object.entries<any>(raw?.answers ?? {})) {
    const probabilities = a.probabilities ?? {};
    const conf = a.confidence ?? extra[name];
    if (a.type === "boolean" || a.type === "noul") {
      out[name] = { type: "noul", probability: a.probability ?? a.noul, probabilities };
    } else if (a.type === "choice") {
      out[name] = { type: "choice", choice: a.choice, probabilities, confidence: conf };
    } else {
      const q = questions[name];
      out[name] = {
        type: "score",
        score: a.score,
        probabilities,
        confidence: conf,
        legend: a.legend ?? (q?.type === "score" ? { ...q.criteria } : undefined),
      };
    }
  }
  return out;
}

function log(hyp: string, line: unknown): void {
  const dir = join(DATA_DIR, hyp);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  appendFileSync(file, JSON.stringify(line) + "\n");
}

/** Writes eval/data/<hyp>/REPORT.md. */
export function writeReport(hyp: string, markdown: string): string {
  const dir = join(DATA_DIR, hyp);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "REPORT.md");
  writeFileSync(file, markdown);
  return file;
}

// --- statistics ---

export const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Sample standard deviation (n-1). */
export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

export const median = (xs: number[]): number => quantile(xs, 0.5);

/** Wilson score interval for k successes out of n. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number; p: number } {
  if (n === 0) return { lo: 0, hi: 1, p: Number.NaN };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (center - half) / d), hi: Math.min(1, (center + half) / d), p };
}

/** Paired t-test on two equal-length samples. */
export function pairedT(
  a: number[],
  b: number[],
): { t: number; df: number; p: number; meanDiff: number; n: number } {
  if (a.length !== b.length) throw new Error("pairedT needs equal-length samples");
  const d = a.map((x, i) => x - b[i]!);
  const n = d.length;
  const m = mean(d);
  const s = sd(d);
  const t = s === 0 ? (m === 0 ? 0 : Infinity) : m / (s / Math.sqrt(n));
  const df = n - 1;
  return { t, df, p: tTwoSided(t, df), meanDiff: m, n };
}

/** Two-sided p-value of Student's t with `df` degrees of freedom. */
export function tTwoSided(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  if (df <= 0) return Number.NaN;
  return incBeta(df / (df + t * t), df / 2, 0.5);
}

export const logOdds = (pA: number, pB: number): number => Math.log(pA / pB);

/** Seedable PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy, with a seed or a random function. */
export function shuffle<T>(xs: readonly T[], seed: number | (() => number) = Math.random): T[] {
  const rnd = typeof seed === "number" ? mulberry32(seed) : seed;
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// Regularized incomplete beta I_x(a, b) via the Lentz continued fraction.
function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (front / a) * betacf(x, a, b);
  return 1 - (front / b) * betacf(1 - x, b, a);
}

function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let num = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + num * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + num / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    num = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + num * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + num / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

// Lanczos approximation of log Γ(x).
function lgamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) a += g[i]! / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}
