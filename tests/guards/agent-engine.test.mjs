import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseJsonc } from "../../scripts/lib/jsonc.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// The framework's Cloudflare build replaces `@anthropic-ai/sdk` with
// `export default class Anthropic {}`, so the native `anthropic` engine builds an
// empty object and agent chat dies on `client.messages.stream` with "Cannot read
// properties of undefined (reading 'stream')" — on deployed Workers and under
// local `dev:worker` alike (DISCREPANCIES.md, 2026-09-16). Every environment runs
// `ai-sdk:anthropic` instead, which is bundled and speaks the same API over fetch.
const STUBBED_ENGINE = "anthropic";
const ENGINE = "ai-sdk:anthropic";

/** @returns {Record<string, unknown>} */
function wrangler() {
  return parseJsonc(readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
}

test("every wrangler environment selects an engine that loads on a Worker", () => {
  const config = wrangler();
  const blocks = [["vars", config.vars]];
  for (const [name, environment] of Object.entries(config.env ?? {})) {
    blocks.push([`env.${name}.vars`, environment?.vars]);
  }
  assert.equal(
    blocks.length,
    3,
    "expected the local, staging and production blocks",
  );
  for (const [where, vars] of blocks) {
    assert.equal(vars?.AGENT_ENGINE, ENGINE, `${where}: AGENT_ENGINE`);
  }
});

test("the Node dev server and the evals run the same engine", () => {
  const example = readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(example, new RegExp(`^AGENT_ENGINE=${ENGINE}$`, "m"));
});

// The workaround exists only because the stub does. When an upgrade drops
// `@anthropic-ai/sdk` from `CLOUDFLARE_WORKER_STUB_MODULES`, this fails and says
// so, rather than leaving a pin nobody revisits (D03).
test("the framework still stubs the Anthropic SDK out of Worker bundles", () => {
  const build = readFileSync(
    path.join(
      root,
      "node_modules",
      "@agent-native",
      "core",
      "dist",
      "deploy",
      "build.js",
    ),
    "utf8",
  );
  const stubs = build.slice(build.indexOf("CLOUDFLARE_WORKER_STUB_MODULES"));
  assert.ok(
    /"@anthropic-ai\/sdk":\s*"export default class Anthropic \{\}/.test(stubs),
    `the framework no longer stubs @anthropic-ai/sdk — re-test the native "${STUBBED_ENGINE}" engine on a Worker and drop AGENT_ENGINE if it works`,
  );
});
