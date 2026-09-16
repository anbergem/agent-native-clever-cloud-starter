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

// `patches/@agent-native__core@<version>.patch` bounds every database statement so
// a stalled one cannot wedge an isolate (DISCREPANCIES.md, 2026-09-16). Like the
// bundle patches in `scripts/lib/worker-patches.mjs`, it is pinned to one version
// and must be re-examined at every upgrade rather than carried silently (D03).
const CORE_VERSION = JSON.parse(
  readFileSync(
    path.join(root, "node_modules", "@agent-native", "core", "package.json"),
    "utf8",
  ),
).version;

const MARKER = "AGENT_NATIVE_DB_STATEMENT_TIMEOUT_MS";

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

test("the patch is actually applied to the installed package", () => {
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
  assert.ok(
    client.includes(MARKER),
    "the installed @agent-native/core carries no statement deadline — run `pnpm install`",
  );
  // The seam it attaches to. If upstream reshapes `execAnnotated`, the patch may
  // still apply while guarding nothing, which is the failure mode worth catching.
  assert.match(
    client,
    /withStatementDeadline\(_exec\.execute\(sanitize\(s\)\)/,
  );
});

// When upstream stops creating its tables through a long sequence of
// expected-to-fail DDL statements, the deadline stops being load-bearing and this
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
