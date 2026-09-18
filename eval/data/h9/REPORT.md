# H9 - `output_tokens` is billing, not generation

Claims (EVAL.md): the count varies with question key text the model never sees; 0.0 costs the same
as 0.01; latency is independent of it (a 200-option question costs about the same as a 2-option
one).

| claim | verdict |
| --- | --- |
| `output_tokens` changes with the question key text alone | **CONFIRMED** (same question, same state, same `input_tokens`: 20 tokens under a 1-character key, 119 under a 500-character worded one and 269 under a 500-character repeated one) |
| the model never sees that key | **CONFIRMED** (`input_tokens` = 386 for every key length, 24 requests) |
| an answer of 0.00 costs the same as 0.01 and 0.99 | **CONFIRMED** (identical batches: 84 output tokens with two 0.00 answers, 84 with none) |
| a 200-option question costs about the same latency as a 2-option one | **CONFIRMED** (228 ms vs 267 ms median wall; 78 vs 104 ms upstream) |
| `output_tokens` counts generated text | **REFUTED** (see the model below) |
| `output_tokens` is the size of the returned JSON | **REFUTED** (a 670-character score answer and a 143-character one are both 18) |

One question per request, the same 461-character state everywhere, strictly sequential,
250 ms minimum gap, order shuffled with the seeded PRNG.

## What `output_tokens` actually counts

Every cell here, and every cell of H2, is reproduced to the token by

```
output_tokens = 4 + sum over questions of ( base(type) + tokens(question key) + options_charge )
base(noul) = 15    base(score) = 12    base(choice) = 16
options_charge = 0 for noul and score, whatever the number of score levels;
                 for choice, a per-option charge that tracks the label text
                 (measured at 20 options: 6.8 tokens for a 1-character label, 11.0 for
                 `label_000`, 18.4 for a 45-character label; the `label_000` rate is exactly
                 11.000 from 2 options to 200, R2 = 1)
```

`tokens(...)` is the tokeniser, not a character count (see below). Nothing in the expression is the
answer. The probability values, the score levels, the legend and
the length of the returned JSON all drop out; the question **key** and the option **labels** - names
the caller chose - are the only things that move it, and the key is not even sent to the model.

## (a) Key text only

Same state, same instructions, same type, one question; only the key name changes.

Two key shapes at each length: one repeated letter (`kkk...`) and ordinary English words
(`invoice_refund_billing...`). Every cell n=3; every reading inside a cell identical.

| key chars | output_tokens, `kkkk...` | output_tokens, worded key | input_tokens | median wall ms |
| --- | --- | --- | --- | --- |
| 1 | **20** | **20** | 386 | 245 |
| 20 | **29** | **24** | 386 | 239 |
| 100 | **69** | **40** | 386 | 250 |
| 500 | **269** | **119** | 386 | 217 |

`input_tokens` is 386 in all 24 requests and the answer is 0.95 in all of them, so the key
is invisible to the model and to the input bill - but it is billed on the way out.

**Tokens of the key, not characters.** Two keys of the same 500 characters cost 269 and 119
output tokens. The repeated letter packs into ~2 characters per token, the worded key into ~5, and
the billed counts follow the tokeniser exactly - so a character count of the key cannot explain it.

Slopes: 0.500 output tokens per character for the repeated key (R2 1.000), 0.198 for the
worded key (R2 1.000) - that is 2.0 and 5.0 characters per billed token, the two tokenisation
rates of those two strings.

## (b) Option count, 2 -> 200

Same state, same instructions, same key (`pick`); only the number of options changes.

| options | n | median output_tokens | median input_tokens | median wall ms | p90 wall ms | median upstream ms |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 6 | 43 | 444 | 228 | 250 | 78 |
| 5 | 6 | 76 | 522 | 225 | 254 | 73 |
| 20 | 6 | 241 | 912 | 244 | 259 | 91 |
| 50 | 6 | 571 | 1692 | 251 | 287 | 97 |
| 100 | 6 | 1121 | 2992 | 247 | 437 | 94 |
| 200 | 6 | 2221 | 5592 | 267 | 448 | 104 |

`output_tokens` = 21 + 11.00 x options (R2 1.000): exactly 11 tokens per option, whatever the
option's probability turns out to be.

Latency is flat: 228 ms at 2 options and 267 ms at 200 (upstream 78 vs 104 ms),
a 1.17x change for 51.65x the `output_tokens` and 12.59x the `input_tokens`. The model scores all
200 options in the same single pass it uses for 2.

**The per-option charge is the label text.** 20 options, identical descriptions, only the label
names differ:

| label style | label chars | n | median output_tokens | per option | median input_tokens | median wall ms |
| --- | --- | --- | --- | --- | --- | --- |
| `a` | 1 | 4 | 157 | 6.8 | 752 | 461 |
| `label_000` | 9 | 4 | 241 | 11.0 | 832 | 231 |
| `internal_routing_taxonomy_category_number_000` | 45 | 4 | 388 | 18.4 | 972 | 244 |

## (c) What the answer says

| condition | n | median answer | probability entries | answer JSON chars | median output_tokens | median input_tokens |
| --- | --- | --- | --- | --- | --- | --- |
| p00 | 6 | 0.01 | 0 | 39 | **21** | 390 |
| p01 | 6 | 0.03 | 0 | 39 | **21** | 393 |
| p99 | 6 | 0.99 | 0 | 39 | **21** | 390 |
| score10 | 6 | - | 10 | 670 | **18** | 576 |
| score2 | 6 | - | 2 | 143 | **18** | 405 |

(`p00`/`p01`/`p99` are the wordings piloted to return 0.00/0.01/0.99; asked one at a time they
returned 0.01, 0.03, 0.99 - see below.) All three yes/no conditions share one key (`verdict`) and instructions padded to one length, so only
the answer differs. They cost the identical 21 output tokens: the value is free.

Asked on its own, a yes/no question never returned below 0.01 here (18 requests), so the 0.00
comparison comes from the batched pilots: two requests of five yes/no questions under identical
1-character keys, one answering `0.01, 0.00, 0.01, 0.00, 0.01` and the other
`0.01, 0.01, 0.01, 0.02, 0.94`, both billed **84** output tokens.
A single 200-option answer makes the same point inside one response: 157 of its 200 probabilities
are exactly `0`, and every entry is still charged the same 11 tokens.

Scores ignore their levels entirely: a 2-level and a 10-level score cost the same 18 output tokens,
although the 10-level answer returns 10 probability entries and a 670-character body against
2 entries and 143 characters. So it is not response size either - it is the answer shape the
API decided to price.

## Interpretation

`output_tokens` is a derived number computed from the *shape* of the request and the *names* the
caller chose, not from anything the model produced:

- it rises one-for-one with the tokenised length of the question **key**, a string that never
  reaches the model (`input_tokens` is unchanged at 386 across 24 requests);
- it is blind to the answer: 0.00, 0.01, 0.03 and 0.99 all cost 21, and 157/200 zero
  probabilities in one answer cost the same 11 each as the winner;
- it is blind to response size: a 670-character score answer with 10 probabilities and a
  143-character one both cost 18;
- it is deterministic: every one of the 108 requests hit the exact predicted integer,
  with zero variance inside a cell - real generation does not do that;
- it buys no time: 2221 output tokens at 200 options came back in 104 ms of server
  time, the same as 43 tokens at 2 options.

The best reading is that the model evaluates each question in one forward pass and returns a
probability vector, and `output_tokens` is then *priced* as if that answer had been typed out as
JSON: a fixed structural charge per question by type, plus the tokenised key, plus a per-option
charge covering the label name and its number. Scores are priced as one number because the level
descriptions came from the request. It is an invoice line, not a measurement.

## n and raw data

108 successful requests (24 key-length, 36 option-count, 12 label-text, 30
answer-value, 6 exploratory pilots); no request failed. Every attempt is in
`eval/data/h9/*.jsonl`, keyed by `meta.phase`, `meta.len`, `meta.style`, `meta.k`, `meta.kind`,
`meta.rep`.

## Rule for library users

1. Do not use `output_tokens` to predict latency. It is a function of your key
   names and option labels.
2. If a provider ever bills you on it, **your naming is the bill**. H2's batch of 1,500 yes/no
   questions under `q0`..`q1499` billed 28,894 output tokens (19.3 per answer); the same 1,500
   answers under 500-character worded keys would bill about 178500. Keep keys short in large
   batches - it changes nothing about the answers.
3. Options are cheap in time and dear in tokens: 2 -> 200 options moved median wall time by
   39 ms but `output_tokens` by 2178 and `input_tokens` by 5148. Use as many options as the
   problem really has, but keep label names terse: they cost 6.8-18.4 output tokens each and they are
   input as well.
4. Treat `output_tokens` as a response-shape meter: it tells you how wide your questions were, not
   how hard the model worked.
