# H3 - option order sensitivity

Verdict: **CONFIRMED**

Claim (EVAL.md): reordering the options of one choice question moves the probability of the same
answer (quoted range 0.84-0.89 -> 0.93-0.96).

Design: one choice question, three labels (`billing`, `technical`, `account`, same descriptions
throughout), all 6 orders of the criteria map, 9 reps per order per ticket. Trial order shuffled with `mulberry32(30301)`, one
request per trial, one question per request. Probabilities read by key (response key order is not
request order).

Requests: 108.

## Ticket A - clear ("The download invoice button in the billing page returns a 50"...)

winner label: `technical` (grand means billing 0.074, technical 0.926, account 0.000), n=54

| order | position of `technical` | n | mean p(technical) | sd | argmax != winner |
| --- | --- | --- | --- | --- | --- |
| technical>billing>account | 1 | 9 | 0.952 | 0.010 | 0 |
| account>billing>technical | 3 | 9 | 0.943 | 0.009 | 0 |
| billing>account>technical | 3 | 9 | 0.932 | 0.007 | 0 |
| billing>technical>account | 2 | 9 | 0.922 | 0.008 | 0 |
| technical>account>billing | 1 | 9 | 0.918 | 0.008 | 0 |
| account>technical>billing | 2 | 9 | 0.889 | 0.011 | 0 |

spread (max mean - min mean): **0.063**; pooled within-order sd: 0.009; permutation p = 0.0001
argmax changed on 0/54 trials

| position of `technical` in the list | n | mean p | sd |
| --- | --- | --- | --- |
| 1 | 18 | 0.935 | 0.020 |
| 2 | 18 | 0.906 | 0.019 |
| 3 | 18 | 0.938 | 0.009 |

Mean probability of every label by the slot it sat in (n=54 trials, 18 per label per slot):

| label | listed 1st | listed 2nd | listed 3rd | 1st - 3rd |
| --- | --- | --- | --- | --- |
| `billing` | 0.073 | 0.052 | 0.097 | -0.024 |
| `technical` | 0.935 | 0.906 | 0.938 | -0.003 |
| `account` | 0.000 | 0.000 | 0.000 | +0.000 |

## Ticket B - ambiguous between billing and technical

State: "Since yesterday I get an error when opening the app, and I also noticed my plan now says Free. I did not change anything."

winner label: `technical` (grand means billing 0.325, technical 0.656, account 0.019), n=54

| order | position of `technical` | n | mean p(technical) | sd | argmax != winner |
| --- | --- | --- | --- | --- | --- |
| technical>billing>account | 1 | 9 | 0.749 | 0.044 | 0 |
| technical>account>billing | 1 | 9 | 0.730 | 0.033 | 0 |
| billing>technical>account | 2 | 9 | 0.668 | 0.033 | 0 |
| account>technical>billing | 2 | 9 | 0.650 | 0.025 | 0 |
| account>billing>technical | 3 | 9 | 0.591 | 0.024 | 0 |
| billing>account>technical | 3 | 9 | 0.549 | 0.015 | 0 |

spread (max mean - min mean): **0.200**; pooled within-order sd: 0.030; permutation p = 0.0001
argmax changed on 0/54 trials

| position of `technical` in the list | n | mean p | sd |
| --- | --- | --- | --- |
| 1 | 18 | 0.739 | 0.039 |
| 2 | 18 | 0.659 | 0.030 |
| 3 | 18 | 0.570 | 0.029 |

Mean probability of every label by the slot it sat in (n=54 trials, 18 per label per slot):

| label | listed 1st | listed 2nd | listed 3rd | 1st - 3rd |
| --- | --- | --- | --- | --- |
| `billing` | 0.376 | 0.309 | 0.291 | +0.086 |
| `technical` | 0.739 | 0.659 | 0.570 | +0.169 |
| `account` | 0.029 | 0.016 | 0.011 | +0.019 |

## Effect sizes

| ticket | n | spread of per-order means | pooled within-order sd | spread / sd | permutation p |
| --- | --- | --- | --- | --- | --- |
| clear | 54 | 0.063 | 0.009 | 7.20 | 0.0001 |
| ambiguous | 54 | 0.200 | 0.030 | 6.60 | 0.0001 |

Probabilities come back at 2 decimals, so 0.005 of any single reading is quantisation.

## Raw data

`eval/data/h3/*.jsonl` (every attempt: request, response, headers, latency; `meta.phase`,
`meta.ticket`, `meta.order`, `meta.rep`).

## Rule for library users

Option order is an input, not presentation. The same state, the same three labels and the same
descriptions gave p(winner) from 0.889 to 0.952 on the clear ticket and
0.549 to 0.749 on the ambiguous one, purely from where the labels sat.

The direction is primacy: on the ambiguous ticket every label gained probability when listed first
(winner 0.739 first vs 0.570 last). Near the ceiling the position effect is smaller and no longer
monotone, so it is a bias that grows as the decision gets closer to a coin flip.

1. Write the criteria map as a literal in one place and keep the order fixed. Never build it from a
   `Set`, a database row order, or anything that can reorder between deploys - a reordered map is a
   changed prompt.
2. Give any probability or confidence threshold a margin of about **+/- 0.10 in the mid range**
   (p around 0.5-0.75) and **+/- 0.035 near the ceiling** (p above 0.9). A 0.70 cut-off on a question
   whose true value sits near 0.65 will flip on option order alone.
3. The argmax itself is safe when the leaders are far apart (0/108 trials changed the top label
   here), but the gap between the top two labels moved by up to 0.200. If your top two are within
   about 0.2 of each other, do not trust the ranking from one order.
4. If a decision has to sit near a threshold, send the question twice with the label list reversed
   and average, or put the option you most want to avoid over-picking first and read the result as
   an upper bound for it.
