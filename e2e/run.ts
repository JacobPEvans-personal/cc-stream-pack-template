// End-to-end proof: start a real Cribl Stream container, copy in a worker
// config, commit it in Cribl's internal git (no uncommitted state — same
// discipline as a real change), push NDJSON events through a tcpjson input,
// and count what lands in each filesystem destination. No preview API — the
// real routing engine, clones, Final flags and all.
//
// Usage: node --experimental-strip-types e2e/run.ts [scenarioDir...]
// A scenario dir contains cribl/ (copied to $CRIBL_HOME/local/cribl) and
// expect.json ({ dest: expectedCount }). Defaults to e2e/ itself (with
// e2e/cribl and e2e/expect.json).
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Config is COPIED in (docker cp) rather than bind-mounted: Cribl persists
// config via rename(), which fails (EBUSY) over bind-mounted files — UI
// edits would silently not persist and Cribl's internal git would fight
// the mounts. With copies, Cribl fully owns its files.
export function startCribl(configDir: string, outDir: string): void {
  try {
    docker("rm", "-f", CONTAINER);
  } catch {
    /* not running */
  }
  docker(
    "create",
    "--name",
    CONTAINER,
    "-p",
    `${API_PORT}:9000`,
    "-p",
    `${TCP_PORT}:10070`,
    "-v",
    `${outDir}:/tmp/out`,
    IMAGE,
  );
  // The image has no /opt/cribl/local until first boot — stage the tree and
  // copy it in one shot.
  const stage = mkdtempSync(join(tmpdir(), "cribl-local-"));
  cpSync(configDir, join(stage, "cribl"), { recursive: true });
  docker("cp", stage, `${CONTAINER}:/opt/cribl/local`);
  rmSync(stage, { recursive: true, force: true });
  docker("start", CONTAINER);
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

// Commit the config in Cribl's internal git before any data flows — a test
// isn't valid with uncommitted Cribl state.
export async function commitCriblConfig(message: string): Promise<void> {
  const base = `http://localhost:${API_PORT}/api/v1`;
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: process.env.CRIBL_PASSWORD ?? "admin",
    }),
  });
  if (!login.ok)
    throw new Error(
      "Cribl API login failed — set CRIBL_PASSWORD if this instance's admin password was changed",
    );
  const { token } = (await login.json()) as { token: string };
  const commit = await fetch(`${base}/version/commit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  if (!commit.ok)
    throw new Error(`cribl config commit failed: ${await commit.text()}`);
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
    await commitCriblConfig(`e2e scenario ${basename(scenarioDir)}`);
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
    // http://localhost:19000; next run recycles it.
    if (process.env.KEEP === "1") {
      console.error(
        `container ${CONTAINER} kept alive — Cribl UI: http://localhost:${API_PORT}`,
      );
    } else {
      stopCribl();
    }
  }
}

// One flow picture per scenario: events in on the left, where they ended up
// on the right. Renders natively on GitHub — no tooling needed to read it.
// Brand palette (docs / docs-starlight): teal accent ramp on dark navy.
const MERMAID_INIT = `%%{init: {"theme": "base", "themeVariables": {
  "primaryColor": "#0b1d2a", "primaryTextColor": "#f4efe6", "primaryBorderColor": "#4fb3a9",
  "lineColor": "#4fb3a9", "edgeLabelBackground": "#1f4f4a", "textColor": "#f4efe6",
  "fontFamily": "ui-sans-serif, sans-serif"
}}}%%`;
const BOX_OK = "fill:#2f7e78,stroke:#aee4dd,stroke-width:2px,color:#f4efe6";
const BOX_FAIL = "fill:#b3261e,stroke:#ffd8d6,stroke-width:2px,color:#ffffff";
const BOX_NEUTRAL = "fill:#0b1d2a,stroke:#4fb3a9,stroke-dasharray:4,color:#aee4dd";

function mermaidFlow(r: ScenarioResult): string {
  const lines = [
    "```mermaid",
    MERMAID_INIT,
    "flowchart LR",
    `  IN(["${r.sent.toLocaleString("en-US")} events sent"]) --> C{"Cribl Routes"}`,
  ];
  for (const [dest, got] of Object.entries(r.counts)) {
    const ok = got === r.expected[dest];
    const box = ok ? (got === 0 ? BOX_NEUTRAL : BOX_OK) : BOX_FAIL;
    lines.push(
      `  C -->|"${got.toLocaleString("en-US")}"| ${dest}["${ok ? "" : "⚠️ "}${dest}"]`,
      `  style ${dest} ${box}`,
    );
  }
  lines.push("```");
  return lines.join("\n");
}

export function reportMarkdown(results: ScenarioResult[]): string {
  const lines: string[] = ["# End-to-end results", ""];
  for (const r of results) {
    lines.push(
      `## ${r.scenario} — ${r.pass ? "✅ pass" : "❌ FAIL"}`,
      "",
      r.pass
        ? `✅ **All ${r.sent.toLocaleString("en-US")} events accounted for.**`
        : "❌ **Counts did not match expectations — see below.**",
      "",
      mermaidFlow(r),
      "",
      "<details><summary>Detailed counts (click to expand)</summary>",
      "",
      "| Destination | Actual | Expected |",
      "| --- | --- | --- |",
      ...Object.keys(r.expected).map(
        (d) =>
          `| ${d} | ${r.counts[d]}${r.counts[d] === r.expected[d] ? "" : " ⚠️"} | ${r.expected[d]} |`,
      ),
      "",
      "</details>",
      "",
    );
  }
  return lines.join("\n");
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
