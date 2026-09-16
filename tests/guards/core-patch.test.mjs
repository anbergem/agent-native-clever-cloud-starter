import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// `patches/@agent-native__core@<version>.patch` carries two changes: it detaches the
// audit write from the request path, which is the measured cause of wedged isolates,
// and it bounds every statement, which covers the same failure in the framework's
// other runtime table bootstraps (DISCREPANCIES.md, 2026-09-16). Like the
// bundle patches in `scripts/lib/worker-patches.mjs`, it is pinned to one version
// and must be re-examined at every upgrade rather than carried silently (D03).
const CORE_VERSION = JSON.parse(
  readFileSync(
    path.join(root, "node_modules", "@agent-native", "core", "package.json"),
    "utf8",
  ),
).version;

test("the patch is pinned to the installed core version", () => {
  const workspace = readFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "utf8",
  );
  // Quoting is oxfmt's to choose, so match the pair rather than one spelling.
  const entry = new RegExp(
    `^\\s*['"]?@agent-native/core@${CORE_VERSION}['"]?:\\s*patches/@agent-native__core@${CORE_VERSION}\\.patch\\s*$`,
    "m",
  );
  assert.match(
    workspace,
    entry,
    `pnpm-workspace.yaml does not patch @agent-native/core@${CORE_VERSION}. An upgrade needs a re-cut patch: see docs/plan/upstream-issues/runtime-ddl-wedges-d1-isolates.md`,
  );
});

test("the audit write no longer blocks the request", () => {
  const action = readFileSync(
    path.join(
      root,
      "node_modules",
      "@agent-native",
      "core",
      "dist",
      "action.js",
    ),
    "utf8",
  );
  // The blocking `await` is what wedged isolates: `ensureAuditTables()` can stop
  // settling, and a `try/catch` around it catches rejections, not silence. The
  // recorder is still awaited — inside a detached task, which is the point.
  assert.ok(
    action.includes("schedule the audit write, do not wait for it"),
    "the installed @agent-native/core still awaits its audit write — run `pnpm install`",
  );
  assert.match(
    action,
    /void \(async \(\) => \{[\s\S]{0,400}?recordActionAudit\(threw/,
  );
});

test("statements are still bounded", () => {
  const client = readFileSync(
    path.join(
      root,
      "node_modules",
      "@agent-native",
      "core",
      "dist",
      "db",
      "client.js",
    ),
    "utf8",
  );
  assert.ok(client.includes("AGENT_NATIVE_DB_STATEMENT_TIMEOUT_MS"));
  // `getDbExec()` hands back the raw client once `_exec` is set, so the bound has to
  // be installed on that object. Wrapping only the internal funnel guarded nothing,
  // which a deploy proved the expensive way.
  assert.match(client, /return installStatementDeadline\(_exec\)/);
});

// When upstream stops creating its tables through a long sequence of
// expected-to-fail DDL statements, neither half is load-bearing any more and this
// says so rather than leaving a workaround nobody revisits.
test("upstream still bootstraps the audit table with failing ALTERs", () => {
  const store = readFileSync(
    path.join(
      root,
      "node_modules",
      "@agent-native",
      "core",
      "dist",
      "audit",
      "store.js",
    ),
    "utf8",
  );
  assert.match(store, /ALTER TABLE agent_audit_log ADD COLUMN/);
  assert.match(store, /_initPromise/);
});
