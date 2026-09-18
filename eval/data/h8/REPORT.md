# H8 — non-determinism

Verdict: **CONFIRMED**. Identical requests do not return identical numbers, and duplicate copies of
one question inside a single request disagree with each other by the same amount. The movement is
small in absolute terms (~0.01-0.02 on a probability) but it is enough to flip the top choice when
two options are close.

Raw data: `eval/data/h8/*.jsonl` (one line per attempt: request, headers, response).
Script: `eval/h8.ts` (`--offline` re-analyses without sending).

One fixed state, two question sets over it:
- **split** — the primary set: a 3-option choice sitting near 50/50 (`mood`), a second 3-option
  choice at ~0.46/0.54 (`team`), a 3-level score with spread mass (`effort`), one yes/no question
  near 0.5 (`at_risk`).
- **peaked** — the same shape of questions where the model is sure (top probability ~0.96-0.99),
  kept as a contrast.

n = 50 + 50 identical requests, 3 + 3 duplicate-carrying requests (40 copies per question),
12 key-name requests, 25 knife-edge requests = **155 requests**.
All values arrive at 2 dp, so 0.01 is the quantum; an sd of 0.006 means the value moves by one
quantum most of the time.

## A — 50 identical requests (split set)

| field | n | mean | sd | min | max | range |
| --- | --- | --- | --- | --- | --- | --- |
| at_risk probability | 50 | 0.454 | 0.0123 | 0.43 | 0.48 | 0.05 |
| effort confidence | 50 | 0.319 | 0.0443 | 0.20 | 0.43 | 0.23 |
| effort p(0) | 50 | 0.092 | 0.0128 | 0.07 | 0.13 | 0.06 |
| effort p(1) | 50 | 0.271 | 0.0163 | 0.24 | 0.30 | 0.06 |
| effort p(2) | 50 | 0.637 | 0.0208 | 0.59 | 0.69 | 0.10 |
| effort score | 50 | 1.546 | 0.0296 | 1.46 | 1.62 | 0.16 |
| mood confidence | 50 | 0.533 | 0.0357 | 0.45 | 0.63 | 0.18 |
| mood p(negative) | 50 | 0.307 | 0.0236 | 0.24 | 0.36 | 0.12 |
| mood p(neutral) | 50 | 0.693 | 0.0236 | 0.64 | 0.76 | 0.12 |
| mood p(positive) | 50 | 0.000 | 0.0000 | 0.00 | 0.00 | 0.00 |
| team confidence | 50 | 0.942 | 0.0105 | 0.92 | 0.96 | 0.04 |
| team p(billing) | 50 | 0.030 | 0.0075 | 0.02 | 0.05 | 0.03 |
| team p(success) | 50 | 0.010 | 0.0014 | 0.00 | 0.01 | 0.01 |
| team p(technical) | 50 | 0.961 | 0.0079 | 0.94 | 0.98 | 0.04 |

- largest per-field sd **0.0236**, largest per-field range **0.12**
- `mood` top answer: neutral 50/50 — top answer differed in **0/50**
- `team` top answer: technical 50/50 — top answer differed in **0/50**
- `effort` top answer: 2 50/50 — top answer differed in **0/50**

Contrast, the peaked set over the same state (n = 50):

| field | n | mean | sd | min | max | range |
| --- | --- | --- | --- | --- | --- | --- |
| at_risk probability | 50 | 0.452 | 0.0106 | 0.43 | 0.47 | 0.04 |
| department confidence | 50 | 0.942 | 0.0093 | 0.92 | 0.96 | 0.04 |
| department p(billing) | 50 | 0.029 | 0.0062 | 0.02 | 0.04 | 0.02 |
| department p(success) | 50 | 0.010 | 0.0014 | 0.01 | 0.02 | 0.01 |
| department p(technical) | 50 | 0.960 | 0.0064 | 0.95 | 0.97 | 0.02 |
| frustration confidence | 50 | 0.983 | 0.0045 | 0.98 | 0.99 | 0.01 |
| frustration p(0) | 50 | 0.010 | 0.0000 | 0.01 | 0.01 | 0.00 |
| frustration p(1) | 50 | 0.990 | 0.0000 | 0.99 | 0.99 | 0.00 |
| frustration p(2) | 50 | 0.000 | 0.0000 | 0.00 | 0.00 | 0.00 |
| frustration score | 50 | 0.990 | 0.0000 | 0.99 | 0.99 | 0.00 |

- largest per-field sd **0.0106**, largest per-field range **0.04**
- `department` top answer: technical 50/50 — top answer differed in **0/50**; `frustration` top answer: 1 50/50 — top answer differed in **0/50**

The noise does not vanish when the model is sure, but it cannot move the decision: a 0.96 stays
0.96 +/- 0.01. The size of the movement grows towards the middle of the range (largest sd here is on
the ~0.3/0.7 question, smallest on the 0.99 one), and section E shows what it does when two options
are genuinely close.

### Key order

- `answers` key order equals the request order in 50/50 responses (1 distinct order seen).
- `probabilities` key order is **not** stable: `mood` 6 distinct orders, `team` 6 distinct orders, `effort` 1 distinct orders, `department` 6 distinct orders, `frustration` 1 distinct orders over 100 responses.

## B — 40 duplicates of each question inside one request

Identical instructions and criteria under 40 different keys, 3 requests (split set).

| field | within-request sd (mean over requests) | within-request range | across-request sd | across-request range | ratio within/across |
| --- | --- | --- | --- | --- | --- |
| at_risk probability | 0.0080 | 0.04 | 0.0123 | 0.05 | 0.66 |
| effort p(0) | 0.0106 | 0.05 | 0.0128 | 0.06 | 0.83 |
| effort p(1) | 0.0171 | 0.07 | 0.0163 | 0.06 | 1.05 |
| effort p(2) | 0.0203 | 0.08 | 0.0208 | 0.10 | 0.97 |
| effort score | 0.0264 | 0.11 | 0.0296 | 0.16 | 0.89 |
| mood p(negative) | 0.0200 | 0.09 | 0.0236 | 0.12 | 0.84 |
| mood p(neutral) | 0.0197 | 0.08 | 0.0236 | 0.12 | 0.83 |
| mood p(positive) | 0.0015 | 0.01 | 0.0000 | 0.00 | n/a (no across-request variation) |
| team p(billing) | 0.0056 | 0.02 | 0.0075 | 0.03 | 0.74 |
| team p(success) | 0.0009 | 0.00 | 0.0014 | 0.01 | 0.63 |
| team p(technical) | 0.0060 | 0.02 | 0.0079 | 0.04 | 0.76 |

- `mood` top answer over all 120 duplicates: neutral 120/120 — top answer differed in **0/120**
- `team` top answer over all duplicates: technical 120/120 — top answer differed in **0/120**

The within-request spread matches the across-request spread (ratios near 1). Copies of a question in
one request are *not* repeated samples of a stable value being measured twice; they are as noisy as
two separate calls, which also means questions in one request do not agree with each other by
construction.

## E — a knife-edge state: how often does the chosen option flip?

A shorter version of the same feedback, 25 identical requests, two 3-option choices whose
leading pair sits within 0.05.

| field | n | mean | sd | min | max | range |
| --- | --- | --- | --- | --- | --- | --- |
| mood confidence | 25 | 0.408 | 0.0374 | 0.35 | 0.48 | 0.13 |
| mood p(negative) | 25 | 0.392 | 0.0241 | 0.34 | 0.43 | 0.09 |
| mood p(neutral) | 25 | 0.608 | 0.0252 | 0.57 | 0.66 | 0.09 |
| mood p(positive) | 25 | 0.001 | 0.0028 | 0.00 | 0.01 | 0.01 |
| team confidence | 25 | 0.318 | 0.0356 | 0.25 | 0.39 | 0.14 |
| team p(billing) | 25 | 0.000 | 0.0000 | 0.00 | 0.00 | 0.00 |
| team p(success) | 25 | 0.545 | 0.0254 | 0.49 | 0.59 | 0.10 |
| team p(technical) | 25 | 0.455 | 0.0254 | 0.41 | 0.51 | 0.10 |

- `team` (mean margin p_top - p_second = **0.091**, smallest margin seen 0.00): success 23/25, technical 2/25 — top answer differed in **2/25**
- `mood` (mean margin **0.216**, min 0.14): neutral 25/25 — top answer differed in **0/25**

So the `choice` field itself — not just the probabilities — is non-deterministic once the margin
falls near the noise. At a margin of ~0.09 the answer changed in 2/25 identical requests; at a margin
of ~0.22 it never did.

## D — do question key names change the answer?

The most spread `mood` question sent 10 times in one request under very different key
names, key order reshuffled per request, 12 requests. Measure: p(negative).

| key name | n | mean p(negative) | sd |
| --- | --- | --- | --- |
| `q` | 12 | 0.309 | 0.0168 |
| `a` | 12 | 0.306 | 0.0239 |
| `should_we_immediately_refund_this_angry_person` | 12 | 0.302 | 0.0226 |
| `x7` | 12 | 0.301 | 0.0223 |
| `MOOD_CLASSIFICATION_V2_FINAL` | 12 | 0.297 | 0.0277 |
| `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz` | 12 | 0.297 | 0.0178 |
| `trivial_and_ignorable_question_nobody_reads` | 12 | 0.294 | 0.0173 |
| `positive` | 12 | 0.293 | 0.0234 |
| `mood` | 12 | 0.288 | 0.0230 |
| `is_the_customer_furious_and_about_to_churn` | 12 | 0.280 | 0.0307 |

- spread of the per-name means: **0.029**
- noise floor: mean within-request range over 40 identical duplicates (part B) = **0.087**;
  mean within-request range over these 10 names = 0.074
- by slot position in the request (1st to 10th): 0.293, 0.295, 0.301, 0.300, 0.311, 0.288, 0.288, 0.298, 0.307, 0.286

The per-name spread sits inside the noise a duplicated question produces anyway, and there is no
gradient by position. Key names are not evidence for the model, as the docs state.

## Practical rule for library users

1. **Treat every probability as +/- 0.05 (2 sd).** The same request twice, or the same question twice
   in one request, gives answers that differ in the second decimal. Do not persist or diff these
   numbers as if they were stable identifiers of a state.
2. **Leave a dead band around thresholds.** If `p` is within ~0.05 of a cut-off, treat the answer as
   undecided and route it, rather than letting the coin land. On the knife-edge question in section E
   (margin 0.09) the returned `choice` flipped in 2/25 identical requests — the top `choice` field is not a stable output when
   the two leading options are within ~0.05 of each other. Check the margin `p_top - p_second`
   before you trust `choice`.
3. **Retrying does not buy certainty, and neither does duplicating the question.** Duplicates inside
   one request are as noisy as separate requests, so "ask twice and compare" is not a consistency
   check; it is two draws from the same jittery distribution. If you need a self-consistency signal,
   vary the question, not the key.
4. **Never rely on `probabilities` key order.** It is unstable across responses (this run saw
   6 different orders for one question). `answers` key order does follow the request, but
   look answers up by key anyway.
5. **Name keys for your own code.** Key names, however loaded, move the answer no more than noise.
