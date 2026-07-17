# End-to-end testing

`e2e/run.ts` proves the pack against a **real routing engine**, not the
`/preview` API the Vitest harness uses: it starts a `cribl/cribl` container,
copies in a worker config (`e2e/cribl/` → `$CRIBL_HOME/local/cribl/`),
**commits the config in Cribl's internal git** (a test isn't valid with
uncommitted Cribl state), pushes 1000 sequence-numbered NDJSON events into a
`tcpjson` input on port 10070, waits for the filesystem destinations to
flush, and compares unique-seq counts per destination against
`e2e/expect.json`. The result is a plain-language report with a mermaid flow
diagram (rendered natively by GitHub) and detailed counts collapsed behind a
click.

```sh
node --experimental-strip-types e2e/run.ts     # exits non-zero on mismatch
```

CI: the **E2E** workflow (`.github/workflows/e2e.yml`) runs the same command
on `workflow_dispatch` and on PRs touching `e2e/**`, and writes the result
table to the run's Step Summary.

## Config layout (verified against cribl/cribl:4.18.x)

- Single-instance Cribl reads worker config from `$CRIBL_HOME/local/cribl/`:
  `inputs.yml`, `outputs.yml`, `pipelines/route.yml`, `pipelines/<id>/conf.yml`.
- Config is **copied** into the container (`docker cp`), never bind-mounted:
  Cribl persists config via `rename()`, which fails (EBUSY) over bind-mounted
  files — UI edits would silently not persist and Cribl's internal git would
  fight the mounts. (The image has no `/opt/cribl/local` until first boot, so
  the runner stages the tree and copies it before `docker start`.)
- Filesystem outputs require `maxFileOpenTimeSec`/`maxFileIdleTimeSec` >= 10
  (schema minimum); the runner polls until counts are stable across polls.
  Never delete output files mid-run — Cribl holds them open, and writes to
  deleted inodes vanish silently.
- Packs must be installed via the management API (`PUT /packs?filename=` then
  `POST /packs`), **never** bind-mounted into `/opt/cribl/default/<id>` — a
  mounted pack fails boot, and the failed boot's rollback deletes the mounted
  host files. Restart the container after install so `pipeline: pack:<id>`
  route references re-bind.

## Inspecting the instance before it's destroyed

Set `KEEP=1` to skip teardown and leave the container running:

```sh
KEEP=1 node --experimental-strip-types e2e/run.ts
```

Then log in at <http://localhost:19000> (admin/admin) to click through the
exact routes, pipelines, and destinations the run used. The next run recycles
the container automatically; remove it manually with `docker rm -f cribl-e2e`.

### Inspecting CI runs

On GitHub-hosted runners there is no network path to the container, so
`KEEP=1` alone doesn't help. Options, in order of preference:

1. **Reproduce locally with `KEEP=1`** — CI executes the identical config, so
   a local run is a faithful replica. This is almost always enough.
2. **Tailscale on the GitHub-hosted runner** — add a
   [`tailscale/github-action`](https://github.com/tailscale/github-action)
   step with an ephemeral auth-key secret, hold the job with a `sleep` step,
   and browse the runner over your tailnet. Works on public repos with no
   self-hosted infrastructure.
3. **Self-hosted runner** — pass a runner label and a hold input to the
   workflow so it sleeps before teardown, then browse
   `http://<runner-host>:19000` on your LAN. **Caveat:** GitHub advises
   against self-hosted runners on public repositories (fork PRs can execute
   code on your machine). If you go this way: keep "require approval for all
   outside collaborators" enabled, use a dedicated runner group, isolate the
   runner host on its own network segment — or make the repo private.
