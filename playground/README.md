# Playground

Workspace package for real-world checks of `ask`. It depends on `advocaat`, which `pnpm-workspace.yaml` overrides to the local source, so no build step is needed.

## Personality test

Rate the model on a personality test using `TYPESAFE_API_KEY` or `AI_GATEWAY_API_KEY` (also read from `.env`). With no arguments it runs both bundled tests, the 50 IPIP Big Five items in `ipip-50.json` and the Jungian type items in `mbti.json`, and writes one combined `personality.svg` next to them. Pass a JSON file with the same shape to run one test and print a report instead.

```sh
node playground/personality.ts                          # write personality.svg
node playground/personality.ts playground/mbti.json     # text report (INTJ etc.)
node playground/personality.ts playground/ipip-50.json --items   # also show item scores
node playground/personality.ts playground/ipip-50.json --svg > card.svg
```

Run these from the repo root. Each SVG is a self-contained 1200 × 675 share card titled **Jev's personality test**; `--svg` prints it to stdout and takes priority over `--items`. Open it in a browser or image editor to preview. Emoji appearance depends on the installed fonts. Export to PNG before uploading to X/Twitter, which does not accept SVG uploads.

A test file holds the `prompt` put before each item, the `options` (score levels, in order), the `questions` (`id`, `text`, `trait`, `reverse`), and the `traits` with a `name` and the `results` shown per band. `bands` are cut points on the keyed trait mean, so each trait needs one more result than there are bands. When every trait's result has a `letter`, they combine into a type code (see `mbti.json`, 32 items written for this playground, not the MBTI). `label` appears at the top of each panel.

Scores are keyed means on the 1–N scale of the options, not percentiles. The report describes the model's answers in this run, not Jev's measured personality or a validated AI assessment.

## Issue triage

```sh
export TYPESAFE_API_KEY=...
export GITHUB_TOKEN=...   # optional for public repos, required for --apply
pnpm --filter playground triage unjs/h3 --limit 5
pnpm --filter playground triage unjs/h3 --limit 5 --comments --apply   # also reads the last comments, then adds the labels
```

Each issue is one `ask` call with four questions (kind, severity, security, needs-info). Label rules live in the script, not in prompts.
