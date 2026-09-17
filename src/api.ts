// Minimal fetch client for the TypeSafe System One API.
// Wire format mirrors github.com/typesafe-ai/typesafe-sdk-js without retries or logging.
// Can also speak the Vercel AI Gateway evaluation protocol (what `@ai-sdk/gateway` sends).

/** A JSON-serializable value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Text, a JSON object or array, or `null` for state, instructions, and criteria. */
export type Entry = string | Json[] | { [key: string]: Json } | null;

// --- questions ---

/** A yes/no question answered with a probability. */
export interface NoulQuestion {
  type: "noul";
  /** A question or statement to judge as true. */
  instructions?: Entry;
  /** Optional descriptions of what counts as true or false. */
  criteria?: { true?: Entry; false?: Entry } | null;
}

/** Option labels mapped to their descriptions; requires 2–255 options. */
export type ChoiceCriteria = { [label: string]: Entry };

/** A question that selects one labeled option. */
export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  type: "choice";
  /** What to decide from the state. */
  instructions?: Entry;
  /** 2–255 option labels and descriptions; both are sent to the model. */
  criteria: T;
}

/** At least two descriptions indexed by score from zero. */
export type ScoreCriteria = readonly [Entry, Entry, ...Entry[]];

/** A question rated against 2–10 ordered score levels. */
export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
  type: "score";
  /** What to rate in the state. */
  instructions?: Entry;
  /** 2–10 level descriptions, numbered by array position from zero. */
  criteria: T;
}

/** A supported evaluation question. */
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** Named questions evaluated together against the same state. */
export type Questions = { [name: string]: Question };

export const noul = (
  instructions: Entry = null,
  criteria?: NoulQuestion["criteria"],
): NoulQuestion => ({
  type: "noul",
  instructions,
  criteria,
});

export const choice = <const T extends ChoiceCriteria>(
  instructions: Entry,
  criteria: T,
): ChoiceQuestion<T> => ({
  type: "choice",
  instructions,
  criteria,
});

export const score = <const T extends ScoreCriteria>(
  instructions: Entry,
  criteria: T,
): ScoreQuestion<T> => ({
  type: "score",
  instructions,
  criteria,
});

// --- answers ---

/** The probability that a yes/no question is true. */
export interface NoulAnswer {
  readonly type: "noul";
  /** Probability of a yes answer, from zero to one. */
  readonly noul: number;
}

/** The selected option and probability of each choice. */
export interface ChoiceAnswer<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "choice";
  /** The label of the highest-probability option. */
  readonly choice: keyof T & string;
  /** How much the top option stands out, from zero to one. Computed locally through AI Gateway. */
  readonly confidence: number;
  /** Probability of each option, keyed by its label. Empty if omitted by AI Gateway. */
  readonly probabilities: { readonly [label in keyof T]: number };
}

/** Score keys inferred from the rubric; a fixed-length tuple yields its indices, otherwise `number`. */
export type ScoreOf<T extends ScoreCriteria> = number extends T["length"]
  ? number
  : Extract<keyof T, `${number}`>;

/** The expected score, rubric, and probability of each level. */
export interface ScoreAnswer<T extends ScoreCriteria = ScoreCriteria> {
  readonly type: "score";
  /** Sum of each level number times its probability; may fall between levels. */
  readonly score: number;
  /** How much the top level stands out, from zero to one. Computed locally through AI Gateway. */
  readonly confidence: number;
  /** Level descriptions keyed by zero-based level number, e.g. { "0": "Calm" }. */
  readonly legend: { readonly [score in ScoreOf<T>]: T[score] };
  /** Probability of each level, keyed by level number. Empty if omitted by AI Gateway. */
  readonly probabilities: { readonly [score in ScoreOf<T>]: number };
}

/** The answer type inferred from a question and its criteria. */
export type AnswerFor<T extends Question> = T extends NoulQuestion
  ? NoulAnswer
  : T extends ScoreQuestion<infer S>
    ? ScoreAnswer<S>
    : T extends ChoiceQuestion<infer C>
      ? ChoiceAnswer<C>
      : never;

/** Shared state and questions, with an optional model override. */
export interface SystemOneRequest<Q extends Questions = Questions> {
  /** Content to evaluate, shared by all questions. */
  state: Entry;
  /** Questions keyed by your own names; these names are not sent to the model. */
  questions: Q;
  /** Overrides the client's default model for this request. */
  model?: string;
}

/** Answers keyed by question name, with the model used and token usage. */
export interface SystemOneResult<Q extends Questions> {
  /** The model used for this evaluation. */
  readonly model: string;
  /** Answers under the same keys as the request's questions. */
  readonly answers: { readonly [K in keyof Q]: AnswerFor<Q[K]> };
  /** Token counts; missing AI Gateway counts default to zero. */
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
}

/** Metadata for an available TypeSafe model. */
export interface ModelCard {
  readonly name: string;
  readonly description: string;
  readonly release_date: string;
}

// --- client ---

/**
 * Explicit options win over `TYPESAFE_*` environment variables, then defaults.
 * With only `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` set, requests go through Vercel AI Gateway instead.
 */
export interface TypeSafeOptions {
  /** Env: `TYPESAFE_API_KEY`, else `AI_GATEWAY_API_KEY`, else `VERCEL_OIDC_TOKEN` */
  apiKey?: string;
  /** Env: `TYPESAFE_BASE_URL`. Default: `https://api.typesafe.ai` (gateway: `https://ai-gateway.vercel.sh/v4/ai`) */
  baseURL?: string;
  /** Env: `TYPESAFE_DEFAULT_MODEL`. Default: `jev-latest` (gateway: `typesafe-ai/jev`; bare names get the `typesafe-ai/` prefix) */
  model?: string;
  /** Where to send requests. Default: `"vercel"` only when the key comes from a Vercel env variable. */
  provider?: "typesafe" | "vercel";
  /** Vercel AI Gateway settings, sent as `providerOptions.gateway`. */
  vercel?: { zeroDataRetention?: boolean };
  /** Custom fetch implementation; defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** Per-request cancellation and additional HTTP headers. */
export interface RequestOptions {
  /** Cancels the underlying fetch request. */
  signal?: AbortSignal;
  /** Additional headers; the client sets authorization and JSON content headers. */
  headers?: Record<string, string>;
}

/** A non-2xx response from the API. */
export class APIError extends Error {
  override name = "APIError";
  /** HTTP response status. */
  status: number;
  /** Response body parsed as JSON, or text if parsing fails; undefined if empty. */
  body: unknown;
  /** TypeSafe or Vercel request ID from response headers, or an empty string. */
  requestId: string;
  constructor(status: number, body: unknown, requestId = "") {
    super(`${status} ${describe(body)}`);
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

export function typesafe(options: TypeSafeOptions = {}) {
  const gateway = options.provider
    ? options.provider === "vercel"
    : options.apiKey === undefined &&
      env("TYPESAFE_API_KEY") === undefined &&
      (env("AI_GATEWAY_API_KEY") ?? env("VERCEL_OIDC_TOKEN")) !== undefined;
  // Vercel deployments carry a short-lived OIDC token instead of a gateway key.
  const oidc = gateway && options.apiKey === undefined && env("AI_GATEWAY_API_KEY") === undefined;
  const apiKey =
    options.apiKey ??
    env(oidc ? "VERCEL_OIDC_TOKEN" : gateway ? "AI_GATEWAY_API_KEY" : "TYPESAFE_API_KEY");
  if (!apiKey) {
    throw new TypeError(
      "Pass `apiKey` to typesafe() or set the TYPESAFE_API_KEY, AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN environment variable.",
    );
  }
  const baseURL = (
    options.baseURL ??
    (gateway
      ? "https://ai-gateway.vercel.sh/v4/ai"
      : (env("TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai"))
  ).replace(/\/+$/, "");
  const model =
    options.model ??
    (gateway ? "typesafe-ai/jev" : (env("TYPESAFE_DEFAULT_MODEL") ?? "jev-latest"));
  const fetch = options.fetch ?? globalThis.fetch;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    init: RequestOptions = {},
  ) {
    const res = await fetch(baseURL + path, {
      method,
      signal: init.signal,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await parse(res);
    if (!res.ok)
      throw new APIError(
        res.status,
        parsed,
        res.headers.get("x-typesafe-request-id") ?? res.headers.get("x-vercel-id") ?? "",
      );
    return parsed as T;
  }

  return {
    systemOne<const Q extends Questions>(req: SystemOneRequest<Q>, init?: RequestOptions) {
      if (Object.keys(req.questions).length === 0)
        throw new TypeError("At least one question is required.");
      for (const [name, q] of Object.entries(req.questions)) {
        if (q.type === "score" && !within(q.criteria, 2, 10))
          throw new TypeError(`Score question "${name}" needs 2 to 10 levels.`);
        if (q.type === "choice" && !within(Object.keys(q.criteria ?? {}), 2, 255))
          throw new TypeError(`Choice question "${name}" needs 2 to 255 options.`);
      }
      const name = req.model ?? model;
      if (!gateway) {
        return request<SystemOneResult<Q>>("POST", "/v1/systemone", { ...req, model: name }, init);
      }
      const id = name.includes("/") ? name : `typesafe-ai/${name}`;
      return request<GatewayResult>("POST", "/evaluation-model", toGateway(req, options.vercel), {
        ...init,
        headers: {
          ...gatewayHeaders,
          "ai-gateway-auth-method": oidc ? "oidc" : "api-key",
          "ai-model-id": id,
          ...init?.headers,
        },
      }).then((res) => fromGateway(req.questions, res, id));
    },
    async models(init?: RequestOptions) {
      if (gateway) throw new TypeError("models() is not available through AI Gateway.");
      const { models } = await request<{ models: ModelCard[] }>(
        "GET",
        "/v1/models",
        undefined,
        init,
      );
      return models;
    },
  };
}

/** A client for evaluating questions and listing models. */
export type TypeSafe = ReturnType<typeof typesafe>;

const within = (list: unknown, min: number, max: number) =>
  Array.isArray(list) && list.length >= min && list.length <= max;

// --- Vercel AI Gateway ---

const gatewayHeaders = {
  "ai-gateway-protocol-version": "0.0.1",
  "ai-evaluation-model-specification-version": "4",
};

type GatewayAnswer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; probabilities?: Record<string, number> }
  | { type: "score"; score: number; probabilities?: Record<string, number> };

interface GatewayResult {
  answers: Record<string, GatewayAnswer>;
  usage?: { inputTokens?: number; outputTokens?: number };
}

// The gateway calls noul "boolean" and rejects null instructions and criteria.
function toGateway(req: SystemOneRequest, vercel?: TypeSafeOptions["vercel"]) {
  const questions: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(req.questions)) {
    questions[name] = {
      type: q.type === "noul" ? "boolean" : q.type,
      instructions: q.instructions ?? "",
      criteria: q.criteria ?? undefined,
    };
  }
  return {
    state: req.state ?? "",
    questions,
    ...(vercel ? { providerOptions: { gateway: vercel } } : {}),
  };
}

// Rebuilds the System One shape; `legend` comes from the criteria and `confidence` is computed here.
function fromGateway<Q extends Questions>(questions: Q, res: GatewayResult, model: string) {
  const answers: Record<string, unknown> = {};
  for (const [name, a] of Object.entries(res.answers)) {
    if (a.type === "boolean") {
      answers[name] = { type: "noul", noul: a.probability };
      continue;
    }
    const probabilities = a.probabilities ?? {};
    const confidence = confidenceOf(Object.values(probabilities));
    answers[name] =
      a.type === "choice"
        ? { type: "choice", choice: a.choice, confidence, probabilities }
        : {
            type: "score",
            score: a.score,
            confidence,
            legend: { ...(questions[name] as ScoreQuestion).criteria },
            probabilities,
          };
  }
  return {
    model,
    answers,
    usage: {
      input_tokens: res.usage?.inputTokens ?? 0,
      output_tokens: res.usage?.outputTokens ?? 0,
    },
  } as SystemOneResult<Q>;
}

// Top probability rescaled so a flat spread is 0 and a certain one is 1. Fitted against the TypeSafe
// API: exact for choices and 3-level scores; longer scores with mass on neighbouring levels come out lower.
function confidenceOf(probabilities: number[]): number {
  const n = probabilities.length;
  if (n < 2) return 0;
  const c = (Math.max(...probabilities) - 1 / n) / (1 - 1 / n);
  return Math.max(0, Math.round(c * 100) / 100);
}

// Optional: only runtimes with a Node-style `process.env` provide values. Blank values count as unset.
function env(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[name]?.trim() || undefined;
}

// Servers and proxies don't always set content-type, so always try JSON first.
async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describe(body: unknown): string {
  if (typeof body === "string") return body;
  if (typeof body !== "object" || body === null) return "(no body)";
  const { error, message, detail } = body as Record<string, unknown>;
  const m = error ?? message ?? detail;
  if (typeof m === "string") return m;
  if (
    typeof m === "object" &&
    m !== null &&
    typeof (m as { message?: unknown }).message === "string"
  ) {
    return (m as { message: string }).message;
  }
  return JSON.stringify(body).slice(0, 200);
}
