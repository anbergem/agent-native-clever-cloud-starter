import { defineNitroPlugin } from "@agent-native/core/server";

import { hasThirdPartyFonts, stripThirdPartyFonts } from "../third-party-fonts";

type Fetch = (request: Request) => Response | Promise<Response>;

/**
 * Keep the framework's sign-in page from loading Google Fonts (see `../third-party-fonts.ts`).
 *
 * It wraps `nitroApp.fetch`, the application's single entry point: Nitro's node server reads
 * it once, after the plugins have run, so every response passes through here exactly once
 * and after every framework middleware — including the auth guard that serves the sign-in
 * page, which the framework prepends. An earlier version kept an h3 middleware first in the
 * framework's middleware list by moving it there on each request; moving entries in a list
 * that in-flight requests were iterating stalled some of them.
 *
 * Only a GET answered with HTML is read, and only a page that actually carries a Google
 * Fonts link is rewritten. The browser suite's same-origin assertion is what fails if a
 * framework upgrade loads the fonts some other way.
 */
export default defineNitroPlugin((nitroApp) => {
  const app = nitroApp as { fetch?: Fetch };
  if (typeof app.fetch !== "function") {
    throw new Error(
      "00-no-third-party-fonts: nitroApp.fetch is not a function; re-check after a Nitro upgrade",
    );
  }
  const original = app.fetch.bind(nitroApp);
  app.fetch = async (request) => {
    const response = await original(request);
    if (request.method !== "GET") return response;
    if (!response.headers.get("content-type")?.includes("text/html")) {
      return response;
    }
    const html = await response.clone().text();
    if (!hasThirdPartyFonts(html)) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(stripThirdPartyFonts(html), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
});
