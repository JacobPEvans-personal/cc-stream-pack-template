/**
 * Harness teeth — meta-tests that prove the assertion helpers used by
 * pipelines.test.ts actually catch the failure modes they claim to catch.
 *
 * GENERIC: copied verbatim from the template into every pack repo.
 *
 * These are pure unit tests over the assertion helpers — no Cribl required,
 * no fixtures consumed. They exist so that a future refactor that silently
 * breaks `assertPartialMatch` or `assertRequiredFields` (e.g. drops a guard,
 * narrows a check, swaps a `!==` for `==`) fails CI on every pack that
 * inherits this harness. Without these, "the tests pass" only tells us the
 * fixtures we happened to write didn't fail; it tells us nothing about
 * whether the assertion library can catch a real pipeline regression.
 *
 * Each test phrases a known-bad input and asserts the helper throws with a
 * recognizable diagnostic. If you add a new assertion helper to
 * `test-helpers.ts` or `cribl-client.ts`, add a teeth test here.
 */

import { describe, expect, it } from "vitest";
import { CriblClient, type CriblEvent } from "./cribl-client.js";
import { parseSimpleFilter } from "./parse-filter.js";
import { assertPartialMatch } from "./test-helpers.js";

describe("assertPartialMatch (teeth)", () => {
  it("passes when actual matches expected exactly", () => {
    expect(() =>
      assertPartialMatch([{ a: 1, b: "x" }], [{ a: 1, b: "x" }], "ctx"),
    ).not.toThrow();
  });

  it("passes when actual has extra keys beyond expected (partial-match contract)", () => {
    expect(() =>
      assertPartialMatch(
        [{ a: 1, b: "x", extra: true }],
        [{ a: 1, b: "x" }],
        "ctx",
      ),
    ).not.toThrow();
  });

  it("throws when an expected key is missing from actual", () => {
    expect(() =>
      assertPartialMatch([{ a: 1 }], [{ a: 1, b: "x" }], "fixture-a"),
    ).toThrow(/expected key 'b' missing/);
  });

  it("throws when an expected value differs from actual", () => {
    expect(() =>
      assertPartialMatch([{ a: 1 }], [{ a: 2 }], "fixture-b"),
    ).toThrow(/key 'a'/);
  });

  it("throws on event-count mismatch (actual longer)", () => {
    expect(() =>
      assertPartialMatch([{ a: 1 }, { a: 2 }], [{ a: 1 }], "fixture-c"),
    ).toThrow(/produced 2 events, expected 1/);
  });

  it("throws on event-count mismatch (actual shorter)", () => {
    expect(() =>
      assertPartialMatch([{ a: 1 }], [{ a: 1 }, { a: 2 }], "fixture-d"),
    ).toThrow(/produced 1 events, expected 2/);
  });
});

describe("CriblClient.assertRequiredFields (teeth)", () => {
  it("passes when edge required fields are present", () => {
    const events: CriblEvent[] = [{ sourcetype: "s", index: "main" }];
    expect(() =>
      CriblClient.assertRequiredFields(events, "edge"),
    ).not.toThrow();
  });

  it("throws when edge sourcetype is missing", () => {
    const events: CriblEvent[] = [{ index: "main" }];
    expect(() => CriblClient.assertRequiredFields(events, "edge")).toThrow(
      /sourcetype/,
    );
  });

  it("throws when edge index is missing", () => {
    const events: CriblEvent[] = [{ sourcetype: "s" }];
    expect(() => CriblClient.assertRequiredFields(events, "edge")).toThrow(
      /index/,
    );
  });

  it("passes when stream required fields are present", () => {
    const events: CriblEvent[] = [{ host: "h", source: "src", _time: 0 }];
    expect(() =>
      CriblClient.assertRequiredFields(events, "stream"),
    ).not.toThrow();
  });

  it("throws when stream host is missing", () => {
    const events: CriblEvent[] = [{ source: "src", _time: 0 }];
    expect(() => CriblClient.assertRequiredFields(events, "stream")).toThrow(
      /host/,
    );
  });

  it("throws when stream _time is missing", () => {
    const events: CriblEvent[] = [{ host: "h", source: "src" }];
    expect(() => CriblClient.assertRequiredFields(events, "stream")).toThrow(
      /_time/,
    );
  });

  it("reports the count of violating events", () => {
    const events: CriblEvent[] = [
      { sourcetype: "s", index: "main" },
      { sourcetype: "s" },
      {},
    ];
    expect(() => CriblClient.assertRequiredFields(events, "edge")).toThrow(
      /2\/3 event\(s\)/,
    );
  });
});

describe("parseSimpleFilter (teeth)", () => {
  it("classifies canonical equality as simple", () => {
    const parsed = parseSimpleFilter("datatype=='cribl-demo'");
    expect(parsed.kind).toBe("simple");
    if (parsed.kind === "simple") {
      expect(parsed.field).toBe("datatype");
      expect(parsed.value).toBe("cribl-demo");
    }
  });

  it("classifies double-quoted equality as simple", () => {
    const parsed = parseSimpleFilter('sourcetype=="json"');
    expect(parsed.kind).toBe("simple");
  });

  it("classifies boolean expressions as unsupported (not silently simple)", () => {
    const parsed = parseSimpleFilter("a=='x' && b=='y'");
    expect(parsed.kind).toBe("unsupported");
    if (parsed.kind === "unsupported") {
      expect(parsed.expression).toBe("a=='x' && b=='y'");
    }
  });

  it("classifies function calls as unsupported", () => {
    const parsed = parseSimpleFilter("includes(_raw, 'error')");
    expect(parsed.kind).toBe("unsupported");
  });

  it("classifies null/undefined input as unsupported with empty expression", () => {
    expect(parseSimpleFilter(null).kind).toBe("unsupported");
    expect(parseSimpleFilter(undefined).kind).toBe("unsupported");
  });
});
