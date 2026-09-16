# Upstream issue draft — BuilderIO/agent-native

Status: draft. **The maintainer opens this issue; do not open it from a task.**
Written 2026-09-16. The workaround it describes is
`patches/@agent-native__core@0.176.5.patch`, held in place by `tests/guards/core-patch.test.mjs`.

---

**Title**

Runtime table bootstrap wedges a Worker isolate permanently on D1: every mutating
action stops answering while reads keep working

---

**Framework version**

- `@agent-native/core` 0.176.5
- `wrangler` 4.129.0, `workerd` 1.20260903.1, `NITRO_PRESET=cloudflare_pages`
- Cloudflare D1 (remote), Worker with static assets

**What happens**

On a deployed Worker, authenticated POSTs to action endpoints intermittently never
answer. The request body is delivered in full, the action itself completes — the
Worker logs `outcome ok, durationMs 214` — and then no byte of a response ever
reaches the client. Reads are never affected.

Ten calls each, from a laptop against deployed staging:

```
GET  /_agent-native/actions/list-jobs          answered=10  no-response=0
POST /_agent-native/auth/login   (wrong pw)    answered=10  no-response=0
POST /_agent-native/actions/no-such-action     answered=10  no-response=0
POST /mcp                                      answered=10  no-response=0
POST /_agent-native/actions/complete-job  {}   answered=1   no-response=9
POST /_agent-native/actions/archive-job   {}   answered=0   no-response=10
POST /_agent-native/actions/create-job    {}   answered=3   no-response=7
```

Note the fifth through seventh rows: those bodies are rejected with `400` before the
action mutates anything, and they hang as often as the ones that succeed. Whatever
this is, it is not the write.

It also degrades. Early sampling showed roughly one failure in three; an hour later
the same call failed 15 times out of 15, while reads through the same hostname kept
answering in 18ms.

**Why**

`ensureAuditTables()` (`dist/audit/store.js`) creates the audit table on first use by
issuing, in sequence: one `CREATE TABLE IF NOT EXISTS`, then ten
`ALTER TABLE agent_audit_log ADD COLUMN …` statements wrapped in `try {} catch {}`
because they are *expected* to throw on every boot after the first, then six
`CREATE INDEX IF NOT EXISTS`. Seventeen sequential round trips, ten of them
deliberate failures, before the first mutating action of an isolate can answer.

Against local SQLite that costs nothing, which is why no local test sees it. Against
remote D1 a statement in that sequence intermittently never returns.

The result is not one slow request but a wedged isolate, because the sequence is
memoized as a single shared promise:

```js
export async function ensureAuditTables() {
    if (!_initPromise) {
        _initPromise = (async () => { /* … */ })().catch((err) => {
            _initPromise = undefined;   // only on rejection
            throw err;
        });
    }
    return _initPromise;
}
```

A rejection self-heals. A promise that never settles is awaited forever by every
later request on that isolate. `recordActionAudit` cannot help either: its
`try/catch` and its "auditing must never break the audited action" comment both
assume failure means *throwing*.

Reads are untouched because `resolveAuditAttach()` audits every mutating action and
no read-only one — which is exactly the boundary the measurements show.

This is not specific to auditing. At least twenty modules follow the same
create-then-ALTER-then-index-at-runtime pattern behind the same memoized
`_initPromise`, `chat-threads/store.js` and `agent/run-store.js` among them. Agent
chat on a Worker hangs the same way and for the same reason.

**Confirmation**

Setting `AGENT_NATIVE_AUDIT_ENABLED=false` on staging, changing nothing else, took
the three action counts above from 1/10, 0/10 and 3/10 to **10/10, 10/10 and 10/10**,
and the deployment's write suite passed for the first time. Successful commands then
answer in a steady 0.21–0.29s, so the ordinary query path is healthy; only the
bootstrap stalls.

**Expected**

Three things would each be sufficient, and they compose:

1. Bound the bootstrap. A statement that has not answered in seconds should reject,
   not hang — every call site already handles rejection correctly.
2. Do not probe schema with statements designed to fail. `PRAGMA table_info` once,
   or a `batch`, replaces seventeen round trips with one or two.
3. Do not let best-effort auditing sit in the request's critical path at all.

**Workaround**

`patches/@agent-native__core@0.176.5.patch` (pnpm patch) does two things.

The fix: `wrapRunWithAudit` still awaits the audit write, but races it against
`AGENT_NATIVE_AUDIT_WAIT_MS` (default 1000ms, 0 detaches entirely). On a healthy path
the recorder finishes in single-digit milliseconds and nothing observable changes; on a
stalled bootstrap the reply is late by at most a second instead of never arriving.

Detaching it entirely was tried first and is too much: two e2e tests assert the audit
row exists the moment the action returns, and they failed. The guarantee is worth
keeping — it is what the wrapper is for. Only its unboundedness is the bug.

The bound: `AGENT_NATIVE_DB_STATEMENT_TIMEOUT_MS` (default 5000ms, 0 disables),
installed on the client `getDbExec()` actually hands out. This covers the same
bootstrap pattern in `chat-threads/store.js` and `agent/run-store.js`, which agent
chat appears to hit. It is a bound on the failure mode, not a proven fix.

Two dead ends worth recording, because both look reasonable:

- Wrapping only the internal `execAnnotated` funnel guards nothing —
  `getDbExec()` short-circuits to the raw `_exec` on every call after the first.
- A deadline alone does not rescue the request. With the bound set to 1ms the action
  logged `outcome success` and still never answered: a *rejection* inside the audited
  path hangs the response as thoroughly as a stall. Whatever holds the response open
  is not waiting on a promise that rejects.

**Related**

- `agent-chat-d1-hang.md` — "the 8th D1 query never returns" under local
  `wrangler dev` is the same sequence, observed before the mechanism was understood.
- `anthropic-sdk-stubbed-on-workers.md` — unrelated cause, same symptom surface
  (agent chat dead on Workers).
