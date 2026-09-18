# H4 - choice-set interaction (IIA violation)

Verdict: **REFUTED** as stated. Appending an obviously irrelevant option does not produce the
claimed common negative shift: pooled over both state sets the change is 0.037 log-odds,
95% CI [-0.018, 0.091], n=30 blocks - the claimed -0.28 is far outside that interval, and the
block deltas split 13 negative / 16 positive instead of 10/10 negative.

Strict IIA does fail, but small and state-specific. Per-request shifts were
`ticket` -0.051 [-0.109, 0.008], `feedback` +0.125 [0.059, 0.191],
so the largest effect measured here is about 0.1 log-odds (an odds ratio of
x1.13, about 0.03 of probability near p = 0.5), against a claimed 0.28. The junk option
itself came back at 0.00 in every single request, so nothing was "taken" by it.

Claim (EVAL.md): appending an irrelevant option changes the log-odds between two existing options;
mean -0.28, negative in 10/10 blocks. Under independent logits with a fixed temperature the change
is exactly 0, because both options are rescaled by the same normaliser.

## Design

Two state/option sets, each a single choice question:

- **ticket** - 4 options (billing, technical, account, sales), junk option `weather` = "Questions about tomorrow's weather forecast in another city" appended last. Leading pair: `technical` vs `billing`.
  State: "Since yesterday I get an error when opening the app, and I also noticed my plan now says Free. I did not change anything."
- **feedback** - 4 options (bug, feature_request, question, docs), junk option `recipe` = "The writer is asking for a cooking recipe" appended last. Leading pair: `bug` vs `feature_request`.
  State: "The webhook retries three times, the guide says five. I would also like to configure the number myself."

One block = 4 separate single-question requests, sent in a shuffled order inside the block:
4-option baseline, a byte-identical 4-option control, the 5-option version, a byte-identical
5-option control. Block order and within-block order come from `mulberry32(40401)`.
Duplicates are pooled inside the block; the two identical requests of a condition give the noise
floor. Log-odds use `log((p(A)+0.005)/(p(B)+0.005))`; 0.005 is half the 2-decimal quantum, so a
rounded 0.00 stays finite.

Requests: 120.

## Primary analysis - the pre-registered 10 blocks

| 10 blocks, 5 per state set | value |
| --- | --- |
| blocks (n) | 10 |
| mean delta log-odds (5 options - 4 options) | **-0.014** |
| 95% CI | [-0.133, 0.106] |
| sd of delta | 0.167 |
| paired t | t(9) = -0.26, p = 0.8023 |
| sign consistency | 4 negative, 5 positive, 1 exactly zero |
| noise floor: identical-request pairs | mean 0.048, sd 0.196 (2n = 20) |
| mean p(junk option) | 0.000 (max 0.00, non-zero in 0/10 blocks) |

| block | setup | log-odds 4 options | log-odds 5 options | delta | duplicate-vs-duplicate (4 opt) | p(junk) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ticket | 0.597 | 0.426 | -0.171 | -0.087 | 0.00 |
| 2 | feedback | 1.585 | 1.739 | 0.154 | 0.025 | 0.00 |
| 3 | feedback | 1.774 | 1.834 | 0.060 | -0.120 | 0.00 |
| 4 | feedback | 1.699 | 1.792 | 0.093 | -0.213 | 0.00 |
| 5 | ticket | 0.800 | 0.532 | -0.268 | -0.140 | 0.00 |
| 6 | feedback | 1.628 | 1.705 | 0.077 | -0.213 | 0.00 |
| 7 | feedback | 1.597 | 1.834 | 0.237 | -0.146 | 0.00 |
| 8 | ticket | 0.468 | 0.468 | 0.000 | 0.084 | 0.00 |
| 9 | ticket | 0.511 | 0.385 | -0.126 | 0.171 | 0.00 |
| 10 | ticket | 0.597 | 0.405 | -0.192 | 0.351 | 0.00 |

## Extended analysis - all 30 blocks

| 30 blocks, both state sets pooled | value |
| --- | --- |
| blocks (n) | 30 |
| mean delta log-odds (5 options - 4 options) | **0.037** |
| 95% CI | [-0.018, 0.091] |
| sd of delta | 0.146 |
| paired t | t(29) = 1.38, p = 0.1778 |
| sign consistency | 13 negative, 16 positive, 1 exactly zero |
| noise floor: identical-request pairs | mean 0.028, sd 0.184 (2n = 60) |
| mean p(junk option) | 0.000 (max 0.00, non-zero in 0/30 blocks) |

The two state sets pull in opposite directions, so pooling hides the effect rather than measuring it:

| ticket | value |
| --- | --- |
| blocks (n) | 15 |
| mean delta log-odds (5 options - 4 options) | **-0.050** |
| 95% CI | [-0.112, 0.012] |
| sd of delta | 0.112 |
| paired t | t(14) = -1.73, p = 0.1062 |
| sign consistency | 10 negative, 4 positive, 1 exactly zero |
| noise floor: identical-request pairs | mean 0.058, sd 0.148 (2n = 30) |
| mean p(junk option) | 0.000 (max 0.00, non-zero in 0/15 blocks) |

| feedback | value |
| --- | --- |
| blocks (n) | 15 |
| mean delta log-odds (5 options - 4 options) | **0.124** |
| 95% CI | [0.055, 0.192] |
| sd of delta | 0.124 |
| paired t | t(14) = 3.86, p = 0.0017 |
| sign consistency | 3 negative, 12 positive, 0 exactly zero |
| noise floor: identical-request pairs | mean -0.001, sd 0.212 (2n = 30) |
| mean p(junk option) | 0.000 (max 0.00, non-zero in 0/15 blocks) |


## Per-request view and the noise floor

Every request counts as one observation (30 per condition per state set). The null column is a
randomisation null: the baseline condition alone, split in half at random 20,000 times, scaled to
the real sample size - i.e. the same statistic computed between requests that are byte-identical.

| state set | n per condition | log-odds 4 opt | log-odds 5 opt | delta | 95% CI | t | null sd | delta / null sd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ticket | 30 | 0.522 | 0.471 | **-0.051** | [-0.109, 0.008] | -1.68 | 0.036 | -1.41 |
| feedback | 30 | 1.664 | 1.789 | **0.125** | [0.059, 0.191] | 3.70 | 0.033 | 3.73 |

Did the junk option absorb probability mass?

| state set | mean p(junk) | max p(junk) | p(A)+p(B) with 4 options | with 5 options |
| --- | --- | --- | --- | --- |
| ticket | 0.0000 | 0.00 | 0.990 | 0.990 |
| feedback | 0.0000 | 0.00 | 0.963 | 0.968 |

No: the junk option came back at 0.00 everywhere, and the two leaders keep the same total mass.
The shift therefore is not "the junk option stole mass", it is the model re-weighing the remaining
options when the list changes.

## Reading

- The claimed effect (-0.28 in every block) is not there: block deltas split
  13/16 negative/positive and the pooled CI excludes -0.28.
- A real but small choice-set interaction is there in one state set (`feedback`, 0.125,
  t = 3.70, 3.7x the identical-request noise floor). The other
  (`ticket`, -0.051) does not clear the noise floor.
- So the ratio between two options is not strictly independent of the rest of the list, but the
  dependence is roughly an order of magnitude smaller than the claim, and its direction is a
  property of the state and the options, not of "an extra option" in general.

## Raw data

`eval/data/h4/*.jsonl` (every attempt: request, response, headers, latency; `meta.setup`,
`meta.cond`, `meta.block`).

## Rule for library users

1. Adding or removing an option is a change to every other option's probability, even when the new
   option scores 0.00. Do not treat a choice question's probabilities as comparable across two
   different option lists - re-baseline your thresholds whenever you edit `criteria`.
2. The size seen here is about 0.1 log-odds, roughly 10% on the odds between two options, or about
   +/-0.02 of probability at p = 0.6. That is smaller than the option-order effect in H3
   (up to 0.2 of probability), so option order is the bigger hazard.
3. The direction is not predictable from the junk option, so you cannot correct for it; give a
   threshold near the top-two boundary a margin instead, or re-measure after any criteria change.
4. Adding a catch-all `other` option is still worth it for coverage: it cost nothing in mass here
   and moved the leaders by less than the run-to-run noise of a threshold at 0.05 granularity.
5. Probabilities arrive at 2 decimals, so a single pair of requests cannot resolve an effect this
   size; you need tens of requests to see it at all, which is another way of saying it is not
   something to engineer around.
