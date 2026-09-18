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
export type AskQuestion = string | Question | IfQuestion | SwitchQuestion;

export type AskQuestions = { [name: string]: AskQuestion };

export interface ChanceAnswer {
  readonly type: "chance";
  /** Probability of a yes answer, from zero to one. */
  readonly chance: number;
}

export type Answer<Q extends AskQuestion> = Q extends IfQuestion
  ? boolean
  : Q extends SwitchQuestion<infer C>
    ? keyof C & string
    : Q extends string | NoulQuestion
      ? ChanceAnswer
      : Q extends ScoreQuestion<infer S>
        ? ScoreAnswer<S> & { /** Score scaled to 0–1. */ readonly ratio: number }
        : Q extends ChoiceQuestion<infer C>
          ? ChoiceAnswer<C>
          : never;

export type Answers<Q extends AskQuestions> = { readonly [K in keyof Q]: Answer<Q[K]> };

export type AskOptions = TypeSafeOptions & RequestOptions;

type Tagged = Question | IfQuestion | SwitchQuestion;

/** A question from a tag: a key in `ask`, or awaited on its own to send it with its interpolated state. */
export type Askable<Q extends Tagged> = Q & PromiseLike<Answer<Q>>;

/** A yes/no question from `ask.if` that resolves to a boolean. */
export interface IfQuestion {
  readonly type: "if";
  readonly instructions: string;
  readonly threshold: number;
}

/** A choice from `ask.switch` that resolves to the selected label. */
export interface SwitchQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "switch";
  readonly instructions: Entry;
  readonly criteria: T;
}

/** Two or more option labels without descriptions. */
export type ChoiceLabels = readonly [string, string, ...string[]];

/** Labels as criteria with `null` descriptions; an object stays as it is. */
export type Named<T> = T extends ChoiceLabels ? { [K in T[number]]: null } : T;

const named = <T extends ChoiceCriteria | ChoiceLabels>(criteria: T) =>
  (Array.isArray(criteria)
    ? Object.fromEntries(criteria.map((label) => [label, null]))
    : criteria) as Named<T>;

// Interpolated objects of tagged questions, kept off the wire until sent.
const states = new WeakMap<object, Parsed>();

async function send<const Q extends AskQuestions>(
  state: Entry,
  questions: Q,
  options: AskOptions = {},
): Promise<Answers<Q>> {
  const wire: { [name: string]: Question } = {};
  const tagged: [string, Parsed][] = [];
  for (const [name, q] of Object.entries(questions)) {
    if (typeof q === "string") {
      wire[name] = noul(q);
      continue;
    }
    const own = states.get(q);
    if (own !== undefined) tagged.push([name, own]);
    wire[name] =
      q.type === "if"
        ? noul(q.instructions)
        : q.type === "switch"
          ? choiceQuestion(q.instructions, q.criteria)
          : q;
  }
  // Interpolated objects of all tags go once each into `input`, and their slots become its paths.
  // A text or array state goes first among them.
  const inputs: Json[] = [...new Set(tagged.flatMap(([, own]) => own.parts))];
  let merged = state;
  if (inputs.length > 0) {
    if (merged === null || typeof merged !== "object" || Array.isArray(merged)) {
      if (merged !== "" && merged !== null && !inputs.includes(merged)) inputs.unshift(merged);
      merged = {};
    }
    if (Object.hasOwn(merged, "input")) throw new Error('state already has "input"');
    merged = { ...merged, input: inputs.length > 1 ? inputs : inputs[0]! };
    const path = paths(inputs);
    for (const [name, own] of tagged)
      wire[name] = { ...wire[name]!, instructions: own.render(path) };
  }
  const { answers } = await typesafe(options).systemOne(
    { state: merged, questions: wire },
    options,
  );
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
          : typeof q === "object" && q.type === "switch"
            ? a.choice
            : a;
  }
  return out as Answers<Q>;
}

type Strings = TemplateStringsArray;

const isTag = (first: unknown): first is Strings => Array.isArray(first) && "raw" in first;

/** An interpolated object or array. */
type Part = Json[] | { [key: string]: Json };

type Parsed = {
  /** Instructions as sent on its own: paths over its own parts only. */
  instructions: string;
  /** Distinct interpolated objects, in order of first use. */
  parts: Part[];
  render: (path: (part: Part) => string) => string;
};

// Path of a part sent under `input` (see .agents/typesafe.md): the whole of it when it is the only one.
const paths = (inputs: Json[]) => (part: Part) =>
  inputs.length > 1 ? `\`input[${inputs.indexOf(part)}]\`` : "`input`";

// Text values go into the question; objects and arrays are sent in the state and their slots become paths.
function parse(strings: Strings, values: unknown[]): Parsed {
  const slots = values.map((value) =>
    typeof value === "object" && value !== null ? (value as Part) : String(value),
  );
  const parts = [...new Set(slots.filter((slot): slot is Part => typeof slot !== "string"))];
  const render: Parsed["render"] = (path) =>
    strings.reduce((out, s, i) => {
      const slot = slots[i - 1]!;
      return out + (typeof slot === "string" ? slot : path(slot)) + s;
    });
  return { instructions: render(paths(parts)), parts, render };
}

// Adds a hidden `then` that sends the question alone under `input`, so the object stays a plain question.
function askable<Q extends Tagged>(q: Q, parsed?: Parsed, options?: AskOptions) {
  if (parsed?.parts.length) states.set(q, parsed);
  const then: PromiseLike<Answer<Q>>["then"] = (ok, fail) =>
    send("", { input: q }, options)
      .then(({ input }) => input as Answer<Q>)
      .then(ok, fail);
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting is how a tag sends on its own
  return Object.defineProperty(q, "then", { value: then }) as Askable<Q>;
}

// Each tag works both as ask.choice`...`(criteria, options?) and ask.choice(instructions, criteria, options?),
// where plain-call instructions may be a JSON object or array (see .agents/typesafe.md).
function tag<C, Q extends Tagged>(build: (instructions: Entry, criteria: C) => Q) {
  return (first: Entry | Strings, ...rest: unknown[]) => {
    if (!isTag(first)) return askable(build(first, rest[0] as C), undefined, rest[1] as AskOptions);
    const parsed = parse(first, rest);
    return (criteria: C, options?: AskOptions) =>
      askable(build(parsed.instructions, criteria), parsed, options);
  };
}

export const choice = tag((instructions: Entry, criteria: ChoiceCriteria | ChoiceLabels) =>
  choiceQuestion(instructions, named(criteria)),
) as {
  <const T extends ChoiceCriteria | ChoiceLabels>(
    instructions: Entry,
    criteria: T,
    options?: AskOptions,
  ): Askable<ChoiceQuestion<Named<T>>>;
  (
    strings: Strings,
    ...values: unknown[]
  ): <const T extends ChoiceCriteria | ChoiceLabels>(
    criteria: T,
    options?: AskOptions,
  ) => Askable<ChoiceQuestion<Named<T>>>;
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

/** Like `ask.choice`, but resolves to the selected label alone. */
export const askSwitch = tag(
  (instructions: Entry, criteria: ChoiceCriteria | ChoiceLabels): SwitchQuestion => ({
    type: "switch",
    instructions,
    criteria: named(criteria),
  }),
) as {
  <const T extends ChoiceCriteria | ChoiceLabels>(
    instructions: Entry,
    criteria: T,
    options?: AskOptions,
  ): Askable<SwitchQuestion<Named<T>>>;
  (
    strings: Strings,
    ...values: unknown[]
  ): <const T extends ChoiceCriteria | ChoiceLabels>(
    criteria: T,
    options?: AskOptions,
  ) => Askable<SwitchQuestion<Named<T>>>;
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
  const parsed = parse(strings, values);
  const q: IfQuestion = {
    type: "if",
    instructions: parsed.instructions,
    threshold: options.threshold ?? 0.5,
  };
  return askable(q, parsed, options);
}

// Built pure so bundlers can drop the tags when only the client is imported.
/** Sends every question in one request and resolves to answers under the same keys. */
export const ask = /* @__PURE__ */ Object.assign(send, {
  choice,
  score,
  chance,
  if: askIf,
  switch: askSwitch,
});
