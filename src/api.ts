// Minimal fetch client for the TypeSafe System One API.
// Wire format mirrors github.com/typesafe-ai/typesafe-sdk-js without retries or logging.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Text, a JSON object or array, or `null` for state, instructions, and criteria. */
export type Entry = string | Json[] | { [key: string]: Json } | null;

// --- questions ---

export interface NoulQuestion {
  type: "noul";
  instructions?: Entry;
  criteria?: { true?: Entry; false?: Entry } | null;
}

export type ChoiceCriteria = { [label: string]: Entry };

export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  type: "choice";
  instructions?: Entry;
  criteria: T;
}

/** At least two descriptions indexed by score from zero. */
export type ScoreCriteria = readonly [Entry, Entry, ...Entry[]];

export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
  type: "score";
  instructions?: Entry;
  criteria: T;
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

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

export interface NoulAnswer {
  readonly type: "noul";
  /** Probability of a yes answer, from zero to one. */
  readonly noul: number;
}

export interface ChoiceAnswer<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "choice";
  readonly choice: keyof T & string;
  readonly confidence: number;
  readonly probabilities: { readonly [label in keyof T]: number };
}

/** Score keys inferred from the rubric; a fixed-length tuple yields its indices, otherwise `number`. */
export type ScoreOf<T extends ScoreCriteria> = number extends T["length"]
  ? number
  : Extract<keyof T, `${number}`>;

export interface ScoreAnswer<T extends ScoreCriteria = ScoreCriteria> {
  readonly type: "score";
  /** Expected score, which may fall between integer rubric levels. */
  readonly score: number;
  readonly confidence: number;
  readonly legend: { readonly [score in ScoreOf<T>]: T[score] };
  readonly probabilities: { readonly [score in ScoreOf<T>]: number };
}

export type AnswerFor<T extends Question> = T extends NoulQuestion
  ? NoulAnswer
  : T extends ScoreQuestion<infer S>
    ? ScoreAnswer<S>
    : T extends ChoiceQuestion<infer C>
      ? ChoiceAnswer<C>
      : never;

export interface SystemOneRequest<Q extends Questions = Questions> {
  state: Entry;
  questions: Q;
  model?: string;
}

export interface SystemOneResult<Q extends Questions> {
  readonly model: string;
  readonly answers: { readonly [K in keyof Q]: AnswerFor<Q[K]> };
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
}

export interface ModelCard {
  readonly name: string;
  readonly description: string;
  readonly release_date: string;
}

// --- client ---

/** Explicit options win over `TYPESAFE_*` environment variables, then defaults. */
export interface TypeSafeOptions {
  /** Env: `TYPESAFE_API_KEY` */
  apiKey?: string;
  /** Env: `TYPESAFE_BASE_URL`. Default: `https://api.typesafe.ai` */
  baseURL?: string;
  /** Env: `TYPESAFE_DEFAULT_MODEL`. Default: `jev-latest` */
  model?: string;
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** A non-2xx response from the API. */
export class APIError extends Error {
  override name = "APIError";
  status: number;
  body: unknown;
  requestId: string;
  constructor(status: number, body: unknown, requestId = "") {
    super(`${status} ${describe(body)}`);
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

export function typesafe(options: TypeSafeOptions = {}) {
  const apiKey = options.apiKey ?? env("TYPESAFE_API_KEY");
  if (!apiKey) {
    throw new TypeError(
      "Pass `apiKey` to typesafe() or set the TYPESAFE_API_KEY environment variable.",
    );
  }
  const baseURL = (
    options.baseURL ??
    env("TYPESAFE_BASE_URL") ??
    "https://api.typesafe.ai"
  ).replace(/\/+$/, "");
  const model = options.model ?? env("TYPESAFE_DEFAULT_MODEL") ?? "jev-latest";
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
      throw new APIError(res.status, parsed, res.headers.get("x-typesafe-request-id") ?? "");
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
      return request<SystemOneResult<Q>>(
        "POST",
        "/v1/systemone",
        { ...req, model: req.model ?? model },
        init,
      );
    },
    async models(init?: RequestOptions) {
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

export type TypeSafe = ReturnType<typeof typesafe>;

const within = (list: unknown, min: number, max: number) =>
  Array.isArray(list) && list.length >= min && list.length <= max;

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
