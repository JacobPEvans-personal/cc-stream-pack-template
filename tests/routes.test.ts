/**
 * Route tests — structural + dynamic flow.
 *
 * GENERIC: copied verbatim from the template into every pack repo.
 *
 * Validates:
 * - route.yml exists
 * - every route declares a pipeline
 * - every referenced pipeline has a default/pipelines/<name>/conf.yml
 * - every route uses 'output: __group' (vct-cribl-pack-validator rule)
 * - no route filter is statically falsy (would never match)
 * - no pipeline named 'main' (validator rule)
 * - DYNAMIC: for each route with an auto-resolvable filter, a synthetic
 *   event matching that filter triggers the named pipeline and isn't dropped
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";
import { PACK_ROOT, type Route } from "./cribl-client.js";
import { parseSimpleFilter } from "./parse-filter.js";
import { getInstalledPackId, makeClient } from "./test-helpers.js";

const ROUTE_YML = path.join(PACK_ROOT, "default", "pipelines", "route.yml");
const PIPELINES_DIR = path.join(PACK_ROOT, "default", "pipelines");
const ROUTE_YML_EXISTS = existsSync(ROUTE_YML);

function loadRoutes(): { routes?: Route[] } {
  return yamlParse(readFileSync(ROUTE_YML, "utf-8")) as { routes?: Route[] };
}

describe("route structure", () => {
  it("route.yml exists", () => {
    expect(ROUTE_YML_EXISTS).toBe(true);
  });

  // Subsequent tests parse route.yml. If the file is missing, they would
  // throw ENOENT (unhelpful) and obscure the real issue (the failing
  // 'route.yml exists' assertion above). Skip them instead.
  describe.skipIf(!ROUTE_YML_EXISTS)("with route.yml present", () => {
    it("routes are declared", () => {
      const config = loadRoutes();
      expect(config.routes).toBeDefined();
      expect(config.routes?.length ?? 0).toBeGreaterThan(0);
    });

    it("routes have pipelines", () => {
      const config = loadRoutes();
      for (const route of config.routes ?? []) {
        expect(
          route.pipeline,
          `Route '${route.id ?? "<anonymous>"}' missing 'pipeline' field`,
        ).toBeTruthy();
      }
    });

    it("pipeline files exist for each route", () => {
      const config = loadRoutes();
      for (const route of config.routes ?? []) {
        const conf = path.join(PIPELINES_DIR, route.pipeline, "conf.yml");
        expect(
          existsSync(conf),
          `Route '${route.id}' references pipeline '${route.pipeline}' but ${conf} does not exist`,
        ).toBe(true);
      }
    });

    it("routes use __group output (vct-cribl-pack-validator rule)", () => {
      const config = loadRoutes();
      const bad = (config.routes ?? [])
        .filter((r) => r.output !== "__group")
        .map((r) => r.id);
      expect(
        bad.length,
        `Routes not using output: __group: ${JSON.stringify(bad)}. Per validator rule, routes should target __group so source renames don't break routing.`,
      ).toBe(0);
    });

    it("route filters are not statically falsy", () => {
      const config = loadRoutes();
      for (const route of config.routes ?? []) {
        expect(route.filter, `Route '${route.id}' has no filter`).toBeDefined();
        const normalised = String(route.filter ?? "")
          .trim()
          .toLowerCase();
        expect(
          ["false", "0", '""', "''"].includes(normalised),
          `Route '${route.id}' has falsy filter '${route.filter}' — would never match`,
        ).toBe(false);
      }
    });

    it("no pipeline named main (vct-cribl-pack-validator rule)", () => {
      const config = loadRoutes();
      for (const route of config.routes ?? []) {
        expect(
          route.pipeline,
          `Route '${route.id}' uses pipeline 'main'. Per validator rule, pipelines must have descriptive names.`,
        ).not.toBe("main");
      }
    });
  });
});

describe("route flow (dynamic)", () => {
  const config = existsSync(ROUTE_YML) ? loadRoutes() : { routes: [] };
  const routesForFlow = (config.routes ?? []).filter(
    (r) => r.disabled !== true,
  );

  if (routesForFlow.length === 0) {
    it.skip("no routes declared in default/pipelines/route.yml", () =>
      undefined);
    return;
  }

  for (const route of routesForFlow) {
    const routeId = route.id ?? "<anonymous>";
    const parsed = parseSimpleFilter(route.filter);

    if (parsed.kind === "unsupported") {
      // Loud failure (not silent skip) — the harness can't auto-resolve this
      // filter, so the dynamic flow assertion would otherwise erode invisibly
      // as packs ship more complex filters. Author must either simplify the
      // route filter to `<field>=='<value>'` or extend tests/parse-filter.ts
      // to handle the new form.
      it(`${routeId} route filter is auto-resolvable by the local matcher`, () => {
        expect.fail(
          `Route '${routeId}' filter '${parsed.expression}' is not the canonical \`<field>=='<value>'\` shape. The dynamic-flow test cannot exercise it. Fix by (a) simplifying the route filter to the canonical shape, or (b) extending tests/parse-filter.ts to handle this form (and adding a teeth-test for the new shape).`,
        );
      });
      continue;
    }

    it(`${routeId} routes a synthetic event to its pipeline`, async () => {
      const { field, value } = parsed;
      const event = { [field]: value, _raw: "{}", _time: Date.now() / 1000 };

      const client = makeClient();
      const packId = getInstalledPackId();
      const sampleId = await client.saveSample(`route-flow-${route.id}`, [
        event,
      ]);
      try {
        const result = await client.runRouteFlow(sampleId, [event], {
          pack: packId,
        });
        expect(
          result.route.id,
          `Expected route '${route.id}' to match the synthetic event, but route '${result.route.id}' matched first.`,
        ).toBe(route.id);
        expect(
          result.events.length,
          `Pipeline '${result.pipeline}' produced no output for the synthetic event matching route '${route.id}' — check the pipeline for unconditional Drop functions.`,
        ).toBeGreaterThan(0);
      } finally {
        await client.deleteSample(sampleId);
      }
    });
  }
});
