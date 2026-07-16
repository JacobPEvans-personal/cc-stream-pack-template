// Canonical Cribl filter shape we can auto-resolve: `<field>=='<value>'`.
// Anything more complex (boolean ops, function calls, regex) is out of scope
// for the local evaluator. Callers receive an explicit `{kind: 'unsupported'}`
// so they can decide whether to fail loudly or fall back — silent skips are
// banned (they let coverage rot invisibly).
//
// The quote group `(['"])` is back-referenced via `\2` to require matching
// open/close quotes, and the value class `[^'"]*` rejects embedded quotes —
// without this, `(.*?)` would greedily span boolean expressions like
// `a=='x' && b=='y'` and silently classify them as simple.
const SIMPLE_FILTER_RE = /^\s*([A-Za-z_]\w*)\s*==\s*(['"])([^'"]*)\2\s*$/;

export type ParsedFilter =
  | { kind: "simple"; field: string; value: string }
  | { kind: "unsupported"; expression: string };

/**
 * Classify a Cribl route filter expression.
 *
 * Returns `{kind: "simple", field, value}` for `<field>=='<value>'` (or
 * `=="<value>"`); `{kind: "unsupported", expression}` for anything else.
 *
 * Discriminated union (not nullable) so callers MUST handle the unsupported
 * case explicitly — a missed branch becomes a TypeScript error rather than
 * an implicit skip.
 */
export function parseSimpleFilter(
  expr: string | null | undefined,
): ParsedFilter {
  const expression = expr ?? "";
  const match = expression.match(SIMPLE_FILTER_RE);
  if (!match || match[1] === undefined || match[3] === undefined) {
    return { kind: "unsupported", expression };
  }
  return { kind: "simple", field: match[1], value: match[3] };
}
