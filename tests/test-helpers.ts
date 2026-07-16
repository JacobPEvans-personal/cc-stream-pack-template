/**
 * Per-test-file Cribl client helper + shared assertion utilities.
 *
 * Vitest's globalSetup runs in a separate process, so we can't share a token
 * — each test file constructs its own CriblClient that re-authenticates on
 * first use. The pack itself is already installed (from globalSetup); the
 * pack id flows via env var.
 *
 * `assertPartialMatch` lives here (not inside pipelines.test.ts) so the
 * harness-teeth meta-tests can exercise it in isolation without spinning up
 * Cribl.
 */

import { expect } from "vitest";
import { CriblClient, type CriblEvent } from "./cribl-client.js";

export function makeClient(): CriblClient {
  return new CriblClient({
    host: process.env.CRIBL_HOST,
    port:
      process.env.CRIBL_PORT !== undefined
        ? Number(process.env.CRIBL_PORT)
        : undefined,
    username: process.env.CRIBL_USER,
    password: process.env.CRIBL_PASS,
  });
}

export function getInstalledPackId(): string {
  const id = process.env.CRIBL_PACK_ID;
  if (id === undefined || id.length === 0) {
    throw new Error(
      "CRIBL_PACK_ID env var is unset — globalSetup did not run or failed silently.",
    );
  }
  return id;
}

/**
 * Partial-match assertion: every key in each `expected[i]` must be present in
 * `actual[i]` with an equal value. Extra keys in `actual` are allowed.
 *
 * Throws (via vitest's `expect`) with a context-prefixed message on mismatch
 * — the message names the offending event index and key so failures point
 * straight at the pipeline output that diverged.
 */
export function assertPartialMatch(
  actual: CriblEvent[],
  expected: CriblEvent[],
  context: string,
): void {
  expect(
    actual.length,
    `${context}: pipeline produced ${actual.length} events, expected ${expected.length}`,
  ).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const act = actual[i];
    const exp = expected[i];
    if (act === undefined || exp === undefined) continue;
    for (const [key, expVal] of Object.entries(exp)) {
      expect(
        key in act,
        `${context} event ${i}: expected key '${key}' missing from output`,
      ).toBe(true);
      expect(
        act[key],
        `${context} event ${i}, key '${key}': expected ${JSON.stringify(expVal)}, got ${JSON.stringify(act[key])}`,
      ).toEqual(expVal);
    }
  }
}
