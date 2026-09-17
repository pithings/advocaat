# TypeSafe System One API

Summary of https://docs.typesafe.ai/ (fetched 2026-09-16). Full index: https://docs.typesafe.ai/llms.txt. Each page is also available as Markdown by adding `.md` to its path.

## What it is

- **System One** models make fast, structured decisions for software. They do not generate text. Send a `state` and a map of typed `questions`; get typed `answers` with probabilities back.
- **Jev** (`jev-latest`) is the flagship model and the SDK default.
- Trained with **RLCD** (reinforcement learning for calibrated decisions): probabilities are calibrated across many predictions (0.8 ≈ right 80% of the time), not a guarantee per answer.
- Most queries complete in about 100 ms. Every question in a request is evaluated in parallel and in isolation, so adding questions barely changes latency and does not cause context rot.

## HTTP API

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Request body:

| Field       | Type                        | Notes                                                                                      |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `state`     | `string \| object \| array` | Content to evaluate. Use an object for most requests so parts are named.                   |
| `model`     | `string`                    | Required. `"jev-latest"`.                                                                  |
| `questions` | `map<string, Question>`     | Keys are yours; answers come back under the same keys. Keys are **not** sent to the model. |

Response body: `{ model, answers: map<id, Answer>, usage: { input_tokens, output_tokens } }`.

Other endpoint: `GET /v1/models` lists `ModelCard { name, description, release_date }`.

Errors: `401` bad key, `422` validation (body names the field), `429` rate limit, `529` overloaded. Retry 429/529 with exponential backoff.

Token budget per request is ~32,000 tokens (~150k chars), shared by state and questions.

## Question types (primitives)

All share `type` and `instructions`. `instructions` and every criteria value accept `string | object | array | null` (called `EntryType`).

| Type     | Ask                    | `criteria`                                                 | Answer fields                                      |
| -------- | ---------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| `noul`   | Is this true? (yes/no) | Optional `{ true, false }` descriptions                    | `noul` (0–1, probability of yes). No confidence.   |
| `choice` | Which option?          | Required map `option → description \| null`; 2–255 options | `choice`, `probabilities` (sum to 1), `confidence` |
| `score`  | Which level?           | Required ordered array of level descriptions; 2–10 levels  | `score`, `legend`, `probabilities`, `confidence`   |

Details:

- **Noul**: phrase so high = yes. 0.5 means "yes and no equally likely", not "medium". Can be a question or a statement to judge as true.
- **Choice**: `choice` is the highest-probability option. Option names and descriptions are both sent to the model. Add an `other` / `none of the above` option when the list may not cover every input. Give the full list, not a shortlist.
- **Score**: levels are numbered by array position from 0. `score` = Σ level × probability, so it can fall between levels (e.g. 1.3). `probabilities` and `legend` are keyed by level number as a string. Each level is judged on its own; the model does not see level numbers or neighbours, so "worse than the previous level" and numeric-only levels do not work. Describe situations, not degrees. Keep one dimension per Score. Normalize by dividing by `criteria.length - 1` before combining scales of different length.

Example request:

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "model": "jev-latest",
  "questions": {
    "is_urgent": { "type": "noul", "instructions": "Does this convey urgency?" },
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": { "billing": "Payments, refunds", "technical": "Bugs, outages", "sales": null }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated is the customer?",
      "criteria": ["Calm", "Frustrated", "Very angry"]
    }
  }
}
```

Example response:

```json
{
  "model": "jev-latest",
  "answers": {
    "is_urgent": { "type": "noul", "noul": 0.92 },
    "department": {
      "type": "choice",
      "choice": "technical",
      "probabilities": { "billing": 0.08, "technical": 0.85, "sales": 0.07 },
      "confidence": 0.82
    },
    "frustration": {
      "type": "score",
      "score": 1.6,
      "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      "probabilities": { "0": 0.05, "1": 0.3, "2": 0.65 },
      "confidence": 0.78
    }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

## Confidence

- Only Choice and Score answers carry `confidence` (0–1). It is a statistic derived from the shape of `probabilities`: one peak = high, flat = low. You can compute your own measure from `probabilities` instead.
- Low confidence on a Choice: no clear winner. On a Score: levels overlap, the question measures more than one thing, or the state lacks information.
- Use three bands: high → act; medium → confirm / flag; low → route to a human or another system. Thresholds scale with risk: a read-only action can act at 0.6, a destructive one may need > 0.85. Start conservative and tune on your own data.
- If you only want the best option, take the top `choice`; you do not need a threshold. If you have a statistical algorithm in mind, use `probabilities` rather than `confidence`.

## State

- String for one piece of text. Object for named fields and related records (preferred). Array for a sequence of messages.
- Include only the context the questions need. Do not rely on model weights for facts your own data has.
- Point questions at parts of a structured state with a backticked dot-and-index path in `instructions`, e.g. ``Does `ticket.messages[0].text` request a refund?``.

## Structured instructions and criteria

`instructions`, Choice option descriptions, Score levels, and Noul `true`/`false` can be JSON objects or arrays. Field names are not reserved; the model sees names and values, so use short labels like `question`, `focus`, `what`, `not_for`, `examples`, `signals`, `compare`, `inspect`. Use the same field names across options or levels. Use this when two options blur together or a level needs examples. Examples steer the model only when they resemble real inputs; higher confidence alone does not prove a better rubric.

Choice criteria values can be nested subtrees to walk a taxonomy one level per request.

## Design rules

1. Keep control flow, deterministic rules, and side effects in code. Use System One only where common-sense judgment over unstructured data is needed.
2. Ask atomic questions: one snap judgment each, the kind a knowledgeable person makes in a second. Split broad judgments into one question per factor and combine in code.
3. Send every question about the same state in one request, including speculative ones. Extra questions cost a few tokens and no latency. Ignore answers you do not need.
4. Answers are independent. Make a second request only when code cannot build it until it has the first answer (fetch more data, decide the state, pick the next options).
5. Route on uncertainty. Escalate low confidence to a person or a reasoning model.
6. Keep questions and threshold constants in one place so they are easy to review.

## Patterns

| Pattern                  | What it does                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Speculative fan-out      | Ask everything the decision tree might need in one call; code picks what is relevant.                |
| Confidence-gated routing | Floor on confidence for any action, then a higher bar for riskier actions.                           |
| Composite scoring        | One Score per dimension, normalize to 0–1, combine with weights in code.                             |
| Intent routing           | Classify intent and complexity first, then send to deterministic code, a specialist LLM, or a human. |

Cookbooks (https://docs.typesafe.ai/cookbooks/…) cover parallel questions (13 questions in one call: ~12x cheaper, ~10x faster), re-ranking, line-by-line semantic search, structure recovery, function calling, skill suggestion, entity alignment, RAG passage filtering, citation checks, LLM guardrails, extraction cascades, date and pre-parsed value extraction, hierarchical classification with beam search, and self-consistency checks.

## Official JS SDK (`@typesafe-ai/sdk`, for reference)

Not used here (this project has its own zero-dependency client in `src/api.ts`), but its defaults are the reference behaviour:

- `new TypeSafeClient({ apiKey?, baseURL?, defaultModel?, timeout?, retry?, logLevel?, logger?, fetch?, defaultHeaders?, dangerouslyAllowBrowser? })`. Explicit options > env > defaults. Empty env values are ignored.
- Env: `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` (default `https://api.typesafe.ai`), `TYPESAFE_DEFAULT_MODEL` (default `jev-latest`), `TYPESAFE_LOG_LEVEL` (default `warn`).
- `client.systemOne({ state, questions, model? }, options?)` → `{ model, answers, usage }`, answer types inferred from question types. `client.models.list()` → `ModelCard[]`.
- Builders: `choice(instructions, criteria)`, `score(instructions, criteria)`, `noul(instructions?, criteria?)`.
- Retry defaults: 2 retries, statuses 408, 429, 500–599, backoff 500 ms doubling to 5 s with 25% jitter, honours `Retry-After` up to 60 s. Timeout 10 s per attempt.
- Errors: `TypeSafeError` → `APIError` (`AuthenticationError`, `BadRequestError`, `PermissionDeniedError`, `NotFoundError`, `UnprocessableEntityError`, `RateLimitError`, `InternalServerError`), `APIConnectionError`, `APITimeoutError`, `APIUserAbortError`.

## Vercel AI Gateway (`typesafe-ai/jev`)

```http
POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model
Authorization: Bearer <AI_GATEWAY_API_KEY>
ai-gateway-protocol-version: 0.0.1
ai-gateway-auth-method: api-key
ai-evaluation-model-specification-version: 4
ai-model-id: typesafe-ai/jev
```

Body: `{ state, questions, providerOptions?: { gateway: { zeroDataRetention: true } } }`. Same question shapes as System One, except yes/no is `type: "boolean"`, and `state`/`instructions` must not be null (`criteria` may be omitted, its values may be null). No `model` in the body.

Response: `{ answers, usage?: { inputTokens, outputTokens }, rounding?, warnings?, providerMetadata? }` with answers `{ type: "boolean", probability }`, `{ type: "choice", choice, probabilities? }`, `{ type: "score", score, probabilities? }`. No `confidence`, `legend`, or `model`. No models endpoint; see https://vercel.com/ai-gateway/models?capabilities=evaluation. Billed per token through the gateway; OIDC (`VERCEL_OIDC_TOKEN` as the bearer token, `ai-gateway-auth-method: oidc`) is the SDK fallback when no key is set; the SDK also refreshes it in dev via `@vercel/oidc`, which this client skips.

Confidence is not returned. Fitting against the direct API (2026-09-17, 43 samples) gives `(max(p) − 1/n) / (1 − 1/n)` with MAE 0.02: exact for choice and 3-level score answers; 4-level scores with mass on neighbouring levels come out up to 0.15 low. `1 − normalized entropy` was 0.11 too low on average.

## Other resources

- Playground: https://console.typesafe.ai/playground
- API keys: https://console.typesafe.ai/settings/keys
- Agent skill: `claude plugin marketplace add typesafe-ai/skills && claude plugin install typesafe@typesafe-ai`, or https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md
- Python SDK: `pip install typesafe-sdk` (`TypeSafeClient().system_one(state=, questions=)`; keys `probabilities`/`legend` by int).
