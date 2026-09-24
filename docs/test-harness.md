# Test harness

Vitest-based, lives entirely in `tests/`. Auto-discovers fixtures by filesystem
convention — no TypeScript edits needed to add tests.

## What gets tested

- **`routes.test.ts` (structure)**: `route.yml` exists. Every route has a
  pipeline, and every referenced pipeline file exists. Routes use
  `output: __group`. No filter is statically falsy. No pipeline is named `main`.
- **`routes.test.ts` (dynamic flow)**: per route, a synthetic event that
  matches its filter reaches the named pipeline and is not dropped. Uses live
  Cribl.
- **`pipelines.test.ts`**: per fixture, the pipeline produces non-empty
  output. Output partially matches `<case>.expected.json` when present.
  Required fields are asserted (`sourcetype` + `index` for Edge; `host` +
  `source` + `_time` for Stream) unless a `.skip-required-fields` marker
  exists.
- **`tarball-parity.test.ts`**: the whitelist in
  `tests/cribl-client.ts::PACK_ROOT_ENTRIES` (used by every test-time pack
  install) matches `INCLUDE=` in `scripts/build-crbl.sh` (used by every
  release). Catches drift before a release ships a tarball CI never validated.
- **`harness-teeth.test.ts`**: meta-tests. Every assertion helper used by the
  suites above throws on its target failure mode. Unit-level; no Cribl needed.

Adding a new assertion helper? Add a matching case to `harness-teeth.test.ts`
in the same PR — the `it()` names there are the source of truth for what each
guard catches.

## Fixture convention

```text
tests/fixtures/<pipeline-name>/<case>.json           # input event(s)
tests/fixtures/<pipeline-name>/<case>.expected.json  # optional partial-match expected output
tests/fixtures/.skip-required-fields                 # optional org-wide opt-out marker
```

The generic `pipelines.test.ts` auto-discovers and parametrizes one Vitest case
per `<case>.json`. Add a fixture → tests run automatically. Remove a fixture →
tests stop running. No code changes.

## Cribl version matrix

Default: `latest` plus the last patches of the previous two minors (N / N-1 /
N-2). `latest` is required; older legs are best-effort. Shape lives in the
`cribl_versions` input default in `.github/workflows/cribl-pack-test.yml` —
edit the JSON there to bump, add, or remove versions. Each leg posts its own
status check (`Test pack pipelines (Cribl <version>)`) so branch protection
can require `latest` specifically. When `latest` rolls over to a new minor,
bump both older entries forward one.

## Required-fields assertion

Edge packs are expected to set `sourcetype` and `index` (typically via an Eval
function in the pipeline). Stream packs set `host`, `source`, `_time`. The
assertion fires unconditionally on every pipeline test unless you opt out by
creating an empty `tests/fixtures/.skip-required-fields` file (use this for
pass-through packs whose downstream sets these fields).

## CriblClient API surface

`tests/cribl-client.ts` wraps the Cribl management API. Reference:

| Method | Purpose |
| --- | --- |
| `waitUntilReady()` | Block until `/health` returns 200 |
| `installPack(tarball, expectedId?)` | Upload `.crbl` + poll until pack registers |
| `deletePack(packId)` | Remove pack |
| `saveSample(name, events)` / `deleteSample(id)` | Sample lifecycle |
| `runPipeline(pipeline, sampleId, {pack})` | Execute via `/preview` (mode `pipe`); returns output events |
| `runRouteFlow(sampleId, events, {pack})` | Local route matcher (Cribl has no `mode:route`): finds the match in `route.yml`, runs its pipeline |
| `assertRequiredFields(events, packType?)` | Assert canonical fields per pack type |
| `startCapture(filter, ...)` / `readCapture(id, ...)` | Live capture primitives (reserved for future integration tests) |
| `createPackTarball(packRoot)` (static) | Build `.crbl` from on-disk pack contents |
