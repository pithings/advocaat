# H1 - question isolation

Verdict: **CONFIRMED**

Claim (EVAL.md): questions cannot read each other; both can read `state`.
Expected (a) ~0.00, (b) ~0.90.

Probe: 4-option choice [correct code `ZEBRA-7741`, 2 distractor codes, `none`],
option order and distractors reshuffled per rep with a seeded PRNG and held
identical across the conditions of that rep. The sibling question is sent in the
same request, before the probe.

Conditions
- `sibling_instructions` - secret in a sibling question's `instructions`
- `state` - secret in `state.security_note`
- `sibling_criteria` - secret in a sibling choice question's option description
- `no_secret` - secret nowhere (guessing baseline; chance = 0.25)
- `own_instructions` - secret in the probe's own `instructions` (positive control)

## Results

| condition | n | picked correct | Wilson 95% | mean p(correct) | mean p(none) |
| --- | --- | --- | --- | --- | --- |
| sibling_instructions | 12 | 0/12 | 0%–24% | 0.000 | 1.000 |
| state | 12 | 12/12 | 76%–100% | 1.000 | 0.000 |
| sibling_criteria | 12 | 0/12 | 0%–24% | 0.000 | 1.000 |
| no_secret | 12 | 0/12 | 0%–24% | 0.000 | 1.000 |
| own_instructions | 12 | 12/12 | 76%–100% | 0.738 | 0.263 |

## Effect sizes (mean p(correct code))

- state - baseline: 1.000 (1.000 vs 0.000)
- sibling instructions - baseline: 0.000 (0.000 vs 0.000)
- sibling criteria - baseline: 0.000 (0.000 vs 0.000)
- own instructions - baseline: 0.738 (0.738 vs 0.000)

n = 60 requests.
Raw data: `eval/data/h1/*.jsonl` (one line per attempt, verbatim request and response).

## Notes

- The guessing floor is not 1/4: with no secret anywhere the model picked `none`
  12/12 at p(none) = 1.00, so it does not guess among the codes. Any non-zero mass on
  the correct code would therefore have been evidence of leakage.
- `state` beat the claimed ~0.90: the code was recovered at p = 1.00 in 12/12.
- The positive control shows the probe works: the same code in the probe's *own*
  instructions is picked 12/12, at p = 0.74 (the model keeps some mass on `none`).
- Leakage is exactly 0.00 in both directions tested (sibling `instructions` and sibling
  `criteria` descriptions).

## Practical rule

Every fact a question needs must be in `state` or in that question's own
`instructions`/`criteria`. Questions in one request never see each other, so
never write a question that refers to another question's wording or answer;
chain requests in code instead.
