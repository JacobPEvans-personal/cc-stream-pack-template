// End-to-end proof: start a real Cribl Stream container with a bind-mounted
// route table, push NDJSON events through a tcpjson input, and count what
// lands in each filesystem destination. No preview API — the real routing
// engine, clones, Final flags and all.
//
// Usage: node --experimental-strip-types e2e/run.ts [scenarioDir...]
// A scenario dir contains cribl/ (mounted at $CRIBL_HOME/local/cribl) and
// expect.json ({ dest: expectedCount }). Defaults to e2e/ itself (with
// e2e/config/cribl and e2e/expect.json).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const IMAGE = process.env.CRIBL_IMAGE ?? "cribl/cribl:latest";
const CONTAINER = "cribl-e2e";
const API_PORT = 19000;
const TCP_PORT = 10070;
const EVENT_COUNT = Number(process.env.EVENT_COUNT ?? 1000);

const docker = (...args: string[]): string =>
  execFileSync("docker", args, { encoding: "utf8" });

export function startCribl(configDir: string, outDir: string): void {
  try {
    docker("rm", "-f", CONTAINER);
  } catch {
    /* not running */
  }
  docker(
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-p",
    `${API_PORT}:9000`,
    "-p",
    `${TCP_PORT}:10070`,
    ...["inputs.yml", "outputs.yml", "pipelines"].flatMap((f) => [
      "-v",
      `${join(configDir, f)}:/opt/cribl/local/cribl/${f}`,
    ]),
    "-v",
    `${outDir}:/tmp/out`,
    IMAGE,
  );
}

export async function waitHealthy(timeoutSec = 90): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${API_PORT}/api/v1/health`);
      if (res.ok) {
        // Health turns green before workers finish loading inputs; give them a beat.
        await sleep(6000);
        return;
      }
    } catch {
      /* not up yet */
    }
    await sleep(2000);
  }
  throw new Error(`Cribl not healthy after ${timeoutSec}s`);
}

export type EventShape = Record<string, unknown>;

export function makeEvents(count: number): EventShape[] {
  return Array.from({ length: count }, (_, seq) => ({
    _raw: `event ${seq}`,
    index: "prod",
    sourcetype: "cribl:demo",
    seq,
  }));
}

function sendOnce(events: EventShape[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(TCP_PORT, "127.0.0.1", () => {
      for (const e of events) sock.write(`${JSON.stringify(e)}\n`);
      sock.end();
    });
    sock.on("close", (hadError) =>
      hadError ? reject(new Error("socket closed with error")) : resolve(),
    );
    sock.on("error", () => {
      /* surfaced via close(hadError) */
    });
  });
}

// The tcpjson input can accept-then-reset connections while the worker is
// still starting, so retry the whole batch until one send completes cleanly.
export async function sendEvents(events: EventShape[], retries = 10): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await sendOnce(events);
      return;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(3000);
    }
  }
}

function ndjsonFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return ndjsonFiles(p);
    return name.startsWith("events") && name.endsWith(".json") ? [p] : [];
  });
}

export function readDest(outDir: string, dest: string): EventShape[] {
  return ndjsonFiles(join(outDir, dest)).flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EventShape),
  );
}

// Filesystem dests close files after maxFileIdleTimeSec=10; wait until every
// expected dest's event count is stable across two polls.
export async function waitForFlush(
  outDir: string,
  dests: string[],
  timeoutSec = 60,
): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000;
  let prev = "";
  while (Date.now() < deadline) {
    await sleep(5000);
    const counts = dests.map((d) => readDest(outDir, d).length).join(",");
    if (counts === prev && counts !== dests.map(() => 0).join(",")) return;
    prev = counts;
  }
}

export function stopCribl(): void {
  try {
    docker("rm", "-f", CONTAINER);
  } catch {
    /* already gone */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ScenarioResult {
  scenario: string;
  sent: number;
  counts: Record<string, number>;
  expected: Record<string, number>;
  pass: boolean;
}

export async function runScenario(scenarioDir: string): Promise<ScenarioResult> {
  const expected = JSON.parse(
    readFileSync(join(scenarioDir, "expect.json"), "utf8"),
  ) as Record<string, number>;
  const dests = Object.keys(expected);
  const outDir = mkdtempSync(join(tmpdir(), "cribl-e2e-"));
  startCribl(join(scenarioDir, "cribl"), outDir);
  try {
    await waitHealthy();
    const events = makeEvents(EVENT_COUNT);
    await sendEvents(events);
    await waitForFlush(outDir, dests);
    // Count unique seq values so a retried send can never inflate counts.
    const counts = Object.fromEntries(
      dests.map((d) => [d, new Set(readDest(outDir, d).map((e) => e.seq)).size]),
    );
    const pass = dests.every((d) => counts[d] === expected[d]);
    return { scenario: basename(scenarioDir), sent: events.length, counts, expected, pass };
  } finally {
    // KEEP=1 leaves the container running for inspection at
    // http://localhost:19000 (admin/admin); next run recycles it.
    if (process.env.KEEP === "1") {
      console.error(
        `container ${CONTAINER} kept alive — Cribl UI: http://localhost:${API_PORT} (admin/admin)`,
      );
    } else {
      stopCribl();
    }
  }
}

export function reportMarkdown(results: ScenarioResult[]): string {
  const rows = results.map((r) => {
    const cells = Object.keys(r.expected)
      .map((d) => `${d}: ${r.counts[d]}/${r.expected[d]}`)
      .join(", ");
    return `| ${r.scenario} | ${r.sent} | ${cells} | ${r.pass ? "✅ pass" : "❌ FAIL"} |`;
  });
  return [
    "| Scenario | Sent | Received (actual/expected per dest) | Result |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

const isMain = process.argv[1]?.endsWith("run.ts");
if (isMain) {
  const dirs = process.argv.slice(2);
  const scenarioDirs = dirs.length > 0 ? dirs : [import.meta.dirname];
  const results: ScenarioResult[] = [];
  for (const dir of scenarioDirs) results.push(await runScenario(dir));
  const md = reportMarkdown(results);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  }
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
