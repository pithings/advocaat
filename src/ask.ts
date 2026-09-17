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

// Each tag works both as ask.choice`...`(criteria) and ask.choice("...", criteria).

export function choice<const T extends ChoiceCriteria>(
  question: string,
  criteria: T,
): ChoiceQuestion<T>;
export function choice(
  strings: Strings,
  ...values: unknown[]
): <const T extends ChoiceCriteria>(criteria: T) => ChoiceQuestion<T>;
export function choice(first: string | Strings, ...rest: unknown[]) {
  return typeof first === "string"
    ? choiceQuestion(first, rest[0] as ChoiceCriteria)
    : <const T extends ChoiceCriteria>(criteria: T) => choiceQuestion(text(first, rest), criteria);
}

export function score<const T extends ScoreCriteria>(
  question: string,
  criteria: T,
): ScoreQuestion<T>;
export function score(
  strings: Strings,
  ...values: unknown[]
): <const T extends ScoreCriteria>(criteria: T) => ScoreQuestion<T>;
export function score(first: string | Strings, ...rest: unknown[]) {
  return typeof first === "string"
    ? scoreQuestion(first, rest[0] as ScoreCriteria)
    : <const T extends ScoreCriteria>(criteria: T) => scoreQuestion(text(first, rest), criteria);
}

export function chance(question: string, criteria?: NoulQuestion["criteria"]): NoulQuestion;
export function chance(
  strings: Strings,
  ...values: unknown[]
): (criteria?: NoulQuestion["criteria"]) => NoulQuestion;
export function chance(first: string | Strings, ...rest: unknown[]) {
  return typeof first === "string"
    ? noul(first, rest[0] as NoulQuestion["criteria"])
    : (criteria?: NoulQuestion["criteria"]) => noul(text(first, rest), criteria);
}

ask.choice = choice;
ask.score = score;
ask.chance = chance;
