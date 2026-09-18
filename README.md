# ❓Advocaat

A small, type-safe client for asking AI questions about your data, powered by [TypeSafe](https://typesafe.ai/) Jev.

Get probabilities, choices, and scores in one request.

### Agent skill

[`skills/advocaat/SKILL.md`](./skills/advocaat/SKILL.md) teaches coding agents how to design questions and build with `ask`.

```sh
npx skills add pithings/advocaat
```

## Quick start

Install the package:

```sh
npx nypm i advocaat
```

Set your [TypeSafe](https://typesafe.ai/) API key:

```sh
export TYPESAFE_API_KEY="your-api-key"
```

Using Vercel instead? See [Vercel AI Gateway](#vercel-ai-gateway).

Ask several questions about the same data in one request:

```ts
import { ask } from "advocaat";

const issue = { title: "Checkout is down", body: "No one can pay." };

const { kind, security, severity } = await ask(issue, {
  kind: ask.choice`What kind of issue is this?`({ bug: "Something is broken", other: null }),
  security: ask.if`Does this issue describe a security vulnerability?`,
  severity: ask.score`How severe is this issue?`([
    "Cosmetic",
    "Workaround exists",
    "Blocks production",
  ]),
});

console.log(kind.choice); // "bug" | "other"
console.log(security); // true | false
console.log(severity.ratio); // 0...1
```

## Question types

Answers use the same keys as your questions. Mix any of these forms in one `ask` call:

| Want        | Use                    | Read            |
| ----------- | ---------------------- | --------------- |
| Boolean     | `ask.if`               | Answer directly |
| Probability | String or `ask.chance` | `.chance`       |
| Category    | `ask.choice`           | `.choice`       |
| Label       | `ask.switch`           | Answer directly |
| Rating      | `ask.score`            | `.ratio`        |

The examples below reuse `ask` and `issue` from the quick start.

### Yes/no questions

Use `ask.if` for a boolean, a string for a probability, or `ask.chance` to describe what counts as yes or no:

```ts
const { security, urgent, blocked } = await ask(issue, {
  security: ask.if`Does this issue describe a security vulnerability?`,
  urgent: "Does this need immediate attention?",
  blocked: ask.chance`Are users blocked?`({
    true: "Users cannot use the service.",
    false: "Users can continue with a workaround.",
  }),
});

console.log(security); // true | false
console.log(urgent.chance); // 0...1
console.log(blocked.chance); // 0...1
```

`ask.if` returns `true` when the probability of yes is above `0.5`. You can [set a different threshold](#tag-options).

Strings and `ask.chance` return `{ type: "chance", chance }`, where `chance` is the probability of yes from 0 to 1. With `ask.chance`, either criterion can be omitted, or use ``ask.chance`Question?`()`` without criteria.

### Choices

Use `ask.choice` with 2–255 named options:

```ts
const { kind } = await ask(issue, {
  kind: ask.choice`What kind of issue is this?`({
    bug: "Something is broken",
    other: null,
  }),
});

console.log(kind.choice); // "bug" | "other"
```

Returns `{ type: "choice", choice, confidence, probabilities }`. `choice` is the selected label, typed as `"bug" | "other"` here. `probabilities` contains a probability for each label. `confidence` (0...1) is high when one label stands out and low when they are close.

When the labels speak for themselves, pass them as an array instead of an object with `null` descriptions: ``ask.choice`What kind of issue is this?`(["bug", "other"])``.

Use `ask.switch` with the same options when you only need the label:

```ts
switch (await ask.switch`What kind of issue is ${issue}?`(["bug", "other"])) {
  case "bug":
    return label(issue, "bug");
  case "other":
    return triage(issue);
}
```

### Scores

Use `ask.score` with 2–10 levels, ordered from lowest to highest:

```ts
const { severity } = await ask(issue, {
  severity: ask.score`How severe is this issue?`([
    "Cosmetic",
    "Workaround exists",
    "Blocks production",
  ]),
});

console.log(severity.ratio); // 0...1
```

Returns `{ type: "score", score, ratio, confidence, legend, probabilities }`. `score` is the expected zero-based score and can be fractional (0–2 here). `ratio` scales it to 0...1. `legend` and `probabilities` are keyed by score level.

## Asking one question

For a single question, interpolate the data into a tag and await it. You get the same answer as you would under its key in `ask`:

```ts
const kind = await ask.choice`What kind of issue is ${issue}?`(["bug", "other"]);
const label = await ask.switch`What kind of issue is ${issue}?`(["bug", "other"]);
const severity = await ask.score`How severe is ${issue}?`(["Cosmetic", "Blocks production"]);
const { chance } = await ask.chance`Does ${issue} need immediate attention?`();
const security = await ask.if`Does ${issue} describe a security vulnerability?`;
```

Each await sends a separate request. To ask several questions about the same data in one request, use `ask(state, { ... })` instead. See [Tag options](#tag-options) for client settings and thresholds.

## Passing data into tags

All tags support `${expression}`. How a value is sent depends on its type.

### Text and numbers

Text and numbers go directly into the question:

```ts
const service = "checkout";
const hours = 24;

const { urgent } = await ask(issue, {
  urgent: ask.chance`Does this issue affect ${service} and need a fix within ${hours} hours?`(),
});
```

### Objects and arrays

Objects and arrays become the request state, with a path in the question pointing to each value:

```ts
const existing = { number: 41, title: "Payments failing at checkout" };
const service = "checkout";

const duplicate = await ask.if`Is ${issue} a duplicate of ${existing} in ${service}?`;
```

- One object or array is sent under `input`; its slot in the question becomes `` `input` ``.
- Several are sent as an `input` array; their slots become `` `input[0]` ``, `` `input[1]` ``, and so on.
- Inside `ask`, the objects of all tags in the request are sent once each in the same `input`, added to the state object. A text or array state becomes `input[0]` of that array; point bare questions at it. Pass data as the state or in the tags, not both. A state that already has `input` throws.

Without objects or arrays, the tag is sent with an empty state. Short text can go straight into the question as ``ask.if`Is "${message}" spam?` ``; wrap longer text as `${{ message }}` to keep it in the state. Use `JSON.stringify(value)` if you want an object included as JSON in the question text instead.

<details>
<summary>How data is sent</summary>

The duplicate check above sends this request:

```json
{
  "state": {
    "input": [
      { "title": "Checkout is down", "body": "No one can pay." },
      { "number": 41, "title": "Payments failing at checkout" }
    ]
  },
  "questions": {
    "input": {
      "type": "noul",
      "instructions": "Is `input[0]` a duplicate of `input[1]` in checkout?"
    }
  }
}
```

</details>

## API reference

### `ask(state, questions, options?)`

Sends all questions in one request and returns a promise of typed answers under the same keys.

- **`state`**: the data to evaluate. Pass text, a JSON object or array, or `null`.
- **`questions`**: an object with at least one named question. Use [strings and tags](#question-types) or [plain question objects](#plain-question-objects).
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

| Option     | Description                                              | Default                                                                                         |
| ---------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `apiKey`   | API key. Required unless set in the environment.         | `TYPESAFE_API_KEY`, else `AI_GATEWAY_API_KEY`, else `VERCEL_OIDC_TOKEN`                         |
| `baseURL`  | API base URL.                                            | `TYPESAFE_BASE_URL` or `https://api.typesafe.ai`; gateway: `https://ai-gateway.vercel.sh/v4/ai` |
| `model`    | Model name.                                              | `TYPESAFE_DEFAULT_MODEL` or `jev-latest`; gateway: `typesafe-ai/jev`                            |
| `provider` | `"typesafe"` (direct) or `"vercel"` (AI Gateway).        | `"vercel"` only when the key comes from a Vercel env variable                                   |
| `vercel`   | AI Gateway settings, e.g. `{ zeroDataRetention: true }`. | None                                                                                            |
| `fetch`    | Custom fetch implementation.                             | `globalThis.fetch`                                                                              |
| `signal`   | `AbortSignal` to cancel the request or set a timeout.    | None                                                                                            |
| `headers`  | Extra request headers as `Record<string, string>`.       | None                                                                                            |

Explicit options take priority over environment values. Environment values are read from `globalThis.process?.env` when available. The client sets the authorization and JSON headers itself. Requests are not retried.

### Tag options

For standalone requests, pass client options after the criteria. `ask.chance` accepts `undefined` when you do not need criteria:

```ts
const options = { model: "jev-latest" };

await ask.choice`What kind of issue is ${issue}?`(["bug", "other"], options);
await ask.switch`What kind of issue is ${issue}?`(["bug", "other"], options);
await ask.score`How severe is ${issue}?`(["Cosmetic", "Blocks production"], options);
await ask.chance`Does ${issue} need immediate attention?`(undefined, options);
```

`ask.if(options)` takes the same options as `ask`, plus `threshold` (default `0.5`), and returns a tag bound to them. It returns `true` only when the chance is strictly above the threshold:

```ts
const strictIf = ask.if({ threshold: 0.8 });
const security = await strictIf`Does ${issue} describe a security vulnerability?`;
```

Inside `ask`, set client options on `ask` itself; tags use the batch's settings. A threshold set with `ask.if({ threshold })` still applies to that question. `ask.if` and `ask.switch` are also exported as `askIf` and `askSwitch`.

Tags are promise-like: awaiting them, passing them to `Promise.all`, or returning them from an async function sends a request. Awaiting the same tag again sends another request; it does not reuse an earlier answer.

### Callable helpers

When you build questions without template strings, use:

- `ask.choice(instructions, criteria, options?)`
- `ask.switch(instructions, criteria, options?)`
- `ask.score(instructions, levels, options?)`
- `ask.chance(instructions, criteria?, options?)`

These return the same awaitable questions as the tags. Instructions and criteria descriptions accept text, JSON objects or arrays, or `null`; choice and switch criteria may also be an array of labels:

```ts
const { kind } = await ask(issue, {
  kind: ask.choice(
    { question: "What kind of issue is this?", focus: "title" },
    {
      bug: { what: "Something is broken", not_for: "Requests for new features" },
      other: null,
    },
  ),
});
```

### Plain question objects

For questions built as data, use `type: "noul"` for yes/no, `"choice"` for a choice, or `"score"` for a score:

```ts
const { urgent } = await ask(issue, {
  urgent: {
    type: "noul",
    instructions: "Does this need immediate attention?",
    criteria: { true: "Production is blocked.", false: "Work can continue." },
  },
});

console.log(urgent.chance); // 0–1
```

Optional `instructions` accept text, a JSON object or array, or `null`. `criteria` follows the corresponding helper's shape and is required for choices and scores. Answers have the same shape as with the helpers, including `{ type: "chance", chance }` for `"noul"` questions. The tag shapes work too: `{ type: "if", instructions, threshold }` resolves to a boolean and `{ type: "switch", instructions, criteria }` to the selected label.

## Vercel AI Gateway

To use [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/modalities/evaluation), set `AI_GATEWAY_API_KEY` instead of `TYPESAFE_API_KEY`. On Vercel, `VERCEL_OIDC_TOKEN` works too. It is read on every `ask()` call, so token rotation works automatically.

- Requests use `https://ai-gateway.vercel.sh/v4/ai` and model `typesafe-ai/jev`.
- Automatic gateway selection applies when `TYPESAFE_API_KEY` is not set and no explicit `apiKey` is passed.
- Pass `provider: "vercel"` with an explicit `apiKey` to force the gateway, or `provider: "typesafe"` to opt out.
- `TYPESAFE_BASE_URL` and `TYPESAFE_DEFAULT_MODEL` are ignored in gateway mode. Use `baseURL` and `model` instead; a bare model name gets the `typesafe-ai/` prefix.

Answers have the same shape. The gateway does not return `confidence`, so it is computed locally from `probabilities`: the top probability rescaled so a flat spread is 0. This matches TypeSafe's own figure for choices and short scores; scores with four or more levels can come out a little lower when neighbouring levels share the mass.

## License

Published under the [MIT](https://github.com/pithings/advocaat/blob/main/LICENSE) license 💛.
