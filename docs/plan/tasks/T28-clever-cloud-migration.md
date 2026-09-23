# T28 — Leave Cloudflare Workers for Clever Cloud + PostgreSQL

Goal: run this application as an ordinary always-on Node process on Clever Cloud (Paris) against
a managed PostgreSQL add-on, and delete the Cloudflare-specific machinery and workarounds that
exist only because Workers is not a platform Agent-Native supports.

Decision (maintainer, 2026-09-23, D29): move. Supersedes D02 (`cloudflare_pages` preset) and
D03 (post-build bundle patching).

Depends on: T24 (bootstrap), T20 (deploy workflows), T21 (backups).

## Why — the evidence, not the preference

Three defects were found in one day (2026-09-16), all in framework code, all the same mismatch:
code written for an always-on server with a local database, running where every such call is a
network call that can fail to return.

| Defect | Cause | Recorded |
| --- | --- | --- |
| Agent chat dead on every Worker | The Cloudflare build replaces `@anthropic-ai/sdk` with `export default class Anthropic {}` | `upstream-issues/anthropic-sdk-stubbed-on-workers.md` |
| `ai-sdk:*` engines refused at runtime | Availability gate calls `require.resolve`, which cannot see inside a Worker bundle | same |
| Mutating actions stop answering | `ensureAuditTables()` issues 17 sequential DDL statements, 10 of them expected to throw, memoized in a promise that only resets on rejection | `upstream-issues/runtime-ddl-wedges-d1-isolates.md` |

Measured on deployed staging: authenticated commands answered 4 times out of 30, degrading to 0
of 15 on a poisoned isolate; agent chat never worked at all. After the workarounds, 30 of 30 and
roughly three chat requests in four. On a plain Node process with a file database, the same
build is 8 of 8 on chat with a 9ms first byte, and 20 of 20 on writes.

The application is not the obstacle and never was. It contains **no Cloudflare API calls at
all** — `runAtomic` is the only seam that ever knew the difference, and it already supports the
`transaction` shape Postgres provides.

## What moves, and what does not

Unchanged: `actions/`, `app/`, `src/domain`, `src/application`, `agent/`, `evals/`,
`tests/e2e`, the seed scenario, auth. The repositories keep their SQL — the framework's Postgres
executor runs every statement through `sqliteToPostgresParams`, a real parser that rewrites `?`
to `$n` while respecting literals, comments and dollar quoting, so all 63 placeholders stand.
`INSERT OR IGNORE` was the single dialect-specific statement and is already gone (9559c66).

Deleted: `wrangler.jsonc`, `scripts/build-worker.mjs`, `scripts/patch-worker-bundle.mjs`,
`scripts/lib/worker-patches.mjs`, `tests/guards/worker-patches.test.mjs`,
`scripts/backup-d1.sh`, `scripts/restore-d1-check.sh`, `tests/guards/restore-d1-check.test.mjs`,
`scripts/lib/wrangler-vars.mjs`, `tests/guards/wrangler-vars.test.mjs`, the `AGENT_ENGINE` and
`AGENT_NATIVE_BUILD_ENGINE_PACKAGES` workarounds (the native SDK loads fine on Node), and
`wrangler` from `devDependencies`.

Kept: `patches/@agent-native__core@0.176.5.patch`. The audit ceiling is cheap and correct
wherever the database is over a network, and `docs/plan/upstream-issues/` keeps the reports owed
regardless of where we host.

## Steps

1. **`scripts/bootstrap.mjs`** — replace the Cloudflare steps. New step list:
   `preflight`, `apps`, `postgres`, `app-env`, `deploy`, `github-environments`,
   `github-secrets`, `branch-protection`. Drop `d1` and `worker-secrets`.
   - `preflight` additionally asserts `clever profile` succeeds, so an unauthenticated CLI is
     refused before anything is created rather than half way through.
   - `apps` — `clever create --type node <app> --region par --format json` per environment.
   - `postgres` — `clever addon create postgresql-addon <app>-pg --region par`, then
     `clever service link-addon`. The add-on injects `DATABASE_URL`, which the framework
     already reads, so nothing records a connection string in the repository.
   - `app-env` — `clever env set` per variable, and `clever env import` from stdin for the
     secrets so no value reaches a process argument.
   - Input changes: drop `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; `STAGING_URL` and
     `PRODUCTION_URL` become **optional** overrides for custom domains, because
     `clever create` reports the `cleverapps.io` domain it assigned. Add optional
     `CLEVER_ORG` and `CLEVER_REGION` (default `par`).
   - Authentication is the CLI's own profile in `~/.config/clever-cloud/`, established once by
     `clever login`. No Clever Cloud credential is ever written to `.bootstrap.env` — which is
     strictly better than the Cloudflare arrangement it replaces. CI is the exception and uses
     `CLEVER_TOKEN` / `CLEVER_SECRET` as GitHub secrets.
2. **`tests/guards/bootstrap.test.mjs`** — same method, `clever` replacing `wrangler` in the
   stub PATH. The existing assertions carry over unchanged in spirit: plan mutates nothing,
   exact argv and stdin per mutating call, a second `--yes` run reports `already present`
   everywhere, and no secret reaches stdout or stderr.
3. **Migrations** — one runner for both dialects. `scripts/migrate-local.mjs` currently refuses
   any `DATABASE_URL` that is not `file:`; generalise it over `createDbExec({ url })` from
   `@agent-native/core/db`, keeping the `d1_migrations` bookkeeping table so `/api/ready` asks
   the same question of both runtimes. Bookkeeping DDL must lose `AUTOINCREMENT`.
   Open question: **whether migrations run at boot or as a deploy step.** Clever Cloud has no
   release phase, so boot is the usual answer, at the cost of a bad migration taking the app
   down rather than failing a deploy. Decide before writing it.
4. **Deploy workflows** — `clever deploy` in place of `wrangler deploy`; drop the D1 credential
   preflight and the "wait for the framework to create its tables" poll, which existed for a
   cold-isolate problem that does not occur on an always-on process.
5. **Smoke** — `health uses D1` becomes `health uses PostgreSQL`; drop the Worker-specific
   budget and retry reasoning once a run proves it unnecessary.
6. **Docs** — `docs/bootstrap.md`, `docs/deployment.md`, `docs/runbook.md`, `docs/backups.md`,
   `ARCHITECTURE.md`, and the D02/D03 entries in `01-decisions.md`.

## Verification

Each step lands with its guards green. The move is finished when, against the deployed Clever
Cloud staging: `pnpm smoke` is green including `agent chat SSE`, `pnpm test:e2e` is green, the
evals run with a funded key, and the counts that exposed the Cloudflare defect —
`complete-job`, `archive-job`, `create-job`, ten calls each — answer 10 of 10.

## Risk

The chat defect is not fully explained (`DISCREPANCIES.md`, 2026-09-16: statement stalls, the
plugin readiness gate and the model first-event bound were each ruled out by measurement). It is
*expected* to disappear with the isolate lifecycle, and it does not reproduce on Node locally,
but that is an inference. Step 6 does not begin until a deployed staging run demonstrates it.
