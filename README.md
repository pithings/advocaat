# advocaat

A small, type-safe client for asking AI questions about your data, powered by [TypeSafe](https://typesafe.ai/) Jev.

Get probabilities, choices, and scores in one request.

## Usage

Install the package:

```sh
npx nypm i advocaat
```

Set `TYPESAFE_API_KEY`, then ask typed questions about any data in one request:

```ts
import { ask } from "advocaat";

const { kind, severity, security } = await ask(issue, {
  kind: ask.choice`What kind of issue is this?`({ bug: "Something is broken", other: null }),
  security: "Does this issue describe a security vulnerability?",
  severity: ask.score`How severe is this issue?`([
    "Cosmetic",
    "Workaround exists",
    "Blocks production",
  ]),
});

if (security.chance > 0.5) escalate(issue);
if (kind.choice === "bug" && severity.ratio >= 0.75) label(issue, "priority:high");
```

### Questions and answers

Mix strings, tagged helpers, and plain question objects in one request. Answers use the same keys as your questions. Criteria descriptions accept text, JSON objects or arrays, or `null`.

#### Yes/no questions

Use a string for a simple yes/no question, or `ask.chance` to describe what counts as yes or no:

```ts
const { security, urgent } = await ask(issue, {
  security: "Is this a security issue?",
  urgent: ask.chance`Does this need immediate attention?`({
    true: "Users cannot use the service.",
    false: "Users can continue with a workaround.",
  }),
});

if (security.chance > 0.5) escalate(issue);
```

Both return `{ type: "chance", chance }`, where `chance` is the probability of yes from 0 to 1. With `ask.chance`, either criterion can be omitted, or use ``ask.chance`Question?`()`` without criteria.

#### Choices

Use `ask.choice` with 2–255 named options:

```ts
const { kind } = await ask(issue, {
  kind: ask.choice`What kind of issue is this?`({
    bug: "Something is broken",
    other: null,
  }),
});

if (kind.choice === "bug") label(issue, "bug");
```

Returns `{ type: "choice", choice, confidence, probabilities }`. `choice` is the selected label, typed as `"bug" | "other"` here. `probabilities` contains a probability for each label.

#### Scores

Use `ask.score` with 2–10 levels, ordered from lowest to highest:

```ts
const { severity } = await ask(issue, {
  severity: ask.score`How severe is this issue?`([
    "Cosmetic",
    "Workaround exists",
    "Blocks production",
  ]),
});

if (severity.ratio >= 0.75) label(issue, "priority:high");
```

Returns `{ type: "score", score, ratio, confidence, legend, probabilities }`. `score` is the expected zero-based score and can be fractional (0–2 here). `ratio` scales it to 0–1. `legend` and `probabilities` are keyed by score level.

#### String interpolation

All three tags support `${expression}` to include values in the question text:

```ts
const service = "checkout";
const hours = 24;

const { urgent } = await ask(issue, {
  urgent: ask.chance`Does this issue affect ${service} and need a fix within ${hours} hours?`(),
});
```

Interpolated values are converted to strings. Use `JSON.stringify(value)` if you want to include an object as JSON in the question text.

Each tag also accepts a plain string when the question is built elsewhere: `ask.choice(question, criteria)`, `ask.score(question, levels)`, `ask.chance(question, criteria?)`.

#### Plain question objects

For questions built as data, use `type: "noul"` for yes/no, `"choice"` for a choice, or `"score"` for a score:

```ts
const { urgent } = await ask(issue, {
  urgent: {
    type: "noul",
    instructions: "Does this need immediate attention?",
    criteria: { true: "Production is blocked.", false: "Work can continue." },
  },
});

if (urgent.chance > 0.5) escalate(issue);
```

Optional `instructions` accept text, a JSON object or array, or `null`. `criteria` follows the corresponding helper's shape above and is required for choices and scores. Answers have the same shape as with the helpers, including `{ type: "chance", chance }` for `"noul"` questions.

## API

### `ask(state, questions, options?)`

Sends all questions in one request and returns a promise of typed answers under the same keys.

- **`state`**: the data to evaluate. Pass text, a JSON object or array, or `null`.
- **`questions`**: an object with at least one named question (see below).
- **`options`**: optional client and request settings, passed as the third argument.

```ts
const answers = await ask(
  { title: "Login fails", body: "All users are locked out." },
  { urgent: "Does this issue need immediate attention?" },
  {
    apiKey: "your-api-key",
    baseURL: "https://api.typesafe.ai",
    model: "jev-latest",
    fetch: globalThis.fetch,
    signal: AbortSignal.timeout(10_000),
    headers: { "X-Request-ID": "triage-123" },
  },
);
```

| Option    | Description                                           | Default                                          |
| --------- | ----------------------------------------------------- | ------------------------------------------------ |
| `apiKey`  | API key. Required unless set in the environment.      | `TYPESAFE_API_KEY`                               |
| `baseURL` | API base URL.                                         | `TYPESAFE_BASE_URL` or `https://api.typesafe.ai` |
| `model`   | Model name.                                           | `TYPESAFE_DEFAULT_MODEL` or `jev-latest`         |
| `fetch`   | Custom fetch implementation.                          | `globalThis.fetch`                               |
| `signal`  | `AbortSignal` to cancel the request or set a timeout. | None                                             |
| `headers` | Extra request headers as `Record<string, string>`.    | None                                             |

Explicit options take priority over environment values. Environment values are read from `globalThis.process?.env` when available. The client sets the authorization and JSON headers itself. Requests are not retried.

## License

Published under the [MIT](https://github.com/unjs/advocaat/blob/main/LICENSE) license 💛.
