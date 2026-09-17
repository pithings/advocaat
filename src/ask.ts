// `ask(state, questions)`: tagged questions over the System One client. See IDEA.md.

import {
  choice as choiceQuestion,
  noul,
  score as scoreQuestion,
  typesafe,
  type ChoiceAnswer,
  type ChoiceCriteria,
  type ChoiceQuestion,
  type Entry,
  type Json,
  type NoulQuestion,
  type Question,
  type RequestOptions,
  type ScoreAnswer,
  type ScoreCriteria,
  type ScoreQuestion,
  type TypeSafeOptions,
} from "./api.ts";

/** A bare string is a yes/no question. */
export type AskQuestion = string | Question | IfQuestion;

export type AskQuestions = { [name: string]: AskQuestion };

export interface ChanceAnswer {
  readonly type: "chance";
  /** Probability of a yes answer, from zero to one. */
  readonly chance: number;
}

export type Answer<Q extends AskQuestion> = Q extends IfQuestion
  ? boolean
  : Q extends string | NoulQuestion
    ? ChanceAnswer
    : Q extends ScoreQuestion<infer S>
      ? ScoreAnswer<S> & { /** Score scaled to 0–1. */ readonly ratio: number }
      : Q extends ChoiceQuestion<infer C>
        ? ChoiceAnswer<C>
        : never;

export type Answers<Q extends AskQuestions> = { readonly [K in keyof Q]: Answer<Q[K]> };

export type AskOptions = TypeSafeOptions & RequestOptions;

/** A question from a tag: a key in `ask`, or awaited on its own to send it with its interpolated state. */
export type Askable<Q extends Question | IfQuestion> = Q & PromiseLike<Answer<Q>>;

/** A yes/no question from `ask.if` that resolves to a boolean. */
export interface IfQuestion {
  readonly type: "if";
  readonly instructions: string;
  readonly threshold: number;
}

// Interpolated state of tagged questions, kept off the wire. Only set when not empty.
const states = new WeakMap<object, Entry>();

/** Sends every question in one request and resolves to answers under the same keys. */
export async function ask<const Q extends AskQuestions>(
  state: Entry,
  questions: Q,
  options: AskOptions = {},
): Promise<Answers<Q>> {
  const wire: { [name: string]: Question } = {};
  for (const [name, q] of Object.entries(questions)) {
    if (typeof q === "string") {
      wire[name] = noul(q);
      continue;
    }
    // A tag that interpolated objects can only be sent with that state, which only its own `then` passes.
    const own = states.get(q);
    if (own !== undefined && own !== state)
      throw new Error(`"${name}" interpolates objects; await it on its own`);
    wire[name] = q.type === "if" ? noul(q.instructions) : q;
  }
  const { answers } = await typesafe(options).systemOne({ state, questions: wire }, options);
  const out: { [name: string]: unknown } = {};
  for (const [name, a] of Object.entries(answers)) {
    const q = questions[name]!;
    out[name] =
      a.type === "noul"
        ? typeof q === "object" && q.type === "if"
          ? a.noul > q.threshold
          : { type: "chance", chance: a.noul }
        : a.type === "score"
          ? { ...a, ratio: a.score / ((wire[name] as ScoreQuestion).criteria.length - 1) }
          : a;
  }
  return out as Answers<Q>;
}

type Strings = TemplateStringsArray;

const isTag = (first: unknown): first is Strings => Array.isArray(first) && "raw" in first;

// Text values go into the question. Interpolated objects and arrays are the state: one is
// sent as `input`, several as the `input` array, and each slot becomes its path (see .agents/typesafe.md).
// Without any, the question itself carries the content and the state is empty.
function parse(strings: Strings, values: unknown[]): { instructions: string; state: Entry } {
  const many = values.filter((value) => typeof value === "object" && value !== null).length > 1;
  const parts: Json[] = [];
  const slots = values.map((value) => {
    if (typeof value !== "object" || value === null) return value;
    parts.push(value as Json);
    return many ? `\`input[${parts.length - 1}]\`` : "`input`";
  });
  return {
    instructions: strings.reduce((out, s, i) => out + String(slots[i - 1]) + s),
    state: parts.length === 0 ? "" : { input: many ? parts : parts[0]! },
  };
}

// Adds a hidden `then` that sends the question alone, so the object stays a plain question.
function askable<Q extends Question | IfQuestion>(q: Q, state: Entry, options?: AskOptions) {
  if (state !== "") states.set(q, state);
  const then: PromiseLike<Answer<Q>>["then"] = (ok, fail) =>
    ask(state, { q }, options)
      .then(({ q }) => q as Answer<Q>)
      .then(ok, fail);
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting is how a tag sends on its own
  return Object.defineProperty(q, "then", { value: then }) as Askable<Q>;
}

// Each tag works both as ask.choice`...`(criteria, options?) and ask.choice(instructions, criteria, options?),
// where plain-call instructions may be a JSON object or array (see .agents/typesafe.md).
function tag<C, Q extends Question>(build: (instructions: Entry, criteria: C) => Q) {
  return (first: Entry | Strings, ...rest: unknown[]) => {
    if (!isTag(first)) return askable(build(first, rest[0] as C), "", rest[1] as AskOptions);
    const { instructions, state } = parse(first, rest);
    return (criteria: C, options?: AskOptions) =>
      askable(build(instructions, criteria), state, options);
  };
}

export const choice = tag(choiceQuestion) as {
  <const T extends ChoiceCriteria>(
    instructions: Entry,
    criteria: T,
    options?: AskOptions,
  ): Askable<ChoiceQuestion<T>>;
  (
    strings: Strings,
    ...values: unknown[]
  ): <const T extends ChoiceCriteria>(
    criteria: T,
    options?: AskOptions,
  ) => Askable<ChoiceQuestion<T>>;
};

export const score = tag(scoreQuestion) as {
  <const T extends ScoreCriteria>(
    instructions: Entry,
    criteria: T,
    options?: AskOptions,
  ): Askable<ScoreQuestion<T>>;
  (
    strings: Strings,
    ...values: unknown[]
  ): <const T extends ScoreCriteria>(
    criteria: T,
    options?: AskOptions,
  ) => Askable<ScoreQuestion<T>>;
};

export const chance = tag(noul) as {
  (
    instructions: Entry,
    criteria?: NoulQuestion["criteria"],
    options?: AskOptions,
  ): Askable<NoulQuestion>;
  (
    strings: Strings,
    ...values: unknown[]
  ): (criteria?: NoulQuestion["criteria"], options?: AskOptions) => Askable<NoulQuestion>;
};

/** Client options plus the chance needed for a true answer. */
export type AskIfOptions = AskOptions & {
  /** True when the chance is above this. Default `0.5`. */
  threshold?: number;
};

/** Asks one yes/no question about the interpolated state; true when the chance is above the threshold. */
export function askIf(strings: Strings, ...values: unknown[]): Askable<IfQuestion>;
export function askIf(
  options: AskIfOptions,
): (strings: Strings, ...values: unknown[]) => Askable<IfQuestion>;
export function askIf(first: Strings | AskIfOptions, ...values: unknown[]) {
  return isTag(first)
    ? ifQuestion({}, first, values)
    : (strings: Strings, ...rest: unknown[]) => ifQuestion(first, strings, rest);
}

function ifQuestion(options: AskIfOptions, strings: Strings, values: unknown[]) {
  const { instructions, state } = parse(strings, values);
  const q: IfQuestion = { type: "if", instructions, threshold: options.threshold ?? 0.5 };
  return askable(q, state, options);
}

ask.choice = choice;
ask.score = score;
ask.chance = chance;
ask.if = askIf;
