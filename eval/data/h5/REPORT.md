# H5 - position of reference/context inside options

Verdict: **REFUTED as stated, CONFIRMED in the weaker form.**
Position inside the option list matters a lot (spread 38 points), but the
direction is the opposite of the claim: context placed **last** was the *worst* case
(8/16), context placed first the best (14/16). The `state` control reproduced exactly
(48/48).

Claim (EVAL.md): context placed last in an option list is used reliably (16/16);
first/middle degrade (~12/16, 11/16); the same context in `state` is 48/48.

## Design

A lookup table (`value -> label`) is appended to exactly **one** option's description
(the "card holder"). The 3 options are sent in all 6 permutations, so the card holder
sits first / middle / last equally often. The card holder is **never** the correct
answer, so the card's position is not confounded with the answer's identity.
2 templates (shipping zones, support tiers) x 2 values x 6 permutations x 2 reps =
48 requests per condition. Only the reference table determines the answer - the
mappings are arbitrary, so the model cannot answer from priors.

Conditions
- `options` - card inside one option's description
- `options_catchall` - same, plus an `unlisted` catch-all option appended last (the case EVAL.md left untested)
- `state` - card in `state.reference_table`, all option descriptions plain (control)
- `filler` - card in `state`, and an equally long but **irrelevant** paragraph in the same
  option's description (separates "a long option description attracts the answer" from
  "the option holding the reference attracts the answer")

## Results

### card in an option description

| card position | n | correct | Wilson 95% | mean p(correct label) |
| --- | --- | --- | --- | --- |
| first | 16 | 14/16 | 64%-97% | 0.795 |
| middle | 16 | 11/16 | 44%-86% | 0.594 |
| last | 16 | 8/16 | 28%-72% | 0.513 |
| **all** | 48 | 33/48 | 55%-80% | 0.634 |

### card in an option description, with a catch-all option appended

| card position | n | correct | Wilson 95% | mean p(correct label) |
| --- | --- | --- | --- | --- |
| first | 16 | 16/16 | 81%-100% | 0.826 |
| middle | 16 | 9/16 | 33%-77% | 0.633 |
| last | 16 | 5/16 | 14%-56% | 0.383 |
| **all** | 48 | 30/48 | 48%-75% | 0.614 |

### card in state (control)

| position of the marked option | n | correct | Wilson 95% | mean p(correct label) |
| --- | --- | --- | --- | --- |
| first | 16 | 16/16 | 81%-100% | 1.000 |
| middle | 16 | 16/16 | 81%-100% | 1.000 |
| last | 16 | 16/16 | 81%-100% | 1.000 |
| **all** | 48 | 48/48 | 93%-100% | 1.000 |

### card in state, long irrelevant text in one option (filler control)

| position of the filled option | n | correct | Wilson 95% | mean p(correct label) |
| --- | --- | --- | --- | --- |
| first | 8 | 8/8 | 68%-100% | 1.000 |
| middle | 8 | 8/8 | 68%-100% | 1.000 |
| last | 8 | 8/8 | 68%-100% | 1.000 |
| **all** | 24 | 24/24 | 86%-100% | 1.000 |

## Effect sizes

- accuracy by card position: first 14/16, middle 11/16, last 8/16; **spread 38 points**
- mean p(correct label) by card position: first 0.795, middle 0.594, last 0.513
- card in options overall 33/48 (p 0.634) vs card in state 48/48 (p 1.000): **+31 points** for moving the card to `state`
- with a catch-all option: 30/48 overall (first 16/16, middle 9/16, last 5/16); the catch-all was never chosen, so it neither rescues nor worsens the failure
- filler control (card in state, long irrelevant text in one option): 24/24 (p 1.000)

## Mechanism

- errors: 33/96; the model picked the card-holding option in 33 of them, the catch-all in 0
- card holder **before** the correct option: 45/48 correct
- card holder **after** the correct option: 18/48 correct
- accuracy by position of the *correct* option: first 11/32, middle 21/32, last 31/32

Every error was the same error: the model chose the option that *contained* the
reference table, i.e. it read the card as a description of that option. Position
decides whether that attractor wins: when the card sits **before** the correct option
it mostly loses, when it sits **after** it mostly wins. The `state` and `filler`
controls show this is not plain option-order sensitivity and not description length -
with the card in `state`, every permutation was answered correctly at p = 1.00.

n = 168 requests.
Raw data: `eval/data/h5/*.jsonl` (one line per attempt, verbatim request and response).

## Practical rule

Reference material - lookup tables, rubrics, shared context, anything more than a
description of the option itself - belongs in `state`, never inside an option
description. An option whose description carries text about *other* options becomes an
attractor: the model picks it, and how often depends on where it sits in the list.
Adding an `other`/`unknown` option does not protect against this.
