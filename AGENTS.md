# AGENTS.md

AI-assistant guardrails for this template repo. Detail lives in [`docs/`](docs/);
this file is the load-bearing index.

## What this repo is

Template for new Cribl Stream packs under **JacobPEvans-personal**. New packs
scaffold from here via `gh repo create --template`.

## Scope

| Layer | Source of truth |
|---|---|
| Org-wide policy (TS-everywhere, Biome, Vitest, secrets, releases) | [`dryvist/.github/CLAUDE.md`](https://github.com/dryvist/.github/blob/main/CLAUDE.md) |
| Generic vs pack-specific file boundary | [`docs/file-boundary.md`](docs/file-boundary.md) |
| How the test harness works | [`docs/test-harness.md`](docs/test-harness.md) |
| Local development setup | [`docs/development.md`](docs/development.md) |
| Release process | [`docs/release-process.md`](docs/release-process.md) |
| Validator rules | [`docs/validator-rules.md`](docs/validator-rules.md) |

## Top-level rules

- Don't modify generic files in pack repos — open a PR here. See `docs/file-boundary.md`.
- Don't tag versions; release-please proposes them. See `docs/release-process.md`.
- Don't write inline scripts in workflows — extract to `scripts/*.sh` or use a community action.
