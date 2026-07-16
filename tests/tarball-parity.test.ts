/**
 * Tarball parity — the test-path tarball builder and the release-path tarball
 * builder must include the same top-level entries.
 *
 * GENERIC: copied verbatim from the template into every pack repo.
 *
 * Two parallel implementations of the .crbl whitelist live in this repo:
 *   - `tests/cribl-client.ts::PACK_ROOT_ENTRIES`     (used in CI test job)
 *   - `scripts/build-crbl.sh::INCLUDE=(...)`         (used in release workflow)
 *
 * If they drift, CI passes against one whitelist and ships a tarball with a
 * different whitelist — exactly the failure mode "fixed in commit 452f029
 * (top-level whitelist for createPackTarball)" was meant to prevent. This
 * test pins them together: it builds the tarball both ways from the live
 * pack root and asserts the set of entries matches.
 *
 * No Cribl required. Runs as a plain unit test.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CriblClient, PACK_ROOT, PACK_ROOT_ENTRIES } from "./cribl-client.js";

const BUILD_SCRIPT = path.join(PACK_ROOT, "scripts", "build-crbl.sh");
const REPO_NAME = "tarball-parity-test";
const TAG_NAME = "v0.0.0-parity";
const RELEASE_TARBALL = `/tmp/${REPO_NAME}-${TAG_NAME}.crbl`;
const RELEASE_TARBALL_LATEST = `/tmp/${REPO_NAME}.crbl`;

let tmpDir: string;
let testTarballPath: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "tarball-parity-"));

  // Build the release-path tarball.
  execFileSync(BUILD_SCRIPT, {
    cwd: PACK_ROOT,
    env: { ...process.env, REPO_NAME, TAG_NAME },
    stdio: "pipe",
  });

  // Build the test-path tarball (in-memory) and write it next to the release
  // tarball so we can extract both the same way.
  const buffer = await CriblClient.createPackTarball(PACK_ROOT);
  testTarballPath = path.join(tmpDir, "test-path.crbl");
  writeFileSync(testTarballPath, buffer);
});

afterAll(() => {
  for (const p of [tmpDir, RELEASE_TARBALL, RELEASE_TARBALL_LATEST]) {
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
});

function listTopLevelEntries(tarball: string): string[] {
  // `tar -tzf` prints every entry; keep only the first path segment.
  const out = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  const top = new Set<string>();
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segment = trimmed.replace(/\/.*$/, "").replace(/\/$/, "");
    if (segment.length > 0) top.add(segment);
  }
  return Array.from(top).sort();
}

function parseIncludeFromShellScript(): string[] {
  const script = readFileSync(BUILD_SCRIPT, "utf8");
  const match = script.match(/^INCLUDE=\(([^)]+)\)/m);
  if (match === null || match[1] === undefined) {
    throw new Error(
      `Could not parse INCLUDE=(...) from ${BUILD_SCRIPT} — has the script format changed?`,
    );
  }
  return match[1]
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort();
}

describe("tarball builder parity", () => {
  it("release-path and test-path tarballs contain the same top-level entries", () => {
    const releaseEntries = listTopLevelEntries(RELEASE_TARBALL);
    const testEntries = listTopLevelEntries(testTarballPath);
    expect(testEntries).toEqual(releaseEntries);
  });

  it("shell INCLUDE=(...) is a subset of PACK_ROOT_ENTRIES", () => {
    // The shell whitelist conditionally adds LICENSE inside an `if` block, so
    // we compare the static INCLUDE list against PACK_ROOT_ENTRIES rather than
    // requiring exact equality. Every name in the shell list must appear in
    // the TS set — drift in either direction fails.
    const shellIncludes = parseIncludeFromShellScript();
    const tsWhitelist = Array.from(PACK_ROOT_ENTRIES).sort();
    for (const name of shellIncludes) {
      expect(
        tsWhitelist,
        `shell INCLUDE=(...) contains '${name}' but PACK_ROOT_ENTRIES does not — drift detected`,
      ).toContain(name);
    }
  });

  it("PACK_ROOT_ENTRIES covers every conditional entry in build-crbl.sh", () => {
    // Catches the inverse drift: build-crbl.sh's conditional `LICENSE` (or any
    // future conditional addition) must be allow-listed in PACK_ROOT_ENTRIES.
    const script = readFileSync(BUILD_SCRIPT, "utf8");
    const conditionalAdds = Array.from(
      script.matchAll(/INCLUDE\+=\(([^)]+)\)/g),
      (m) => (m[1] ?? "").trim(),
    );
    for (const raw of conditionalAdds) {
      // Skip the ADDITIONAL_FILES loop iteration — it expands a shell variable,
      // not a baked-in conditional path.
      if (/\$\{extra\}/.test(raw)) continue;
      for (const name of raw.split(/\s+/).filter((s) => s.length > 0)) {
        expect(
          Array.from(PACK_ROOT_ENTRIES),
          `build-crbl.sh conditionally adds '${name}' but PACK_ROOT_ENTRIES does not list it — drift detected`,
        ).toContain(name);
      }
    }
  });
});
