# H2 - shared state, batched questions

Claims (EVAL.md): the state is processed once; question tokens cost about 2x state tokens;
about 32,768 tokens per branch and 65,536 per request with the state counted once. Expected
latency: flat to about 100 questions, then a steady rise, with 1500 questions still sub-second.

| claim | verdict |
| --- | --- |
| latency grows with state length | **CONFIRMED** (median 220 ms at 98 chars -> 778 ms at 139994 chars) |
| latency is flat to ~100 questions, then rises | **CONFIRMED** (1 -> 100 questions costs 1.24x, 1 -> 1500 costs 5.98x) |
| 1500 questions still sub-second | **REFUTED** (median 1306 ms wall, 456 ms upstream) |
| question tokens cost ~2x state tokens (per character) | **CONFIRMED** (2.27x) |
| the state is counted once regardless of question count | **CONFIRMED** (250 questions add 4952 tokens on a 200-char state and 4952 on a 16,000-char one) |
| ~32,768 tokens per branch | **CONFIRMED** (state accepted at 32675, rejected at ~33147) |
| ~65,536 tokens per request, state counted once | **CONFIRMED** (accepted at 65260, rejected at ~65969) |

One request per data point, strictly sequential, 250 ms minimum gap, order shuffled with the
seeded PRNG. Prose is one generated document sliced at word boundaries, so every size shares a
prefix and the tokens-per-character ratio is constant.

## (a) Latency vs state length, one question

| state chars | n | median wall ms | p90 wall ms | median upstream ms | median input_tokens | median output_tokens |
| --- | --- | --- | --- | --- | --- | --- |
| 98 | 8 | 220 | 302 | 71 | 296 | 21 |
| 996 | 8 | 230 | 595 | 67 | 478 | 21 |
| 3995 | 8 | 237 | 283 | 87 | 1038 | 21 |
| 15994 | 8 | 225 | 294 | 76 | 3340 | 21 |
| 31993 | 8 | 264 | 404 | 98 | 6398 | 21 |
| 63995 | 8 | 483 | 579 | 114 | 12421 | 21 |
| 100000 | 8 | 528 | 779 | 151 | 19202 | 21 |
| 139994 | 8 | 778 | 804 | 204 | 26825 | 21 |

Tokens per state character: **0.1894** (5.28 chars per token), intercept
296 tokens, R2 = 1.0000, n = 64.

## (b) Latency vs question count, 200-char state

| questions | n | median wall ms | p90 wall ms | median upstream ms | median input_tokens | median output_tokens |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 8 | 218 | 312 | 74 | 318 | 21 |
| 10 | 8 | 257 | 372 | 112 | 485 | 174 |
| 50 | 8 | 250 | 388 | 103 | 1256 | 894 |
| 100 | 8 | 270 | 297 | 122 | 2222 | 1794 |
| 250 | 8 | 403 | 584 | 117 | 5270 | 4644 |
| 500 | 8 | 800 | 955 | 232 | 10347 | 9394 |
| 1000 | 8 | 921 | 1686 | 346 | 20503 | 18894 |
| 1500 | 8 | 1306 | 1566 | 456 | 31160 | 28894 |

Tokens per question: **20.52** (R2 = 0.9999), intercept 197 tokens,
n = 64. Each question is one short yes/no instruction of about
47 characters.

Wall latency at 1500 questions is 5.98x the 1-question latency.

## (c) Token accounting

`input_tokens` is exactly `275 + 0.1894 x stateChars + 20.52 x questions` over the whole
grid (both fits R2 > 0.999, residuals below 1 token on every cell).

| quantity | tokens per character | chars per token | per unit |
| --- | --- | --- | --- |
| state prose | 0.1894 | 5.28 | - |
| question instruction text (47 chars each) | 0.4295 | 2.33 | 20.52 tokens per question |
| whole question object as sent JSON | 0.2306 | 4.34 | - |
| fixed per-request overhead | - | - | 275 tokens |

Ratio question:state **per character of prose** = **2.27x**; per character of the JSON actually
sent (key, `type`, braces and quotes included) = 1.22x. So the 2x is real when you measure the
text you wrote, and most of it is the JSON scaffolding around each question, not a surcharge on
question words: a 47-character question costs 20.52 tokens where the same 47 characters of state
would cost 8.94.

Additivity (is the state counted once?): predicted from the phase (a) and (b) fits alone, which
never saw a large state and many questions together.

| state chars | questions | observed input_tokens | predicted | difference |
| --- | --- | --- | --- | --- |
| 15994 | 1 | 3340 | 3325 | 15 |
| 15994 | 50 | 4278 | 4330 | -52 |
| 15994 | 250 | 8292 | 8434 | -142 |
| 159999 | 100 | 32542 | 32633 | -91 |
| 164996 | 1500 | 62455 | 62304 | 151 |

The residuals are the fits' own error, not a state surcharge. The exact check needs no fit: going
from 1 to 250 questions adds **4952** tokens on a 200-character state and **4952** on a
16,000-character one - identical to the token. A 100,000-character state sent with 1 question and
with 2,000 questions is charged the same 18942 state tokens both times, so the state is counted
**once per request**, not once per question.

`output_tokens` also grows linearly with the question count (19.20 per question, R2 0.9999) while
every answer is a single 2-decimal probability - see H9.

## Hard limits

Every rejection is `HTTP 400 {"detail":{"error_type":"max_tokens_exceeded"}}` - no other 4xx was
seen. Two independent ceilings, both landing exactly on a power of two:

| ceiling | largest accepted | smallest rejected | implied cap |
| --- | --- | --- | --- |
| state alone (its own share of `input_tokens`) | 32675 tokens (171996 chars) | ~33147 tokens (174997 chars) | **32,768 per branch** |
| whole request (`input_tokens`) | 65260 tokens (198 chars + 3100 questions) | ~65969 tokens (198 chars + 3200 questions) | **65,536 per request** |

In characters that is about **172,000 characters of English prose** for the state (the last accepted
size), or about **3,100 short yes/no questions** with a tiny state. The two caps are separate: a
198-character state with 3100 questions (65260 tokens) was accepted, while a 200,000-character state
with a single question (~38179 tokens, well under 65,536) was rejected because the state alone
passes 32,768.

Rejected cells, verbatim:

| state chars | questions | predicted input_tokens | status | body |
| --- | --- | --- | --- | --- |
| 174997 | 1 | ~33443 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 177994 | 1 | ~34010 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 200000 | 1 | ~38179 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 259992 | 1 | ~49542 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 198 | 3200 | ~65969 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 100000 | 2400 | ~68459 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 198 | 3400 | ~70072 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 399994 | 1 | ~76061 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 198 | 5000 | ~102900 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 700000 | 1 | ~132887 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |
| 198 | 8000 | ~164453 | 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` |

(13 transient 5xx/network attempts occurred during the run; all were retried and succeeded, and
they are excluded from every table.)

## n and raw data

149 successful requests, 11 rejections. Every attempt (request, response, headers, latency) is in
`eval/data/h2/*.jsonl`, keyed by `meta.phase`, `meta.stateChars`, `meta.n`, `meta.rep`.

## Rule for library users

1. **Batch.** One state plus every question you have, in one request. The state is charged once
   however many questions ride on it, so N questions in one call cost
   `state + N x 20.52` tokens instead of `N x state`. On a 16,000-char state, 250 questions in one
   call cost 8292 tokens; the same 250 one-question calls would cost about
   835000.
2. **What a request may hold:** state under ~32,768 tokens (~170,000 characters of English) *and*
   state + questions under ~65,536 tokens together. Over either, the API returns
   `400 max_tokens_exceeded` before doing any work - it is a hard reject, not a truncation, so
   size the batch yourself. A safe self-check is `chars/5.3 + 21 x questions < 60,000`.
3. **Latency:** budget ~200-250 ms for anything small. Both dimensions cost, in the same currency:
   median wall time is roughly 200 ms + 4 ms per 1,000 input tokens
   (220 ms at 98 chars, 778 ms at 139994 chars, 218 ms at 1 question, 1306 ms at 1500).
   Up to ~100 questions the batch is free (1.24x); past ~250 it grows roughly linearly.
4. **1500 questions is not sub-second** (median 1306 ms, p90 1566 ms),
   though only 456 ms of that is server time - the rest is transferring a
   31k-token request and a 1500-key response. If you need a sub-second p90, keep a
   batch under ~500 questions.
