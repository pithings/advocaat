# Jev behavioural findings — verification brief

Source: black-box reconstruction (archerhume.com, jev-1.13.0, 2026-09-17).
All claims below are UNVERIFIED on the current model. Test each.

https://x.com/4rcherhume/status/2100555442061820286
https://archerhume.com/posts/jevs-architecture-unmasked/?v=3

## Setup
- One early-access key, single region. Record `x-envoy-upstream-service-time`, model version, timestamps.
- Shuffle request order; one request at a time; note server load is uncontrolled.
- Probabilities return at ~2dp. Save raw payloads + responses.

## H1 — Question isolation
Claim: questions cannot read each other; both can read `state`.
Test: put `SECRET=ZEBRA-7741` (a) in a sibling question, (b) in `state`. Ask a probe question to pick the code from [correct, 2 distractors, none]. 5 reps each.
Expect: (a) ~0.00, (b) ~0.90.

## H2 — Shared state, batched questions
Claims: state processed once; question tokens cost ~2x state tokens; ~32,768 tok/branch, ~65,536 tok/request with state counted once.
Test: (a) latency vs state length, 1 question; (b) latency vs question count (1→1500), short state; 8 reps per size.
Expect: flat to ~100 questions, then steady rise; 1500 still sub-second.

## H3 — Option order sensitivity
Claim: reordering options moves the probability of the same answer (~0.84–0.89 → ~0.93–0.96).
Test: fixed ticket + 3 labels, all 6 permutations, 8 reps. Report per-permutation mean and total spread.
Impact: spread crossing a decision threshold = threshold is unsafe.

## H4 — Choice-set interaction (IIA violation)
Claim: appending an irrelevant option changes log-odds between two existing options; mean −0.28, negative in 10/10 blocks.
Test: 10 randomised blocks of {4-option baseline, identical 4-option control, 5-option with junk option appended, identical 5-option control}. Pool duplicates within block; paired t on log[p(A)/p(B)].
Expect: if independent logits + fixed temperature, change = 0.

## H5 — Position of reference/context inside options
Claim: context placed last in an option list is used reliably (16/16); first/middle degrade (~12/16, 11/16); same context in `state` is 48/48.
Test: reference-card task, 2 templates, 2 values, 6 permutations, 2 reps + state control.
Note: untested for catch-all options (`other`/`unknown`) — test separately if relevant.

## H6 — Calibration
Claim: ECE ~0.031 on 1200 MMLU items, but per-task failure exists (modular exponents: 56% correct at mean p 0.35).
Test: on YOUR labelled workflow data, 10 equal-width bins, accuracy vs mean top probability, Wilson intervals. Do not trust aggregate-only agreement.

## H7 — `confidence` field is derived, not learned
Claim: Choice confidence = (p_max − 1/K)/(1 − 1/K); K=1 returns 1. Score uses a different formula.
Test: recompute from returned distribution; assert exact match.
Action if true: threshold on raw probabilities, ignore `confidence`.

## H8 — Non-determinism
Claim: identical requests, and duplicate questions within one request, return slightly different values.
Test: 50 identical requests + 40 duplicate questions in one request. Report variance, and stability of response key order.

## H9 — `output_tokens` is billing, not generation
Claims: count varies with question ID text the model never sees; 0.0 costs same as 0.01; latency independent of it (200-option question ≈ 2-option question).
Test: vary question ID length only; vary option count 2→200 holding input constant; compare latency.

## Deliverable
Per hypothesis: CONFIRMED / REFUTED / INCONCLUSIVE, effect size, n, raw data path.