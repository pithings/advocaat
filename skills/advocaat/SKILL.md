---
name: advocaat
license: MIT
description: >
  Build AI-powered TypeScript with advocaat: a small, zero-dependency client
  that asks typed questions about your data and gets back probabilities,
  choices, and scores from TypeSafe System One models (Jev) in one request.
  Use when a feature needs programmable common sense, when an LLM
  prompt-and-parse step could become a structured decision, or when
  brainstorming what AI could make possible in an app. Applications include
  routing, ranking, extraction, verification, and interactive experiences;
  these are starting points, not the limits. Read the advocaat README for the
  API and the live TypeSafe docs for question design and patterns.
---

# Build with advocaat

advocaat turns units of AI intelligence into programming primitives. One call,
`ask(state, questions)`, sends every question about the same data in one request
and resolves to typed answers under the same keys. The model behind it is a
TypeSafe **System One** model (**Jev** by default). It understands natural
language and returns typed answers and probabilities, not text or reasoning.
Code owns the workflow; the model supplies common sense where ordinary code
needs semantic understanding.

```ts
import { ask } from "advocaat";

const { kind, severity, security } = await ask(issue, {
  kind: ask.choice`What kind of issue is this?`({ bug: "Something is broken", other: null }),
  security: ask.if`Does this issue describe a security vulnerability?`,
  severity: ask.score`How severe is this issue?`([
    "Cosmetic",
    "Workaround exists",
    "Blocks production",
  ]),
});

if (security) escalate(issue);
if (kind.choice === "bug" && severity.ratio >= 0.75) label(issue, "priority:high");
```

## Read the live docs

**The advocaat README is the source of truth for the API. The live TypeSafe docs
are the source of truth for question design.** This skill gives direction; read
both as part of the task.

- Install with `npx nypm i advocaat`. Read the
  [README](https://github.com/pithings/advocaat/blob/main/README.md) (or
  `node_modules/advocaat/README.md`) before writing code: it carries the current
  tags, answer shapes, options, and environment variables.
- Start with the [TypeSafe documentation index](https://docs.typesafe.ai/llms.txt)
  to discover concept pages and cookbooks. Use targeted reads rather than loading
  the entire site. Mintlify serves Markdown by appending `.md` to a page path, for
  example [how to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md).
  Resolve relative links against `https://docs.typesafe.ai`.
- For a new workflow, inspect the closest cookbook: it often shows a better
  decomposition than a generic classifier. Cookbooks use the HTTP API or official
  SDKs; translate their questions into `ask` tags (see the table below), the
  request and answer shapes are the same.
- If live access is unavailable, use the installed package's README and types,
  state that limitation, and avoid inventing version-dependent details.

| Task                             | Start here; follow the relevant details                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand the programming model | [System One](https://docs.typesafe.ai/concepts/system-one.md), [building guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md) |
| Explore what to build            | [Use-case map](https://docs.typesafe.ai/concepts/use-case-map.md), then relevant cookbooks from the index                                          |
| Prepare inputs and questions     | [State](https://docs.typesafe.ai/concepts/state.md), [primitives](https://docs.typesafe.ai/primitives.md), then the chosen primitive's page        |
| Decide how to handle uncertainty | [Confidence](https://docs.typesafe.ai/confidence.md)                                                                                               |
| Write code                       | [advocaat README](https://github.com/pithings/advocaat/blob/main/README.md): tags, answers, `ask` options, Vercel AI Gateway                           |

## Find the useful shape

Start from the behavior the user wants: what will the application show, select,
change, or hand off? Work backward to the judgments it needs. Keep known rules,
calculations, exact lookups, and execution in code. Preserve the user's chosen
stack and scope; add `ask` where semantic understanding helps.

When brainstorming or choosing an architecture, consider more than classification.
The patterns below are starting points: combine primitives around the user's goal,
including ideas that do not fit an established recipe.

- **Route and fill known arguments.** A request can select a handler and its typed
  parameters. Ask useful branch-specific questions up front in the same `ask` call
  and consume only the relevant answers. Explore
  [function calling](https://docs.typesafe.ai/cookbooks/function_calling.md) and
  [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out.md).
- **Select instead of generate.** Find candidate values or source spans in code,
  use `ask.choice` to select the intended one, then copy or normalize it. Explore
  [value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md)
  and [structure recovery](https://docs.typesafe.ai/cookbooks/autoformat.md).
- **Find and judge evidence.** Retrieve candidates, compare their relevance to a
  query with one `ask.chance` or `ask.score` per candidate, and select useful
  context. Explore [reranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md)
  and [hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification.md).
- **Turn judgments into reusable data.** Score dimensions once, keep the raw
  answers, then let code or user controls change weights, thresholds, rankings,
  and views. With labeled outcomes, those signals can become classical ML
  features. Explore [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring.md)
  and [feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md).
- **Verify and escalate.** Check specific claims or fields against their evidence
  with `ask.if`; send uncertain or failing cases to a person or reasoning model.
  Explore [citation checks](https://docs.typesafe.ai/cookbooks/citation_check.md)
  and [extraction cascades](https://docs.typesafe.ai/cookbooks/sde_cascade.md).
- **Respond to changing state.** Code can retain goals and observations while
  fresh judgments guide the next bounded step. Keep inferred state distinct from
  observed facts, and check freshness before applying a result to a changed
  situation.

For open-ended requests, offer the few directions that best serve the user's goal
and recommend a starting point. For a concrete request, choose the relevant
pattern and build; a brainstorm is not a mandatory detour.

## Design the judgments

Choose by what the answer means, then read the relevant primitive page:

| Need                               | Tag                                                                                                              | Answer                                                | Important distinction                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| One of a defined set               | ``ask.choice`…`({ a: "…", b: null })`` ([Choice](https://docs.typesafe.ai/primitives/choice.md))                 | `{ choice, confidence, probabilities }`               | Picks one option (2–255); `probabilities` compares competing options                                                              |
| Whether a condition holds          | `"Is it …?"`, ``ask.chance`…`({ true: "…", false: "…" })`` ([Noul](https://docs.typesafe.ai/primitives/noul.md)) | `{ chance }`                                          | Probability of yes; no separate confidence; use one per label when several may apply                                              |
| A yes/no you act on directly       | `` ask.if`…` ``                                                                                                  | `boolean`                                             | `chance` above `threshold` (default `0.5`); pass `ask.if({ threshold })` to bind another                                          |
| Degree along a described dimension | ``ask.score`…`(["low …", "mid …", "high …"])`` ([Score](https://docs.typesafe.ai/primitives/score.md))           | `{ score, ratio, confidence, legend, probabilities }` | Probability-weighted position on 2–10 ordered levels; `ratio` scales it to 0–1; use comparable per-item Scores for graded ranking |

Every tag also takes plain arguments when the question is built elsewhere, for
example `ask.choice(instructions, criteria)`, and `ask` accepts plain question
objects (`type: "noul" | "choice" | "score"`). Instructions and criteria values
can be strings, JSON objects, or arrays.

Give each question enough relevant **state** to answer: source text, identities,
relationships, policies, and current facts. Pass a named JSON object as the
`state` argument when context has several parts, and reference nested fields
with backticked paths such as `` `ticket.messages[0].text` ``. Put the judgment
in the question text and define its possible answers in the criteria. The keys
of the `questions` object are for code and are not sent to the model; include
complete meaning in the question.

Interpolating an object or array into a tag, as in ``ask.if`Is ${issue} a duplicate of ${existing}?` ``,
sends it as the state under `input` and rewrites the slot to its path
(`` `input` ``, or `` `input[0]` ``, `` `input[1]` `` with several). Such a tag can
only be awaited on its own; inside `ask` it throws unless given the same state
object. Interpolated strings and numbers go into the question text; use
`${{ message }}` to keep long text in the state.

Ask one narrow, coherent judgment per question. Split independently useful
dimensions, without destroying the relationship being judged. A bounded action
selection or contextual interpretation is valid; atomic does not mean literal
fact extraction or a one-sentence limit. Strings work for simple questions. Use
structured objects or arrays when definitions, contrasts, exclusions, or examples
clarify instructions or criteria. Score levels must describe concrete situations
and stand on their own; the model does not see level numbers or neighbours.

Keep the needed answers available. Include a no-match option such as
`other: null` when nothing may fit; use a separate presence question when it is
independently useful. For source-value selection, check candidate coverage: the
model cannot choose an omitted value.

## Compose and verify

**Ask independent questions over the same state in one `ask` call**, including
useful speculative questions. They run in parallel and cannot see one another's
answers. State each speculative premise explicitly; code consumes the applicable
answers. Awaiting a tag on its own sends a separate request, so reserve it for
one-off checks. A second request is warranted when an earlier answer is needed to
fetch evidence, construct new state, or determine the next options. Extra
questions still use tokens; the request budget is shared by state and questions,
so trim state to the fields the questions need. Measure actual cost and
end-to-end latency.

Use `chance`, `ratio`, `probabilities`, and `confidence` to guide behavior, with
thresholds evaluated on the user's data and consequences. Choice/Score
`confidence` summarizes distribution concentration, not overall workflow
correctness or permission to act. A `chance` near 0.5 means similar probability
for yes and no, not medium intensity. Several acceptable alternatives can also
spread probability; low confidence need not invalidate a harmless preference
choice. Ignore uncertainty on unused branches.

Keep policy explicit and raw judgments reusable. Weighted scores suit
compensating preferences; an "any serious violation" rule needs separate
conditions. Changing a weight or display filter need not rerun inference when
evidence and question meanings are unchanged. Typed output guarantees the
interface, not truth. System One models are trained for calibrated decisions;
validate their performance in the target domain.

Test representative cases and the resulting application behavior. For failures,
inspect the exact state, questions, candidates, answers, composition, and
observed outcome. Separate missing evidence, model errors, code errors, and
service failures. Treat cookbook thresholds and demo results as examples to
evaluate, not universal rules or permanent model limitations.

Configuration: set `TYPESAFE_API_KEY`, or `AI_GATEWAY_API_KEY` (or
`VERCEL_OIDC_TOKEN` on Vercel) to go through the Vercel AI Gateway with the same
answer shapes. Pass `apiKey`, `baseURL`, `model`, `signal`, `headers`, or
`fetch` as the last argument of `ask` (or of a tag's criteria call) when the
environment is not enough. advocaat does not retry or log; add your own retry on
rate limits and a `signal` timeout where it matters. Keep API credentials
server-side in web apps.
