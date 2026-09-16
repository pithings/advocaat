# Playground

Workspace package for real-world checks of `ask`. It depends on `advocaat`, which `pnpm-workspace.yaml` overrides to the local source, so no build step is needed.

## Issue triage

```sh
export TYPESAFE_API_KEY=...
export GITHUB_TOKEN=...   # optional for public repos, required for --apply
pnpm --filter playground triage unjs/h3 --limit 5
pnpm --filter playground triage unjs/h3 --limit 5 --comments --apply   # also reads the last comments, then adds the labels
```

Each issue is one `ask` call with four questions (kind, severity, security, needs-info). Label rules live in the script, not in prompts.
