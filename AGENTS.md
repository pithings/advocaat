- Keep the project small, minimal, intuative and fast. No backward compatibility is needed yet.
- Zero runtime dependencies no Node.js APIs.
- Use simple English. Add short comments only for what the code cannot explain no history or anything can be inferred from code.
- Keep this file current. Use the linked `.agents/` pages for deeper context.

## Docs

- `.agents/typesafe.md`: summary of the TypeSafe System One API docs (endpoint, question types, answer shapes, confidence, design rules, patterns, official SDK defaults) and the Vercel AI Gateway evaluation wire protocol.

## Status

- `src/api.ts`: minimal fetch client for the TypeSafe System One API (`typesafe({ apiKey })` → `systemOne`, `models`), plus `noul`/`choice`/`score` builders and typed answers. Reads `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL` from `globalThis.process?.env` when options are omitted. With only `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` set (or `provider: "vercel"`), it speaks the Vercel AI Gateway evaluation protocol instead and maps answers back to the System One shape (`confidence` computed from the top probability, `legend` built from criteria, `models()` throws). Validates API limits (choice 2–255 options, score 2–10 levels). No retries or logging.
- `src/ask.ts`: `ask(state, questions, options?)` from `IDEA.md`. Bare strings, `ask.choice`/`ask.score`/`ask.chance` tags (also callable as `ask.choice(instructions, criteria)`, where instructions may be a JSON object or array), and plain client question objects go out as one request; answers come back under the same keys with `chance` (noul) and `ratio` (score scaled to 0–1) added. `askIf` (also `ask.if`) is a template tag for one yes/no question resolved to a boolean (`askIf(options)` binds options; `threshold` defaults to 0.5); interpolated objects and arrays become the `input` state (one directly, several as an array) and each slot in the question becomes its path.
- `src/index.ts` exports `ask`, `askIf`, and the tags; the client's `noul`/`choice`/`score` builders stay internal.
- `playground/`: private workspace package with a GitHub issue triage CLI (`ask` over `octokit`). `pnpm-workspace.yaml` overrides `advocaat` to `link:.`, and `package.json` `exports` points at `src/` (swapped to `dist/` by `publishConfig` on publish). Node runs the source directly, so `src/` must stay erasable-syntax only (enforced by tsconfig).
