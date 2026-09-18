# H7 — `confidence` is derived, not learned

Verdict: **CONFIRMED**. Both `confidence` fields are closed-form functions of the returned
`probabilities` and the number of options/levels. The claimed choice formula is exact. Score uses a
different formula, given below; it is the same idea with ordinal distance instead of 0/1 distance.

Raw data: `eval/data/h7/*.jsonl` (one line per attempt: request, headers, response). Script: `eval/h7.ts`
(`node eval/h7.ts` collects, `--validate` adds the held-out set, `--offline` re-analyses).

- Fit set: 25 states x (12 choice + 9 score) questions, one request per state (`api.typesafe.ai`, `jev-latest`).
- Held-out set: 10 new states with 5 new choice and 6 new score questions, never used to pick the formula.
- n = **350 choice answers** (K = 2, 3, 4, 5, 6, 7, 10, 25) and **285 score answers** (2, 3, 4, 5, 6, 7, 8, 9, 10 levels).
- Everything arrives at 2 dp. Recomputing a formula from rounded probabilities can miss the rounded
  `confidence` by up to ~0.015 (K = 2) to ~0.010 (K = 25) on arithmetic alone, so the honest
  test is the residual distribution against that bound, not equality.

## Choice: `(p_max - 1/K) / (1 - 1/K)`

| set | n | MAE | bias | max abs | within 0.01 | within 0.02 | within the quantisation bound |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fit | 300 | 0.0056 | -0.0025 | 0.020 | 89% | 100% | 89% |
| held-out | 50 | 0.0057 | -0.0021 | 0.016 | 90% | 100% | 90% |
| all | 350 | 0.0056 | -0.0025 | 0.020 | 89% | 100% | 89% |

Per K (all choice answers):

| K | n | MAE | bias | max abs | within 0.01 | within 0.02 |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 60 | 0.0048 | -0.0002 | 0.010 | 100% | 100% |
| 3 | 60 | 0.0044 | -0.0014 | 0.015 | 93% | 100% |
| 4 | 50 | 0.0064 | -0.0005 | 0.017 | 90% | 100% |
| 5 | 10 | 0.0067 | -0.0032 | 0.013 | 80% | 100% |
| 6 | 50 | 0.0054 | -0.0030 | 0.016 | 94% | 100% |
| 7 | 10 | 0.0043 | -0.0003 | 0.010 | 100% | 100% |
| 10 | 50 | 0.0070 | -0.0051 | 0.020 | 74% | 100% |
| 25 | 60 | 0.0058 | -0.0051 | 0.020 | 82% | 100% |

Every other candidate is an order of magnitude worse:

| formula | MAE | bias | max abs | p95 | within 0.01 | within 0.02 |
| --- | --- | --- | --- | --- | --- | --- |
| pmax (p_max-1/K)/(1-1/K) | 0.0056 | -0.0025 | 0.020 | 0.014 | 89% | 100% |
| 1 - MAD(mode)/((K-1)/2) | 0.0673 | -0.0436 | 0.532 | 0.259 | 45% | 52% |
| 1 - MAD(mode)/D(K) | 0.0761 | 0.0441 | 0.560 | 0.354 | 47% | 55% |
| 1 - H/log K | 0.0911 | 0.0632 | 0.332 | 0.279 | 25% | 31% |
| 1 - MAD(mean)/((K-1)/2) | 0.0947 | 0.0184 | 0.527 | 0.323 | 28% | 37% |
| 1 - var/((K-1)/2)^2 | 0.1260 | -0.0421 | 0.637 | 0.409 | 25% | 33% |
| window +/-1 mass | 0.1553 | -0.1107 | 0.920 | 0.590 | 32% | 36% |
| 1 - sd/((K-1)/2) | 0.1557 | 0.1054 | 0.493 | 0.410 | 21% | 23% |
| smooth a=0.25 | 0.5392 | 0.5392 | 1.000 | 0.986 | 0% | 0% |
| smooth a=0.5 | 0.5416 | 0.5416 | 1.000 | 0.990 | 0% | 1% |

Largest residuals:

| question | K | state | probabilities | server | formula | residual | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| c10a | 10 | silence | 0.00 0.00 0.00 0.00 0.00 1.00 0.00 0.00 0.00 0.00 | 0.98 | 1.000 | -0.020 |  |
| c25b | 25 | ambiguous_intent | 0.00 0.00 0.00 0.00 0.00 0.00 0.01 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.99 0.00 0.00 0.00 0.00 0.00 0.00 | 0.97 | 0.990 | -0.020 |  |
| c25a | 25 | contradiction | 0.00 0.04 0.00 0.00 0.00 0.74 0.00 0.00 0.21 0.00 0.00 0.00 0.00 0.00 0.00 0.01 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 | 0.71 | 0.729 | -0.019 |  |
| c25b | 25 | legalish | 0.00 0.00 0.00 0.04 0.00 0.00 0.00 0.00 0.00 0.23 0.00 0.00 0.02 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.71 0.00 0.00 | 0.68 | 0.698 | -0.018 |  |
| c10b | 10 | pricing | 0.10 0.80 0.00 0.00 0.02 0.00 0.00 0.00 0.08 0.00 | 0.76 | 0.778 | -0.018 |  |
| c10a | 10 | sarcasm | 0.89 0.00 0.11 0.00 0.00 0.00 0.00 0.00 0.00 0.00 | 0.86 | 0.878 | -0.018 |  |
| c4a | 4 | multilingual | 0.02 0.90 0.02 0.06 | 0.85 | 0.867 | -0.017 |  |
| c10b | 10 | long_neutral | 0.30 0.02 0.32 0.01 0.00 0.00 0.00 0.01 0.34 0.00 | 0.25 | 0.267 | -0.017 |  |
| vc25 | 25 | v_invoice | 0.00 0.00 0.00 0.32 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.67 0.01 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 | 0.64 | 0.656 | -0.016 |  |
| c6a | 6 | numbers | 0.01 0.01 0.98 0.00 0.00 0.00 | 0.96 | 0.976 | -0.016 |  |

The residual is one-sided (bias -0.0025) and tracks the 2 dp quantisation: `probabilities` are
rounded to 2 dp and one entry is then nudged so the vector sums to 1 (visible as values like
`0.8099999999999999` in the raw bodies), while `confidence` is computed upstream from the
unrounded distribution.

## Score: `1 - E_p|i - mode| / D(K)`, with `D(K) = floor(K/2) * ceil(K/2) / K`, clipped at 0

`E_p|i - mode| = sum_i p_i * |i - argmax(p)|` is the mean ordinal distance from the chosen level.
`D(K)` is the same quantity for a uniform distribution measured from the middle level, i.e. the
chance level of ordinal dispersion (0.5, 0.67, 1, 1.2, 1.5, 1.71, 2, 2.22, 2.5 for K = 2..10).

This is the same construction as choice: `confidence = 1 - (observed expected distance) / (chance
expected distance)`. With a 0/1 distance, `E_p = 1 - p_max` and `D = 1 - 1/K`, which is exactly the
choice formula. At K = 2 the two formulas coincide.

| set | n | MAE | bias | max abs | within 0.01 | within 0.02 |
| --- | --- | --- | --- | --- | --- | --- |
| fit (no ties) | 218 | 0.0059 | -0.0030 | 0.030 | 83% | 97% |
| held-out (no ties) | 57 | 0.0056 | -0.0018 | 0.020 | 89% | 100% |
| all (no ties) | 275 | 0.0058 | -0.0028 | 0.030 | 85% | 98% |
| tied modes (10), best-matching tied level | 10 | 0.0039 | 0.0023 | 0.010 | 100% | 100% |

Ties are a reconstruction limit, not a failure of the formula: when the top two probabilities are
equal at 2 dp the modal level cannot be recovered, and 10/10 of those answers match one of the
tied levels within 0.02 anyway.

The claimed choice formula does **not** fit score: MAE 0.1213, bias 0.0656, max 0.55 (n = 285) —
it reads too high on peaked distributions and far too high on distributions whose mass sits on
distant levels.

All candidates on score answers:

| formula | MAE | bias | max abs | p95 | within 0.01 | within 0.02 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 - MAD(mode)/D(K) | 0.0067 | -0.0036 | 0.113 | 0.020 | 84% | 97% |
| 1 - sd/((K-1)/2) | 0.1005 | -0.0311 | 0.410 | 0.296 | 14% | 19% |
| 1 - MAD(mean)/((K-1)/2) | 0.1054 | -0.0934 | 0.463 | 0.307 | 22% | 27% |
| pmax (p_max-1/K)/(1-1/K) | 0.1213 | 0.0656 | 0.554 | 0.338 | 25% | 31% |
| 1 - MAD(mode)/((K-1)/2) | 0.1257 | -0.1253 | 0.487 | 0.297 | 18% | 20% |
| 1 - H/log K | 0.1447 | 0.1145 | 0.568 | 0.294 | 11% | 12% |
| 1 - var/((K-1)/2)^2 | 0.2081 | -0.1992 | 0.620 | 0.494 | 12% | 14% |
| window +/-1 mass | 0.2249 | -0.2225 | 1.000 | 0.654 | 12% | 14% |
| smooth a=0.25 | 0.4605 | 0.4520 | 1.000 | 0.998 | 0% | 0% |
| smooth a=0.5 | 0.4992 | 0.4853 | 1.000 | 0.998 | 0% | 0% |

Per K:

| K | n | MAE | bias | max abs | within 0.01 | within 0.02 |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 35 | 0.0037 | -0.0026 | 0.010 | 100% | 100% |
| 3 | 34 | 0.0057 | -0.0016 | 0.020 | 85% | 100% |
| 4 | 25 | 0.0052 | -0.0012 | 0.020 | 92% | 100% |
| 5 | 35 | 0.0036 | -0.0016 | 0.013 | 94% | 100% |
| 6 | 33 | 0.0066 | -0.0043 | 0.023 | 85% | 94% |
| 7 | 25 | 0.0088 | -0.0062 | 0.027 | 56% | 92% |
| 8 | 33 | 0.0074 | -0.0047 | 0.030 | 79% | 97% |
| 9 | 32 | 0.0064 | -0.0011 | 0.020 | 78% | 100% |
| 10 | 23 | 0.0061 | -0.0017 | 0.022 | 87% | 96% |

`D(K)` is not a fitted constant. Fitting `confidence = 1 - c * E_p|i - mode|` independently per K
recovers it:

| K | n | fitted 1/c | D(K) = floor(K/2)*ceil(K/2)/K |
| --- | --- | --- | --- |
| 2 | 6 | 0.500 | 0.500 |
| 3 | 26 | 0.667 | 0.667 |
| 4 | 23 | 1.000 | 1.000 |
| 5 | 30 | 1.192 | 1.200 |
| 6 | 32 | 1.489 | 1.500 |
| 7 | 22 | 1.685 | 1.714 |
| 8 | 30 | 1.976 | 2.000 |
| 9 | 28 | 2.202 | 2.222 |
| 10 | 22 | 2.485 | 2.500 |

Largest residuals:

| question | levels | state | probabilities | server | formula | residual | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s8 | 8 | sarcasm | 0.15 0.39 0.01 0.32 0.12 0.01 0.00 0.00 | 0.37 | 0.400 | -0.030 |  |
| s7 | 7 | thread | 0.93 0.05 0.02 0.00 0.00 0.00 0.00 | 0.92 | 0.948 | -0.027 |  |
| s6 | 6 | contradiction | 0.00 0.00 0.01 0.02 0.18 0.79 | 0.81 | 0.833 | -0.023 |  |
| s6 | 6 | half_sentence | 0.50 0.18 0.27 0.04 0.01 0.00 | 0.39 | 0.413 | -0.023 |  |
| s7 | 7 | security | 0.00 0.00 0.01 0.02 0.05 0.07 0.85 | 0.82 | 0.843 | -0.023 |  |
| s10 | 10 | ambiguous_intent | 0.42 0.14 0.15 0.13 0.09 0.04 0.02 0.01 0.00 0.00 | 0.39 | 0.368 | +0.022 |  |
| s4 | 4 | short | 0.89 0.02 0.01 0.08 | 0.74 | 0.720 | +0.020 |  |
| s4 | 4 | security | 0.46 0.35 0.19 0.00 | 0.25 | 0.270 | -0.020 |  |
| s8 | 8 | emoji | 0.81 0.17 0.00 0.01 0.00 0.00 0.00 0.00 | 0.88 | 0.900 | -0.020 |  |
| s9 | 9 | contradiction | 0.00 0.01 0.00 0.00 0.01 0.04 0.02 0.33 0.59 | 0.71 | 0.730 | -0.020 |  |

## K = 1

The API accepts a single-option choice (no 422) and returns confidence 1, as claimed:

- K=1, probabilities {"any":1}, confidence 1

## Practical rule for library users

1. **Ignore `confidence` for decisions; threshold on `probabilities`.** It adds no information — it is
   a deterministic rescaling of the distribution the caller already has.
2. **Never compare `confidence` across questions with different K.** Confidence 0.6 means
   `p_max` = 0.80 at K = 2, 0.73 at K = 3, 0.64 at K = 10, 0.62 at K = 25. If you want one
   threshold for a whole routing table, threshold `p_max`, or the margin `p_top - p_second`, which is
   what "is there a clear winner" actually means.
3. **Score confidence answers a different question than you may think.** It is high when the mass sits
   near the chosen level, so an answer split 50/50 between two adjacent levels still scores ~0.58 at
   K = 5, while the same split across the two ends scores 0. For "is this level right", use
   `probabilities[score]`; for "is this number precise", use the distribution's own spread.
4. **Leave a noise margin.** Repeated identical requests move probabilities by ~0.01-0.02 (H8), and
   confidence multiplies that movement by `1/(1 - 1/K)` for choice (x2 at K = 2) and by `1/D(K)`
   for score (x2 at K = 2). A threshold on confidence is about twice as jumpy as the same threshold
   on `p_max`.
5. K = 1 is accepted and always returns confidence 1 — a one-option choice tells you nothing; guard it
   in code.
