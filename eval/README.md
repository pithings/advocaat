# Jev evaluation harness

Hypotheses live in `../EVAL.md`. Nothing here is committed.

## Run

```sh
node eval/smoke.ts     # from the repo root; Node >= 22.18 strips types natively
```

Keys come from `../.env`, parsed by `lib.ts` itself (commented-out lines count), so no
`--env-file`. Each attempt appends a JSON line to `eval/data/<hyp>/<ISO-date>.jsonl` (ts,
hyp, provider, meta, verbatim request, status, all headers, verbatim response, latencyMs,
retries); `writeReport` writes `eval/data/<hyp>/REPORT.md`.

## API (`eval/lib.ts`)

- `send(hyp, { state, questions }, meta?, { provider = "vercel" | "typesafe", pace = 150, tries = 6 }?) => { provider, answers, usage, headers, latencyMs, status, raw }` — serial queue, retries 429/529/5xx/network with backoff + `retry-after`.
- `noul(instructions, criteria?)` `choice(instructions, criteria)` `score(instructions, levels)`.
- Normalised answer: `{ type: "noul"|"choice"|"score", probability|choice|score, probabilities, confidence?, legend? }`. Verbatim provider body stays in `raw`.
- `confidence(probabilities)` = `(max(p)-1/n)/(1-1/n)`; `serverConfidence(raw)`; `upstreamMs(result)` (`x-envoy-upstream-service-time`); `env(name)`.
- `mean` `sd` `median` `quantile` `wilson(k,n,z=1.96)` `pairedT(a,b)` `tTwoSided(t,df)` `logOdds` `shuffle(xs,seed?)` `mulberry32` `sleep` `serial` `writeReport`.
