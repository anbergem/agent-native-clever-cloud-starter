# Upstream issue draft — BuilderIO/agent-native

Status: draft. **The maintainer opens this issue; do not open it from a task.**
Written 2026-09-16. The workaround it describes lives in `wrangler.jsonc` (`AGENT_ENGINE`,
`AGENT_NATIVE_BUILD_ENGINE_PACKAGES`) and is held in place by `tests/guards/agent-engine.test.mjs`.

---

**Title**

Cloudflare Worker builds stub out `@anthropic-ai/sdk`, so the default `anthropic` engine
always dies on `client.messages.stream` — and `ai-sdk:*` is rejected as "not installed"

---

**Framework version**

- `@agent-native/core` 0.176.5
- `wrangler` 4.129.0, `workerd` 1.20260903.1
- `NITRO_PRESET=cloudflare_pages`, deployed as a Worker with static assets

**What happens**

Agent chat is dead on every Cloudflare Worker, deployed and under local `wrangler dev` alike.
The SSE stream opens and then carries one error:

```
{"error":"Cannot read properties of undefined (reading 'stream')","seq":4}
```

Selecting `ai-sdk:anthropic` instead trades it for a second, unrelated refusal:

```
[agent-engine] Engine "ai-sdk:anthropic" requires optional packages that are not
installed in this app. Run: pnpm add ai @ai-sdk/anthropic
```

— in an app whose `package.json` declares both, and whose bundle contains both.

**Why — two independent bugs**

1. `CLOUDFLARE_WORKER_STUB_MODULES` in `dist/deploy/build.js` maps
   `"@anthropic-ai/sdk"` to `"export default class Anthropic {}"`. `anthropic-engine.ts`
   loads the SDK through `(await import("@anthropic-ai/sdk")).default` and then calls
   `client.messages.stream(...)`, so `new Anthropic({ apiKey })` yields `{}` and
   `client.messages` is `undefined`. The stub is silent: nothing warns at build time, and
   the engine registry still advertises `anthropic` as usable, so it is the engine
   `detectEngineFromEnv()` picks for an app whose only credential is `ANTHROPIC_API_KEY`.
   Confirmed in the built bundle — `this.messages = new API.Messages(this)` is absent while
   the `n.messages.stream(...)` call site survives.

2. `canResolvePackage()` in `agent/engine/registry.ts` gates `ai-sdk:*` on
   `require.resolve`, which cannot see inside a Worker bundle. Its fallbacks do not cover
   this platform: `AGENT_NATIVE_BUILD_ENGINE_PACKAGES` is injected only by the
   Netlify/Nitro deploy build (`build.js`, `resolveDeclaredRuntimePackageNames`), and
   `isBundledServerlessRuntime()` matches Vercel/Netlify markers and `/var/task/`
   paths — none of which exist on workerd. So every AI-SDK engine is refused at runtime
   even when its packages are bundled.

Together these leave a Cloudflare deployment with no working Anthropic engine at all: the
native one cannot load, and the one that can load is refused.

**Expected**

Either keep `@anthropic-ai/sdk` in Worker bundles, or — since the stub is presumably there
because the SDK is not workerd-safe — have the registry refuse the `anthropic` engine on
that platform so `detectEngineFromEnv()` falls through to `ai-sdk:anthropic`, which works.
Whichever way, the Cloudflare build should supply the same package evidence the
Netlify/Nitro build does.

**Workaround**

Both environments and the local `vars` block set:

```jsonc
"AGENT_ENGINE": "ai-sdk:anthropic",
"AGENT_NATIVE_BUILD_ENGINE_PACKAGES": "[\"ai\",\"@ai-sdk/anthropic\"]",
```

With both, `pnpm smoke` against `wrangler dev` passes `agent chat SSE` against the real API —
the first time agent chat has run on a Worker in this repository. With only the first, the
engine is refused; with only the second, the native engine still dies on `messages.stream`.

**Related**

- `fs-os-default-export-stubs.md` — same stub table, same class of failure.
- `agent-chat-d1-hang.md` — the local `wrangler dev` hang this masked.
