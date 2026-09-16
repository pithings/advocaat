- Keep the project small, minimal, intuative and fast. No backward compatibility is needed yet.
- Zero runtime dependencies no Node.js APIs.
- Use simple English. Add short comments only for what the code cannot explain no history or anything can be inferred from code.
- Keep this file current. Use the linked `.agents/` pages for deeper context.

## Docs

- `.agents/typesafe.md`: summary of the TypeSafe System One API docs (endpoint, question types, answer shapes, confidence, design rules, patterns, official SDK defaults).

## Status

- `src/typesafe.ts`: minimal fetch client for the TypeSafe System One API (`typesafe({ apiKey })` → `systemOne`, `models`), plus `noul`/`choice`/`score` builders and typed answers. Reads `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL` from `globalThis.process?.env` when options are omitted. Validates API limits (choice 2–255 options, score 2–10 levels). No retries or logging.
- `src/ask.ts`: `ask(state, questions, options?)` from `IDEA.md`. Bare strings, `ask.choice`/`ask.score`/`ask.chance` tags, and plain client question objects go out as one request; answers come back under the same keys with `chance` (noul) and `ratio` (score scaled to 0–1) added.
- `src/index.ts` exports `ask` and the tags; the client's `noul`/`choice`/`score` builders stay internal.
- `playground/`: private workspace package with a GitHub issue triage CLI (`ask` over `octokit`). `pnpm-workspace.yaml` overrides `advocaat` to `link:.`, and `package.json` `exports` points at `src/` (swapped to `dist/` by `publishConfig` on publish). Node runs the source directly, so `src/` must stay erasable-syntax only (enforced by tsconfig).
