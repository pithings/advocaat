# Jev behavioural findings — synthesis

Nine hypotheses from `EVAL.md`, each tested by its own agent. Source of truth for every
number below is `eval/data/hN/REPORT.md`; raw payloads are in `eval/data/hN/2026-09-18.jsonl`.

**Setup.** All runs 2026-09-18. Model `jev-latest` on `api.typesafe.ai`. One request at a time per agent, order shuffled with a seeded PRNG,
probabilities returned at 2 decimals. Several agents ran in parallel; H2 and H9 (the
latency and token experiments) ran alone so no other traffic shared the key. Server load
was not controlled. 1455 requests in total.

## 1. Summary table

| # | Claim | Verdict | Headline effect | n (requests) | Raw data |
| --- | --- | --- | --- | --- | --- |
| H1 | Questions cannot read each other; both read `state` | **CONFIRMED** | leakage p(correct) = 0.000 from a sibling's instructions and from a sibling's criteria (0/12 each); via `state` 12/12 at p = 1.00 | 60 | `eval/data/h1/` |
| H2 | State counted once; questions ~2x state tokens; 32,768/branch, 65,536/request; 1500 questions sub-second | **CONFIRMED (a,b) / REFUTED (c)** | a: state counted once (250 questions add 4952 tokens on a 200-char and on a 16,000-char state), 2.27x per character, caps 32,768 / 65,536 exactly. b: flat to ~100 questions (1.24x). c: 1500 questions = 1306 ms median wall, not sub-second | 160 (incl. 11 rejections) | `eval/data/h2/` |
| H3 | Option order moves the probability of the same answer | **CONFIRMED** | spread of per-order means 0.200 (ambiguous ticket) and 0.063 (clear), vs pooled within-order sd 0.030 / 0.009; permutation p = 0.0001 | 108 | `eval/data/h3/` |
| H4 | Adding an irrelevant option shifts log-odds by −0.28, negative in 10/10 blocks | **REFUTED** | pooled +0.037 log-odds, 95% CI [−0.018, 0.091], 30 blocks, 13 neg / 16 pos. Real but small and state-specific: `feedback` +0.125 [0.059, 0.191], `ticket` −0.051 [−0.109, 0.008] | 120 | `eval/data/h4/` |
| H5 | Context last inside an option list is used reliably; first/middle degrade; `state` is 48/48 | **CONFIRMED (a) / REFUTED (b)** | a: `state` control 48/48 at p = 1.00. b: direction reversed — card first 14/16, middle 11/16, last 8/16, spread 38 points; card in options 33/48 vs in state 48/48 (+31 points) | 168 | `eval/data/h5/` |
| H6 | Aggregate calibration is good but per-task failure exists | **CONFIRMED** | aggregate ECE 0.037 over 510 items, yet modular exponents 30.0% correct (Wilson 21.9–39.6%, chance 25%) at mean top p 0.389, ECE 0.102; ≥0.6 → 96.4% right (n=414), <0.6 → 27.1% right (n=96) | 510 | `eval/data/h6/` |
| H7 | `confidence` is derived, not learned | **CONFIRMED** | choice `(p_max − 1/K)/(1 − 1/K)`: MAE 0.0056, 100% within 0.02, held-out MAE 0.0057. Score `1 − E_p|i − mode|/D(K)`: MAE 0.0058, 98% within 0.02. K = 1 returns 1 | 56 → 350 choice + 285 score answers | `eval/data/h7/` |
| H8 | Identical requests and duplicate questions return different values | **CONFIRMED** | 50 identical requests: largest per-field sd 0.0236, range 0.12. Duplicates inside one request are as noisy (within/across ratio 0.63–1.05). At margin 0.091 the returned `choice` flipped 2/25 | 155 | `eval/data/h8/` |
| H9 | `output_tokens` is billing, not generation | **CONFIRMED (a,b) / REFUTED (c)** | a: same question, same `input_tokens` (386), key length alone moved `output_tokens` 20 → 269. b: 200 options vs 2 = 267 vs 228 ms wall for 51.7x the output tokens; 0.00 costs the same as 0.99. c: it is neither generated text nor response size | 108 | `eval/data/h9/` |

## 2. Findings per hypothesis

**H1 — question isolation.** A secret code was placed in a sibling question's `instructions`,
in a sibling choice option's description, in `state`, in the probe's own `instructions`, or
nowhere; the probe then picked the code from four options. Leakage was exactly 0.000 in both
sibling directions (0/12), while the same code in `state` was recovered
12/12 at p = 1.00 — better than the claimed ~0.90. The guessing floor is not 0.25: with no
secret anywhere the model picked `none` 12/12 at p = 1.00, so any mass on the correct code
would have been leakage. Still uncertain: only two leakage channels were tested, and only
within one request.

**H2 — shared state and batching.** All the accounting claims hold.
`input_tokens = 275 + 0.1894 × stateChars + 20.52 × questions` reproduces the whole grid with
R² > 0.999, so the state is charged once however many questions ride on it — going from 1 to
250 questions adds 4952 tokens on a 200-character state and 4952 on a 16,000-character one.
Two separate hard caps, both exactly powers of two: state alone 32,768 tokens (accepted at
32,675, rejected at ~33,147) and the whole request 65,536 (accepted at 65,260, rejected at
~65,969); over either the API returns `400 max_tokens_exceeded` without doing work. The
latency shape is as claimed to ~100 questions (1.24x), but 1500 questions is **not**
sub-second: 1306 ms median wall, 456 ms of it upstream. Still uncertain: one key, one region, one
day — the caps could be account-scoped.

**H3 — option order.** One choice question, three labels, all six orders, 9 reps each. Order
moved the winner's probability from 0.889 to 0.952 on a clear ticket (spread 0.063) and from
0.549 to 0.749 on an ambiguous one (spread 0.200), against a pooled within-order sd of 0.009
and 0.030 — roughly 7x the noise, permutation p = 0.0001. The direction is primacy and it grows as the decision approaches a coin flip; near
the ceiling it shrinks and stops being monotone. The argmax itself never changed (0/144
trials), so the hazard is thresholds, not ranking, when the leaders are far apart. Still
uncertain: only `choice` was tested, only with 3 options, and only two tickets.

**H4 — choice-set interaction.** Thirty blocks of {4-option baseline, identical control,
5-option with a junk option appended, identical control}, duplicates pooled inside the block.
The claimed −0.28 in 10/10 blocks is not there: pooled mean +0.037 log-odds, 95% CI
[−0.018, 0.091], blocks split 13 negative / 16 positive. Strict IIA does fail, but small and
state-dependent: `feedback` +0.125 [0.059, 0.191], t = 3.70, 3.7x the identical-request noise
floor; `ticket` −0.051 [−0.109, 0.008] does not clear its
noise floor. The junk option returned 0.00 in every request and the two leaders kept the same
total mass, so nothing was "taken" — the model re-weighs the remaining options when the list
changes. Effect size is about 0.1 log-odds, roughly ±0.02 of probability at p = 0.6, an order
of magnitude below the claim and well below the option-order effect. Still uncertain: two
state sets only, and the sign is not predictable from the junk option.

**H5 — reference material inside options.** A lookup table was appended to exactly one
option's description (never the correct answer), sent in all six permutations. The claim is
backwards: context placed **last** was worst (8/16 correct, mean p 0.513), first was best
(14/16, p 0.795), spread 38 points. The `state` control reproduced the claim exactly — 48/48
at p = 1.00 — and a filler control (card in `state`, equally long irrelevant text in one
option) was also 24/24, so this is neither plain option-order sensitivity nor description
length. Every error was the same error: the model chose the option that *contained* the
table, reading it as a description of that option. When the card sat before the correct
option, 45/48 were right; after it, 18/48. Appending an `unlisted` catch-all did not help
(30/48, and the catch-all was never chosen). Still uncertain: one synthetic lookup task, and
catch-all behaviour on real workflow data is untested.

**H6 — calibration.** 510 items over four sets. Aggregate ECE is 0.037 (the claim
said ~0.031) and is meaningless: it averages two-digit addition at 100.0% and hand-written
workflow items at 97.3% with modular exponents at 30.0% (Wilson 21.9–39.6%, chance 25%,
mean top p 0.389, ECE 0.102, calibration z = −1.90). That is worse than the claimed
"56% correct at mean p 0.35" — on this set the answers carry no information at all, and
nothing in the response says so. Identically formatted addition is 100%, so the failure is the task, not the format. The one
number that generalised across sets: of 414 answers with top probability ≥ 0.6, 96.4% were
right (95% 94.1–97.8%); of the 96 below 0.6, 27.1% were right (19.2–36.7%). Still uncertain:
the workflow items were written for the experiment, so the clear subset has no bins below
0.6 at all.

**H7 — `confidence` is derived.** Both fields are closed-form functions of the returned
distribution. Choice is exactly the claimed `(p_max − 1/K)/(1 − 1/K)`: MAE 0.0056, bias
−0.0025, 100% within 0.02 over 350 answers at K = 2…25, with an unseen held-out set at MAE
0.0057; every rival formula is an order of magnitude worse (next best 0.0673). Score uses a
different but analogous formula — `1 − E_p|i − mode| / D(K)` with
`D(K) = floor(K/2)·ceil(K/2)/K` — MAE 0.0058 over 275 untied answers, and `D(K)` is recovered
by per-K fits rather than assumed. The choice formula does **not** fit score (MAE 0.1213, max
0.554). The residual is one-sided and tracks the 2 dp rounding: `confidence` is computed
upstream from the unrounded distribution. K = 1 is accepted and returns confidence 1. Still
uncertain: 10 tied-mode score answers cannot be reconstructed, though all 10 match a tied
level within 0.02.

**H8 — non-determinism.** Fifty byte-identical requests moved every field: largest per-field
sd 0.0236, largest range 0.12; even a peaked 0.96 answer moves ±0.01. Forty duplicate copies
of one question inside a single request were as noisy as separate requests (within/across
sd ratio 0.63–1.05), so "ask twice and compare" is two draws, not a consistency check. On a
knife-edge state the returned `choice` itself flipped: at a mean margin of 0.091 it changed in
2/25 identical requests, at 0.216 in 0/25. `answers` key order follows the request (50/50),
but `probabilities` key order does not — six distinct orders were seen for one question.
Question key names, from `q` to `is_the_customer_furious_and_about_to_churn`, spread the mean
by 0.029, inside the 0.087 noise floor of a duplicated question, with no gradient by slot.
Still uncertain: the source of the jitter (batching, temperature) and whether any seeding is
available.

**H9 — `output_tokens`.** Holding state, instructions and type fixed, the question **key**
alone moved `output_tokens` from 20 to 269 while `input_tokens` stayed at 386 in all 24
requests — the key is billed but never reaches the model — and it follows the tokeniser, not
the character count (two 500-character keys cost 269 and 119). Answer values are free: 0.00,
0.01, 0.03 and 0.99 all cost 21, and 157 zero probabilities in a 200-option answer cost the
same 11 tokens each as the winner. Response size is not it either: a 670-character 10-level
score answer and a 143-character 2-level one both cost 18. Latency is flat — 228 ms at 2
options vs 267 ms at 200, for 51.7x the output tokens. The whole surface is reproduced by
`output_tokens = 4 + Σ(base(type) + tokens(key) + options_charge)`, with `base` 15 (noul),
12 (score), 16 (choice) and ~11 tokens per `label_000`-style option. Still uncertain:
whether that pricing holds over time.

## 3. Best practices

Ordered by how much they matter to a typical `advocaat` user.

**1. Put every fact the model needs in `state`.**
*Evidence:* H1 — a sibling question's text leaks at exactly 0.000 (0/12), the same fact in
`state` is used 12/12 at p = 1.00. H5 — moving a reference table from an option description
into `state` went from 33/48 to 48/48 (+31 points, mean p 0.634 → 1.000).
*Apply:* pass the data as the `ask` state, or let a tag interpolation build it, and point
questions at paths. Never write a question that refers to another question's wording or
answer; chain requests in code instead.

```ts
const { team } = await ask(
  { ticket, routing_table: TABLE },
  { team: ask.choice`Which team owns \`ticket\`, per \`routing_table\`?`(TEAMS) },
);
```

**2. An option description describes that option and nothing else.**
*Evidence:* H5 — an option carrying shared reference text becomes an attractor: accuracy 14/16
when it sat first, 8/16 last (spread 38 points), and every error was the model picking the
option that held the text. An appended catch-all did not rescue it (30/48).
*Apply:* keep `criteria` values to "what this label means" / "what it is not for"; anything
that describes the task, other labels, or shared data belongs in `state` or `instructions`.

**3. Write the criteria map once, keep its order fixed, and re-baseline after any change.**
*Evidence:* H3 — the same state and the same three labels gave p(winner) 0.549…0.749 purely
from order (spread 0.200 vs within-order sd 0.030). H4 — appending one option that scores 0.00
still moves the log-odds between two others by up to 0.125 [0.059, 0.191].
*Apply:* a module-level literal, never a `Set`, a database ordering, or keys built at runtime.
A reordered map is a changed prompt, and any edit to `criteria` invalidates your thresholds.

```ts
const KINDS = { bug: "Something is broken", feature: "A request for new behaviour", other: null };
```

**4. Give every threshold a margin, and check `p_top − p_second` before trusting `choice`.**
*Evidence:* three independent sources of movement add up — option order up to ±0.10 in the mid
range and ±0.035 near the ceiling (H3), run-to-run noise ~±0.05 at 2 sd (H8), choice-set
changes ~±0.02 at p = 0.6 (H4). At a margin of 0.091 the returned `choice` flipped in 2/25
identical requests (H8); at 0.216 it never did.
*Apply:* treat anything inside the dead band as undecided and route it.

```ts
const sorted = Object.values(kind.probabilities).sort((a, b) => b - a);
if (sorted[0] - sorted[1] < 0.2) return escalate(issue); // ranking is not stable below this
```

**5. Do not decide on `confidence`; threshold on `probabilities`.**
*Evidence:* H7 — `confidence` is a deterministic rescaling of numbers you already have.
Choice: `(p_max − 1/K)/(1 − 1/K)`, MAE 0.0056, 100% within 0.02 over 350 answers. Score:
`1 − E_p|i − mode|/D(K)` with `D(K) = floor(K/2)·ceil(K/2)/K`, MAE 0.0058. It is also not
comparable across K (confidence 0.6 is p_max 0.80 at K = 2 but 0.64 at K = 10) and it
amplifies noise by `1/(1 − 1/K)`, so a confidence threshold is about twice as jumpy as the
same threshold on `p_max`.
*Apply:* use `kind.probabilities[kind.choice]` for choice; `severity.probabilities[level]` for
"is this level right", and the distribution's own spread for "is this number precise".
`ask.if`/`ask.chance` have no confidence at all — `chance` is the whole answer.

**6. Calibrate on your own labelled set, and treat a low top probability as "no decision".**
*Evidence:* H6 — aggregate ECE 0.037 over 510 items hides a set at 30.0% accuracy where
chance is 25%. Across all sets, answers with top probability ≥ 0.6 were right 96.4% of the
time (n = 414) and answers below 0.6 were right 27.1% (n = 96). A low probability is not the
model saying "I cannot do this": on modular exponents it still over-claimed by 0.09.
*Apply:* build 100–150 hand-labelled items per task, bin the top probability against accuracy,
and pick the cut-off from that table. Route everything under it.

```ts
if (kind.probabilities[kind.choice] < 0.6) return human(issue);
```

**7. Never ask for exact computation.**
*Evidence:* H6 — modular exponents 30.0% against a 25% floor,
while two-digit addition in the identical 4-option format is 100.0%. The failure is the task,
not the format.
*Apply:* compute in code and ask the model only for the judgment around it — which candidate
is meant, whether a result is plausible, how to route it.

**8. Batch: one `ask` per state, not one `ask` per question.**
*Evidence:* H2 — the state is charged exactly once per request (250 questions add the same
4952 tokens on a 200-character and a 16,000-character state). On a 16,000-character state,
250 questions in one call cost 8292 tokens; the same 250 single-question calls cost about
835,000. Up to ~100 questions the batch is free in latency (1.24x).
*Apply:* collect every question the branch might need, including speculative ones, into one
`ask(state, {...})` and ignore the answers you do not use. Awaiting a tag on its own sends a
separate request — reserve that for one-off checks.

**9. Size the batch yourself against two separate caps.**
*Evidence:* H2 — the state alone must stay under 32,768 tokens and state + questions under
65,536; over either, the API returns
`400 {"detail":{"error_type":"max_tokens_exceeded"}}` before doing any work. The cost law is
`input_tokens = 275 + 0.1894 × stateChars + 20.52 × questions` (R² > 0.999): ~5.3 characters
of state per token and ~20.5 tokens per short question — 2.27x per character of prose, mostly
the JSON scaffolding around each question.
*Apply:* `if (stateChars / 5.3 + 21 * questionCount > 60_000) split(...)`, and set
`signal: AbortSignal.timeout(...)` — advocaat does not retry.

**10. Budget latency by request size, not by question count alone.**
*Evidence:* H2 — median wall ≈ 200 ms + 4 ms per 1000 input tokens: 220 ms at a 98-character
state, 778 ms at 140,000 characters, 218 ms at 1 question, 1306 ms (p90 1566) at 1500
questions.
*Apply:* keep a batch under ~500 questions for a sub-second p90.

**11. Ignore `output_tokens`; it measures your naming, not the work.**
*Evidence:* H9 — the same question under a 1-character key billed 20 output tokens and under a
500-character worded key 119, with `input_tokens` fixed at 386 and the answer identical. It is
blind to the answer value and to response size, and it is deterministic.
*Apply:* keep keys short in large batches in case anything ever bills on it (H2's 1500
questions under `q0`..`q1499` billed 28,894 output tokens; 500-character keys would bill
~178,500), and keep option labels terse — they cost 6.8–18.4 output tokens each *and* are
real input.

**12. Retrying or duplicating a question does not buy certainty.**
*Evidence:* H8 — 40 copies of one question inside a single request disagree as much as 40
separate requests (within/across sd ratio 0.63–1.05).
*Apply:* if you want a self-consistency signal, vary the *question* — or, per H3, send it
twice with the option list reversed and average. Do not persist or diff these probabilities
as if they were stable identifiers of a state.

**13. Never rely on `probabilities` key order.**
*Evidence:* H8 — six distinct orders came back for one question over 100 responses; `answers`
key order did follow the request (50/50), but look answers up by key anyway.
*Apply:* always index by label: `kind.probabilities.bug`, never
`Object.values(kind.probabilities)[0]`.

**14. Question keys are for your code; they carry no signal.**
*Evidence:* H8 — ten key names from `q` to
`should_we_immediately_refund_this_angry_person` spread the mean answer by 0.029, inside the
0.087 noise floor of a duplicated question, with no gradient by slot position. H9 — the key
never appears in `input_tokens`.
*Apply:* put the whole meaning in the question text and name the key for the destructuring.

## 4. Documentation corrections

Nothing below was edited; these are the statements the findings contradict or refine.

- `.agents/typesafe.md`: "Token budget per request is ~32,000 tokens (~150k chars), shared by
  state and questions." → There are **two** caps: the state alone must stay under 32,768
  tokens (~172,000 characters) *and* state + questions under 65,536 tokens together; a
  198-character state with 3100 questions (65,260 tokens) was accepted. (H2)
- `.agents/typesafe.md`: "Errors: `401` bad key, `422` validation (body names the field)…" →
  Oversize requests return `400 {"detail":{"error_type":"max_tokens_exceeded"}}`, not 422, and
  it is a hard reject rather than a truncation. (H2)
- `.agents/typesafe.md`: "Most queries complete in about 100 ms." → ~70–100 ms is *upstream*
  time for a small request; median wall time is ~220 ms and grows with size, reaching 1306 ms
  at 1500 questions. (H2)
- `.agents/typesafe.md`: "adding questions barely changes latency" → True to about 100
  questions (1.24x of a single question); 1500 questions cost 5.98x. (H2)
- `.agents/typesafe.md`: "[confidence] is a statistic derived from the shape of
  `probabilities`: one peak = high, flat = low." → It is exactly `(p_max − 1/K)/(1 − 1/K)` for
  choice and `1 − E_p|i − mode|/D(K)`, `D(K) = floor(K/2)·ceil(K/2)/K`, for score, so it adds
  no information to `probabilities`. (H7)
- `.agents/typesafe.md`: "Use three bands: high → act; medium → confirm / flag; low → route to
  a human" (on `confidence`) → Band on `p_max` or on `p_top − p_second`; a confidence
  threshold is not comparable across different K (0.6 = p_max 0.80 at K = 2, 0.64 at K = 10)
  and is about twice as noisy as the same threshold on `p_max`. (H7, H8)
- `.agents/typesafe.md`: "If you only want the best option, take the top `choice`; you do not
  need a threshold." → Check `p_top − p_second` first: at a margin of 0.091 the returned
  `choice` changed in 2/25 byte-identical requests. (H8)
- `.agents/typesafe.md`: "probabilities are calibrated across many predictions (0.8 ≈ right
  80% of the time)" → True in aggregate (ECE 0.037 over 510 items) and false per task: on
  modular exponents the mean top probability was 0.389 against 30.0% accuracy at a 25% floor.
  Verify on your own task before trusting any number. (H6)
- `.agents/typesafe.md`: "Add an `other` / `none of the above` option when the list may not
  cover every input." → Worth keeping for coverage (it cost no probability mass in H4), but it
  is not a safety net: in H5 a catch-all was never chosen and did not prevent the model picking
  the option that carried misplaced reference text. (H4, H5)
- `.agents/typesafe.md`: "Option names and descriptions are both sent to the model." → Add
  that their **order** is part of the prompt: reordering the same three labels moved the
  winner's probability by up to 0.200. (H3)
- `README.md`: "`confidence` (0...1) is high when one label stands out and low when they are
  close." → It is the deterministic rescaling `(p_max − 1/K)/(1 − 1/K)`; for a decision,
  threshold `probabilities` instead. (H7)
- `skills/advocaat/SKILL.md`: "They run in parallel and cannot see one another's answers." →
  Stronger and now measured: they cannot see one another's `instructions` or `criteria`
  either — leakage was exactly 0.000 through both channels. (H1)
- `skills/advocaat/SKILL.md`: "The keys of the `questions` object are for code and are not sent
  to the model" → Confirmed (key name moves the answer by 0.029, inside noise; `input_tokens`
  unchanged across 24 requests), but add that keys *are* billed in `output_tokens`. (H8, H9)
- `skills/advocaat/SKILL.md`: "Extra questions still use tokens; the request budget is shared
  by state and questions" → Quantify: ~20.5 tokens per short question, ~0.19 tokens per state
  character, state charged once per request, and two separate caps rather than one budget. (H2)

## 5. Open questions

- **`score` was barely probed for the structural effects.** H3 (option order), H4 (choice-set
  interaction) and H5 (reference position) were all run on `choice` only. Whether reordering
  or rewording score levels moves `ratio` the same way is untested — and score levels are
  ordered by meaning, so "keep the order fixed" is not a fix that is available there.
- **Catch-all options on real data.** H5 tested `unlisted` on a synthetic lookup task where it
  was never chosen. Whether `other: null` absorbs genuine out-of-taxonomy inputs in a real
  workflow, and at what probability, is unknown.
- **Rate limiting and concurrency.** Every agent sent one request at a time with a pacing gap.
  No 429 was ever observed; H2 saw 13 transient 5xx/network failures that succeeded on retry.
  Behaviour under parallel requests from one key, and the actual rate limit, are unmeasured.
- **Choice-set direction.** H4's effect flips sign between two state sets (`feedback` +0.125,
  `ticket` −0.051) with no way to predict which from the added option. Two state sets is not
  enough to characterise it.
- **Calibration on production data.** H6's workflow items were written for the experiment, and
  its clear subset has no answers below 0.6 at all, so the 0.6 cut-off rests mostly on the
  arithmetic and MMLU sets. The rule needs re-deriving on real inputs.
- **Stability over time.** All numbers are from one day, one key, one region, with
  `jev-latest` resolving to whatever it resolved to on 2026-09-18. The token caps, the
  `output_tokens` pricing formula could all be account- or version-scoped.
- **The source of the jitter.** H8 measured non-determinism but not its cause, and no seeding
  or temperature control was found to test against.
- **Score confidence ties.** 10 score answers had tied modes at 2 dp and cannot be
  reconstructed; all 10 match one of the tied levels within 0.02, but the upstream
  tie-breaking rule is unknown.
