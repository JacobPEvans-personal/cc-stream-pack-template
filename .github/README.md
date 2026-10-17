# `.github/` — workflow callers for Cribl packs

The workflows in this directory are event callers. Pack test, release, and E2E
jobs call reusable workflows from `jpe-cribl/.github` at a pinned commit. The
shared workflows provide the CI behavior and shared scripts.

## Installation

These caller workflows are copied when a pack is scaffolded from the template.
The reusable workflows resolve at runtime from `jpe-cribl/.github`; shared CI
scripts are checked out under `.gh-shared/` in CI.

## Usage

- A PR touching `default/`, `data/samples/`, `tests/`, `scripts/`, or
  `package.json` runs `test.yml`.
- A manual dispatch or PR touching `e2e/**` runs `e2e.yml`.
- A version tag runs `pack-release.yml` and publishes the `.crbl` artifact.
- Release automation is handled by `release.yml`.

## Shared workflow calls

- `test.yml` calls `cribl-pack-test.yml` from `jpe-cribl/.github`.
  Inputs: `pack_type`, `cribl_versions`, `node_version`, and `yq_version`.
- `pack-release.yml` calls `cribl-pack-release.yml` from `jpe-cribl/.github`.
  Inputs: `additional_files` and `tag`.
- `e2e.yml` calls `cribl-pack-e2e.yml` from `jpe-cribl/.github`.

The test and validation jobs check out the shared scripts into `.gh-shared/`.

## Updating shared workflow inputs

Adding or renaming an input can affect every consumer pack. Keep input defaults
backward compatible whenever possible.

## Pinning external actions

Per [`SECURITY.md`](https://github.com/JacobPEvans/.github/blob/main/SECURITY.md):

- Trusted (`actions/*`, `pnpm/action-setup`, `softprops/action-gh-release`):
  semver tag pins (`@v4`, etc.)
- Untrusted (everything else): SHA pins. Renovate (per the org's
  `renovate.json`) auto-converts version tags to SHA on first run.
