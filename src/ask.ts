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
export type AskQuestion = string | Question;

export type AskQuestions = { [name: string]: AskQuestion };

export interface ChanceAnswer {
  readonly type: "chance";
  /** Probability of a yes answer, from zero to one. */
  readonly chance: number;
}

export type Answer<Q extends AskQuestion> = Q extends string | NoulQuestion
  ? ChanceAnswer
  : Q extends ScoreQuestion<infer S>
    ? ScoreAnswer<S> & { /** Score scaled to 0–1. */ readonly ratio: number }
    : Q extends ChoiceQuestion<infer C>
      ? ChoiceAnswer<C>
      : never;

export type Answers<Q extends AskQuestions> = { readonly [K in keyof Q]: Answer<Q[K]> };

export type AskOptions = TypeSafeOptions & RequestOptions;

/** Sends every question in one request and resolves to answers under the same keys. */
export async function ask<const Q extends AskQuestions>(
  state: Entry,
  questions: Q,
  options: AskOptions = {},
): Promise<Answers<Q>> {
  const wire: { [name: string]: Question } = {};
  for (const [name, q] of Object.entries(questions)) {
    wire[name] = typeof q === "string" ? noul(q) : q;
  }
  const { answers } = await typesafe(options).systemOne({ state, questions: wire }, options);
  const out: { [name: string]: unknown } = {};
  for (const [name, a] of Object.entries(answers)) {
    out[name] =
      a.type === "noul"
        ? { type: "chance", chance: a.noul }
        : a.type === "score"
          ? { ...a, ratio: a.score / ((wire[name] as ScoreQuestion).criteria.length - 1) }
          : a;
  }
  return out as Answers<Q>;
}

type Strings = TemplateStringsArray;

const text = (strings: Strings, values: unknown[]) =>
  strings.reduce((out, s, i) => out + String(values[i - 1]) + s);

// Each tag works both as ask.choice`...`(criteria) and ask.choice(instructions, criteria),
// where plain-call instructions may be a JSON object or array (see .agents/typesafe.md).

const isTag = (first: unknown): first is Strings => Array.isArray(first) && "raw" in first;

export function choice<const T extends ChoiceCriteria>(
  instructions: Entry,
  criteria: T,
): ChoiceQuestion<T>;
export function choice(
  strings: Strings,
  ...values: unknown[]
): <const T extends ChoiceCriteria>(criteria: T) => ChoiceQuestion<T>;
export function choice(first: Entry | Strings, ...rest: unknown[]) {
  return isTag(first)
    ? <const T extends ChoiceCriteria>(criteria: T) => choiceQuestion(text(first, rest), criteria)
    : choiceQuestion(first, rest[0] as ChoiceCriteria);
}

export function score<const T extends ScoreCriteria>(
  instructions: Entry,
  criteria: T,
): ScoreQuestion<T>;
export function score(
  strings: Strings,
  ...values: unknown[]
): <const T extends ScoreCriteria>(criteria: T) => ScoreQuestion<T>;
export function score(first: Entry | Strings, ...rest: unknown[]) {
  return isTag(first)
    ? <const T extends ScoreCriteria>(criteria: T) => scoreQuestion(text(first, rest), criteria)
    : scoreQuestion(first, rest[0] as ScoreCriteria);
}

export function chance(instructions: Entry, criteria?: NoulQuestion["criteria"]): NoulQuestion;
export function chance(
  strings: Strings,
  ...values: unknown[]
): (criteria?: NoulQuestion["criteria"]) => NoulQuestion;
export function chance(first: Entry | Strings, ...rest: unknown[]) {
  return isTag(first)
    ? (criteria?: NoulQuestion["criteria"]) => noul(text(first, rest), criteria)
    : noul(first, rest[0] as NoulQuestion["criteria"]);
}

/** Client options plus the chance needed for a true answer. */
export type AskIfOptions = AskOptions & {
  /** True when the chance is above this. Default `0.5`. */
  threshold?: number;
};

/** Asks one yes/no question about the interpolated state and resolves to a boolean. */
export function askIf(strings: Strings, ...values: unknown[]): Promise<boolean>;
export function askIf(
  options: AskIfOptions,
): (strings: Strings, ...values: unknown[]) => Promise<boolean>;
export function askIf(first: Strings | AskIfOptions, ...values: unknown[]) {
  return isTag(first)
    ? decide({}, first, values)
    : (strings: Strings, ...rest: unknown[]) => decide(first, strings, rest);
}

// Text values go into the question. Interpolated objects and arrays are the state: one is
// sent as `input`, several as the `input` array, and each slot becomes its path (see .agents/typesafe.md).
// Without any, the question itself carries the content and the state is empty.
async function decide(options: AskIfOptions, strings: Strings, values: unknown[]) {
  const many = values.filter((value) => typeof value === "object" && value !== null).length > 1;
  const parts: Json[] = [];
  const slots = values.map((value) => {
    if (typeof value !== "object" || value === null) return value;
    parts.push(value as Json);
    return many ? `\`input[${parts.length - 1}]\`` : "`input`";
  });
  const state = parts.length === 0 ? "" : { input: many ? parts : parts[0]! };
  const { q } = await ask(state, { q: text(strings, slots) }, options);
  return q.chance > (options.threshold ?? 0.5);
}

ask.choice = choice;
ask.score = score;
ask.chance = chance;
ask.if = askIf;
